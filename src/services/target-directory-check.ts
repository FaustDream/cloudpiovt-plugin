/**
 * 目标目录自检（页面表单编码关联校验）。
 *
 * 目录与当前页面的关联通过本地表单编码记录和页面级目录句柄身份比对判定；
 * 仅为迁移旧版本，读取目录内遗留的 fromcode 文件。找不到关联或匹配失败时不创建
 * 测试文件夹 / 临时文件，结论直接交由用户判断。
 *
 * 关联读取异常根据句柄权限区分 prompt（浏览器重启后的待授权状态）与 denied。
 */

import { logger } from '../lib/logger.js';
import { getPlatformKeyFromPageType } from './config.js';
import { queryHandlePermissionState, type DirectoryPermissionState } from './target-directory-access.js';
import { resolveTargetDirectorySelection, type ResolvedTargetDirectory } from './target-directory-state.js';
import { extractPageFormCode, readDirectoryFromcode, verifyDirectoryFromcode } from './directory-fromcode.js';
import type { PlatformKey } from '../types/platform.js';

interface TabInfo {
  readonly id?: number;
  readonly url?: string;
  readonly pendingUrl?: string;
}

// ── 结论类型 ──────────────────────────────────────────

export type TargetDirectoryHealth =
  | 'ok' // 本地目录关联与当前页面匹配，或页面无编码无需校验
  | 'unbound' // 当前平台没有任何可用句柄
  | 'fromcode-missing' // 本地与旧版标记均无关联（新建 / 未初始化），交由用户确认
  | 'fromcode-mismatched' // 目录已关联其他表单，交由用户确认
  | 'permission-prompt' // 读取被拒但权限为 prompt（重启后正常待授权状态）
  | 'permission-denied'; // 读取被拒且权限为 denied（用户明确拒绝）

export type TargetDirectorySource = ResolvedTargetDirectory['source'] | 'none';

export interface TargetDirectoryCheckResult {
  readonly health: TargetDirectoryHealth;
  readonly source: TargetDirectorySource;
  readonly platformKey: PlatformKey;
  /** 目录名（File System Access 只暴露目录名，不暴露完整路径） */
  readonly label: string;
  readonly handle?: FileSystemDirectoryHandle;
  /** fromcode-mismatched 时可取得的目录归属编码（旧版文件迁移场景） */
  readonly fromcodeValue?: string;
}

// ── 探测 ──────────────────────────────────────────────

async function queryPermissionSafely(
  handle: FileSystemDirectoryHandle,
): Promise<DirectoryPermissionState> {
  try {
    return await queryHandlePermissionState(handle);
  } catch (error: unknown) {
    logger.warn('查询目录权限失败，按待授权（prompt）处理', { error: String(error) });
    return 'prompt';
  }
}

// ── 公开 API ──────────────────────────────────────────

/** 对当前页面生效目录做一次 fromcode 自检 */
export async function checkTargetDirectoryHealth(
  tab: TabInfo | number,
  pageType: string,
): Promise<TargetDirectoryCheckResult> {
  const platformKey = getPlatformKeyFromPageType(pageType);
  const resolved = await resolveTargetDirectorySelection(tab, pageType);

  if (!resolved) {
    return { health: 'unbound', source: 'none', platformKey, label: '' };
  }

  const handle = resolved.handle;
  const base = {
    source: resolved.source as TargetDirectorySource,
    platformKey,
    label: handle.name || '',
    handle,
  };
  const pageUrl = typeof tab === 'object' ? (tab.url || tab.pendingUrl || '') : '';

  // 无表单编码的页面不参与 fromcode 机制
  if (!extractPageFormCode(pageUrl, pageType)) {
    return { health: 'ok', ...base };
  }

  const fromcodeStatus = await verifyDirectoryFromcode(handle, pageUrl, pageType, resolved.pageScope);
  if (fromcodeStatus === 'matched' || fromcodeStatus === 'skipped') {
    return { health: 'ok', ...base };
  }
  if (fromcodeStatus === 'missing') {
    return { health: 'fromcode-missing', ...base };
  }
  if (fromcodeStatus === 'mismatched') {
    let fromcodeValue: string | null = null;
    try {
      fromcodeValue = await readDirectoryFromcode(handle);
    } catch {
      fromcodeValue = null;
    }
    return { health: 'fromcode-mismatched', ...base, fromcodeValue: fromcodeValue ?? '' };
  }

  const permission = await queryPermissionSafely(handle);
  return {
    health: permission === 'prompt' ? 'permission-prompt' : 'permission-denied',
    ...base,
  };
}
