/**
 * 扩展配置形状（chrome.storage.local 持久化的用户设置）。
 *
 * 说明：产物（生成物）配置已独立为 `ArtifactConfig`，见 `types/artifacts.ts` 与
 * `services/artifacts.ts`，本模块只保留与产物无关的通用设置。
 */

import type { PlatformKey } from './platform.js';

export interface ExtensionConfig {
  readonly h3yunOneClickWriteback: boolean;
  /** 平台兜底目录路径 */
  readonly fallbackDirectoryPaths: Partial<Record<PlatformKey, string>>;
}
