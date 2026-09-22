/**
 * 目标目录路径自检。
 *
 * 页面生效目录来自「页面 scope 句柄 → 平台默认目录句柄」的解析结果（含按页面 URL
 * 字段匹配得到的 scope、按平台字段匹配得到的默认目录），并不保证仍指向真实存在的
 * 目录：目录被移动 / 重命名 / 删除后浏览器不会让句柄自动失效，只有真正访问时才报错。
 * 由此会出现「显示有目录、实际写入失败」「选择器停在错误位置」这类问题。
 *
 * 本模块显式探测一次并给出可判定结论（结论只用于信息反馈与失效绑定清理，不阻断用户操作）：
 * - ok：目录存在、可读写
 * - unbound：当前平台没有任何可用句柄
 * - permission-denied：句柄存在但无读写授权（浏览器重启后常见）
 * - missing：目录已不存在（被移动或删除），调用方可清理失效绑定
 * - platform-conflict：平台默认目录与另一个平台的默认目录是同一个目录
 */

import { logger } from '../lib/logger.js';
import { getDefaultDirectoryHandle, clearDefaultDirectoryHandle } from '../lib/directory/file-handle-db.js';
import { getPlatformKeyFromPageType } from './config.js';
import { queryHandlePermissionState, type DirectoryPermissionState } from './target-directory-access.js';
import {
  resolveTargetDirectorySelection,
  clearStaleTargetDirectoryBinding,
  type ResolvedTargetDirectory,
} from './target-directory-state.js';
import type { PlatformKey } from '../types/platform.js';

interface TabInfo {
  readonly id?: number;
  readonly url?: string;
  readonly pendingUrl?: string;
}

// ── 结论类型 ──────────────────────────────────────────

export type TargetDirectoryHealth =
  | 'ok'
  | 'unbound'
  | 'permission-denied'
  | 'missing'
  | 'platform-conflict';

export type TargetDirectorySource = ResolvedTargetDirectory['source'] | 'none';

export interface DirectoryHealthInput {
  /** 句柄权限状态（none 表示未绑定句柄） */
  readonly permission: DirectoryPermissionState;
  /** 目录是否仍然存在 */
  readonly exists: boolean;
  /** 平台默认目录是否与另一平台默认目录相同 */
  readonly platformConflict: boolean;
}

/**
 * 归并各项探测结果为自检结论。
 *
 * 纯函数：不含 IO，便于单测覆盖「删除 / 无权限 / 平台目录冲突」各分支。
 * 判定顺序：未绑定 → 无权限 → 目录不存在 → 平台目录冲突 → 通过。
 * 「目录不存在」优先于「平台冲突」：目录已消失时需要先清理失效绑定。
 */
export function classifyDirectoryHealth(input: DirectoryHealthInput): TargetDirectoryHealth {
  if (input.permission === 'none') return 'unbound';
  if (input.permission !== 'granted') return 'permission-denied';
  if (!input.exists) return 'missing';
  if (input.platformConflict) return 'platform-conflict';
  return 'ok';
}

export interface TargetDirectoryCheckResult {
  readonly health: TargetDirectoryHealth;
  readonly source: TargetDirectorySource;
  readonly platformKey: PlatformKey;
  /** 目录名（File System Access 只暴露目录名，不暴露完整路径） */
  readonly label: string;
  readonly handle?: FileSystemDirectoryHandle;
  /** 本次自检是否清理了指向已消失目录的失效绑定 */
  readonly clearedBinding: boolean;
}

export interface TargetDirectoryCheckOptions {
  /** 目录不存在时是否清理失效绑定（页面绑定 / 平台默认句柄） */
  readonly clearStaleBinding?: boolean;
}

// ── 探测 ──────────────────────────────────────────────

/**
 * 目录句柄的异步枚举能力（lib.dom 未声明，Chrome 86+ 实际提供）。
 * 枚举是「句柄是否仍指向存在目录」的可靠探测手段。
 */
interface EnumerableDirectoryHandle extends FileSystemDirectoryHandle {
  entries?(): AsyncIterableIterator<[string, FileSystemHandle]>;
  keys?(): AsyncIterableIterator<string>;
}

/**
 * 通过枚举目录项验证句柄是否仍指向存在的目录。
 *
 * 目录被删除 / 移动后，浏览器对句柄的枚举会抛 NotFoundError；其他错误
 * （瞬时 IO、外置盘离线等）不判定为「目录已删除」，避免误清用户绑定。
 */
async function probeDirectoryExists(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const enumerable = handle as EnumerableDirectoryHandle;

  try {
    if (typeof enumerable.entries === 'function') {
      await enumerable.entries().next();
    } else if (typeof enumerable.keys === 'function') {
      await enumerable.keys().next();
    } else {
      // 当前环境不支持枚举：无法验证，按存在处理（不误清绑定）
      logger.debug('当前环境不支持目录枚举，跳过存在性探测');
    }
    return true;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    logger.warn('目标目录存在性探测失败', { error: String(error) });
    return true;
  }
}

/** 平台默认目录是否与另一个平台的默认目录指向同一个目录 */
async function probePlatformConflict(
  handle: FileSystemDirectoryHandle,
  platformKey: PlatformKey,
): Promise<boolean> {
  const otherPlatform: PlatformKey = platformKey === 'h3yun' ? 'cloudpivot' : 'h3yun';
  const otherHandle = await getDefaultDirectoryHandle(otherPlatform);
  if (!otherHandle || typeof handle.isSameEntry !== 'function') return false;

  try {
    return await handle.isSameEntry(otherHandle);
  } catch (error: unknown) {
    logger.warn('目标目录平台归属比对失败', { error: String(error) });
    return false;
  }
}

/** 清理指向已消失目录的绑定 */
async function clearStaleBinding(
  resolved: ResolvedTargetDirectory,
  tab: TabInfo | number,
  pageType: string,
): Promise<boolean> {
  // 页面绑定只影响当前页面；平台默认句柄影响该平台所有未绑定页面，两者都需清理
  if (resolved.source === 'platform-default') {
    await clearDefaultDirectoryHandle(resolved.platformKey);
    return true;
  }
  return clearStaleTargetDirectoryBinding(tab, pageType);
}

// ── 公开 API ──────────────────────────────────────────

/** 对当前页面生效目录做一次路径自检 */
export async function checkTargetDirectoryHealth(
  tab: TabInfo | number,
  pageType: string,
  options: TargetDirectoryCheckOptions = {},
): Promise<TargetDirectoryCheckResult> {
  const platformKey = getPlatformKeyFromPageType(pageType);
  const resolved = await resolveTargetDirectorySelection(tab, pageType);

  if (!resolved) {
    return { health: 'unbound', source: 'none', platformKey, label: '', clearedBinding: false };
  }

  const handle = resolved.handle;
  const permission = await queryHandlePermissionState(handle);
  const exists = permission === 'granted' ? await probeDirectoryExists(handle) : false;
  const platformConflict = exists && resolved.source === 'platform-default'
    ? await probePlatformConflict(handle, platformKey)
    : false;

  const health = classifyDirectoryHealth({ permission, exists, platformConflict });
  const clearedBinding = health === 'missing' && options.clearStaleBinding === true
    ? await clearStaleBinding(resolved, tab, pageType)
    : false;

  if (clearedBinding) {
    logger.warn('已清理指向不存在目录的绑定', { source: resolved.source, platformKey, label: handle.name });
  }

  return {
    health,
    source: resolved.source,
    platformKey,
    label: handle.name || '',
    handle,
    clearedBinding,
  };
}
