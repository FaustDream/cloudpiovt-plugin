/**
 * 目录选择与句柄解析状态（仅页面 scope 记忆）。
 *
 * 新版语义（替代旧版共享槽回退）：
 * - 页面已绑定时，目录记忆粒度 = 页面业务实例(scope)，页面间永不串用；
 * - 页面未绑定时，展示与读写统一回退到当前平台自己的默认目录句柄；
 * - 展示路径、选择器 startIn、文件读写和权限检查共用同一有效句柄解析结果；
 * - 旧共享槽（pageType 全局句柄、平台 LAST_DIRECTORY）已整体退役，
 *   通过 cleanupLegacyDirectoryData() 在扩展启动时清理。
 */

import { logger } from '../lib/logger.js';
import { STORAGE_KEYS } from '../lib/constants.js';
import { createTargetDirectoryPageScope, saveTargetDirectoryPathByScope, clearTargetDirectoryPathsByScopePrefix, clearTargetDirectorySnapshotsByScopePrefix } from './target-directory-session.js';
import { getTargetDirectoryHandleForScope, clearTargetDirectoryHandleForScope, saveTargetDirectoryHandleForScope, clearTargetDirectoryHandlesByScopePrefix, clearAllTargetDirectoryHandles, getDefaultDirectoryHandle } from '../lib/directory/file-handle-db.js';
import { addRecentTargetDirectory } from './recent-target-directories.js';
import { getPlatformKeyFromPageType } from './config.js';
import type { PlatformKey } from '../types/platform.js';

interface TabInfo {
  readonly id?: number;
  readonly url?: string;
  readonly pendingUrl?: string;
}

// ── 有效目录解析 ──────────────────────────────────────

export type TargetDirectorySource = 'page' | 'platform-default';

export interface ResolvedTargetDirectory {
  readonly handle: FileSystemDirectoryHandle;
  readonly source: TargetDirectorySource;
  readonly platformKey: PlatformKey;
  readonly pageScope: string;
}

/**
 * 解析当前页面真正使用的目录句柄。
 *
 * 页面绑定句柄优先；页面没有绑定时才使用当前平台的默认句柄。展示、选择器
 * startIn、文件读写和权限检查都必须使用这个解析结果，避免不同链路各自回退
 * 到不同目录。
 */
export async function resolveTargetDirectorySelection(
  tab: TabInfo | number,
  pageType: string,
): Promise<ResolvedTargetDirectory | undefined> {
  const pageScope = createTargetDirectoryPageScope(tab, pageType);
  const platformKey = getPlatformKeyFromPageType(pageType);
  if (pageScope) {
    const pageHandle = await getTargetDirectoryHandleForScope(pageScope);
    if (pageHandle) return { handle: pageHandle, source: 'page', platformKey, pageScope };
  }

  const defaultHandle = await getDefaultDirectoryHandle(platformKey);
  if (!defaultHandle) return undefined;
  return { handle: defaultHandle, source: 'platform-default', platformKey, pageScope };
}

/**
 * 获取页面当前有效目录的展示名称。
 *
 * 只从 resolveTargetDirectorySelection 读取句柄名称，不读取独立的路径快照或
 * 最近使用记录，保证页面显示的目录与后续实际使用的句柄保持同一数据源。
 */
export async function getStoredDirectoryPath(
  tab: TabInfo | number,
  pageType: string,
): Promise<string> {
  const resolved = await resolveTargetDirectorySelection(tab, pageType);
  return resolved?.handle.name || '';
}

// ── 选择目录后同步落库 ────────────────────────────────

/**
 * 选择 Handle 目录后绑定到当前页面 scope：
 * - 仅写「页面级句柄 + 页面级路径 + 最近使用历史」，不写任何全局/平台共享槽
 *   （旧版会覆盖 pageType 全局句柄与 LAST_DIRECTORY，导致多页面互相污染）。
 * - 展示与读写均通过 scope 句柄解析，后续不会被其他页面的选择覆盖。
 */
export async function saveHandleSelection(
  handle: FileSystemDirectoryHandle,
  tab: TabInfo | number,
  pageType = 'default',
): Promise<{ handleModeSelected: boolean; path: string; label: string }> {
  const pageScope = createTargetDirectoryPageScope(tab, pageType);

  const label = handle.name || '';
  await addRecentTargetDirectory(label, pageType, pageScope || undefined);
  if (pageScope) {
    // 绑定页面级句柄 + 路径快照（目录名）
    await saveTargetDirectoryHandleForScope(handle, pageScope);
    await saveTargetDirectoryPathByScope(pageScope, label);
  }

  return { handleModeSelected: true, path: '', label };
}

/**
 * 解析当前页面实际使用的目录句柄。
 *
 * 回退顺序与 getStoredDirectoryPath（展示）完全一致：页面 scope 句柄 → 当前平台
 * 默认句柄 → undefined。不同页面不会共享页面 scope，云枢与氚云也不会共享默认句柄。
 */
export async function resolveTargetDirectoryHandle(
  tab: TabInfo | number,
  pageType: string,
): Promise<FileSystemDirectoryHandle | undefined> {
  const resolved = await resolveTargetDirectorySelection(tab, pageType);
  return resolved?.handle;
}

// ── 标签页关闭清理 ────────────────────────────────────

/**
 * 标签页关闭时清理该 tabId 下的所有存储项。
 * 覆盖：Handle、路径、快照标记。
 */
export async function clearTabTargetDirectoryData(
  tabId: number,
  pageType = 'default',
): Promise<void> {
  const suffix = `${String(pageType || '').trim()}:`;

  // 清理 Handle 通道数据
  await clearTargetDirectoryHandlesByScopePrefix(`tab:${tabId}:`);
  // 清理 Handle 通道页面级句柄
  await clearTargetDirectoryHandleForScope(`tab:${tabId}:`);
  // 清理路径通道
  await clearTargetDirectoryPathsByScopePrefix(`tab:${tabId}:${suffix}`);
  // 清理快照标记
  await clearTargetDirectorySnapshotsByScopePrefix(`tab:${tabId}:${suffix}`);

  logger.debug('Cleared target directory data for tab', { tabId, pageType });
}

// ── 旧共享槽迁移清洗（启动时幂等执行） ─────────────────

/**
 * 清理旧版「共享槽」遗留数据，防止继续污染新逻辑：
 * - IndexedDB：页类型全局句柄（target-directory:<pageType>）
 * - chrome.storage.local：
 *   - LAST_DIRECTORY（平台「上次选择目录」，仅存目录名不可靠）
 *   - targetDirectoryPageTypePaths（页类型全局路径）
 *   - targetDirectoryPagePaths / targetDirectoryPageSnapshots（旧假 scope 路径快照）
 *
 * 保留：页面级 scope 句柄（历史恢复依赖）、平台默认目录句柄、最近使用历史列表。
 * 幂等：数据不存在时删除无副作用。
 */
export async function cleanupLegacyDirectoryData(): Promise<void> {
  try {
    await clearAllTargetDirectoryHandles();
    await chrome.storage.local.remove([
      STORAGE_KEYS.LAST_DIRECTORY,
      'targetDirectoryPageTypePaths',
      'targetDirectoryPagePaths',
      'targetDirectoryPageSnapshots',
    ]);
    logger.info('Cleaned up legacy shared directory slots');
  } catch (error: unknown) {
    logger.warn('Legacy directory cleanup failed', { error: String(error) });
  }
}