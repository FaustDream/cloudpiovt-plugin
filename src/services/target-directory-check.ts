/**
 * 目标目录自检（仅判断可用性）。
 *
 * 只回答「有没有绑定目录」「句柄权限是否正常」两个问题。目录归属完全由用户自己判断：
 * 扩展不再比对表单编码，也不读取目录内的任何标记文件。
 */

import { logger } from '../lib/logger.js';
import { getPlatformKeyFromPageType } from './config.js';
import { queryHandlePermissionState, type DirectoryPermissionState } from './target-directory-access.js';
import { resolveTargetDirectorySelection, type ResolvedTargetDirectory } from './target-directory-state.js';
import type { PlatformKey } from '../types/platform.js';

interface TabInfo {
  readonly id?: number;
  readonly url?: string;
  readonly pendingUrl?: string;
}

// ── 结论类型 ──────────────────────────────────────────

export type TargetDirectoryHealth =
  | 'ok' // 已绑定且权限正常
  | 'unbound' // 当前平台没有任何可用句柄
  | 'permission-prompt' // 权限为 prompt（浏览器重启后的正常待授权状态）
  | 'permission-denied'; // 权限为 denied（用户明确拒绝）

export type TargetDirectorySource = ResolvedTargetDirectory['source'] | 'none';

export interface TargetDirectoryCheckResult {
  readonly health: TargetDirectoryHealth;
  readonly source: TargetDirectorySource;
  readonly platformKey: PlatformKey;
  /** 目录名（File System Access 只暴露目录名，不暴露完整路径） */
  readonly label: string;
  readonly handle?: FileSystemDirectoryHandle;
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

/** 对当前页面生效目录做一次可用性自检 */
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

  const permission = await queryPermissionSafely(handle);
  if (permission === 'granted') return { health: 'ok', ...base };
  if (permission === 'prompt') return { health: 'permission-prompt', ...base };
  return { health: 'permission-denied', ...base };
}
