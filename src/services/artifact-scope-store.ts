/**
 * 弹窗「更新范围」已保存选择的读写服务。
 *
 * 下拉勾选持久化在 `chrome.storage.local`（键 `artifactScopeOverrides`），与设置页产物配置分开：
 * - 关闭 / 重新打开弹窗后按上次选择还原（含「取消勾选」，不会被设置页默认值覆盖）；
 * - 「恢复为设置页配置」删除该记录，回到设置页开关；
 * - 读取结果一律经 `normalizeScopeOverrides` 校验，存储被外部改坏时按「无覆盖」处理。
 */

import { STORAGE_KEYS } from '../lib/constants.js';
import { normalizeScopeOverrides, type ArtifactScopeOverrides } from '../lib/platform/artifact-scope.js';

/** 读取已保存的范围选择；无记录或结构非法返回 null（= 全部使用设置页配置） */
export async function loadScopeOverrides(): Promise<ArtifactScopeOverrides | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.ARTIFACT_SCOPE_OVERRIDES);
  return normalizeScopeOverrides(stored[STORAGE_KEYS.ARTIFACT_SCOPE_OVERRIDES]);
}

/** 保存范围选择（整表覆盖写入） */
export async function saveScopeOverrides(overrides: ArtifactScopeOverrides): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.ARTIFACT_SCOPE_OVERRIDES]: overrides });
}

/** 清除范围选择（回到设置页配置） */
export async function clearScopeOverrides(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.ARTIFACT_SCOPE_OVERRIDES);
}
