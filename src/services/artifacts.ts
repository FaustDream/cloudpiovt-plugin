/**
 * 产物配置读写服务。
 *
 * 负责：
 * - 从 `chrome.storage.local` 读取 / 保存产物配置
 * - 首次升级时从旧版 `generatedFiles` 逐字段开关迁移
 * - 与内置产物定义做合并（保证后续版本新增的内置产物能出现在已有配置里）
 *
 * 迁移规则（沿用老值，不重置）：
 * - `fromCode` / `html` / `css` / `js` / `cs` / `readme` / `agents` 原样沿用
 * - 云枢 `design` 沿用布尔值（语义由 `DESIGN.md` 变为 `design/` 文件夹）
 * - 氚云 `design: true` 一拆二为 `designJs` + `designCs` 都开
 * - 新增产物（云枢 `java` / `sql`）保留各自默认值
 */

import type { ArtifactConfig, ArtifactDefinition } from '../types/artifacts.js';
import type { PlatformKey } from '../types/platform.js';
import { PLATFORM_KEY_CLOUDPIVOT, PLATFORM_KEY_H3YUN, STORAGE_KEYS } from '../lib/constants.js';
import {
  ARTIFACT_IDS,
  CUSTOM_ARTIFACT_ID_PREFIX,
  buildDefaultArtifactConfig,
  buildDefaultArtifacts,
} from '../lib/platform/artifacts.js';
import { logger } from '../lib/logger.js';

/** 全部平台标识（顺序即设置页展示顺序） */
export const ARTIFACT_PLATFORM_KEYS: readonly PlatformKey[] = [PLATFORM_KEY_CLOUDPIVOT, PLATFORM_KEY_H3YUN];

/** 新产物默认的初始值（用户点「新建产物」时使用） */
export const NEW_ARTIFACT_DEFAULTS = {
  label: '新建产物',
  dirPath: '',
  fileName: 'NEW.md',
  enabled: true,
  defaultContent: '# 新建产物\n',
} as const;

// ── 旧配置迁移映射 ────────────────────────────────────

/** 产物 id → 旧 generatedFiles 字段名（缺失表示该产物为新增，保留默认值） */
const LEGACY_FLAG_BY_ARTIFACT: Record<PlatformKey, Record<string, string>> = {
  [PLATFORM_KEY_CLOUDPIVOT]: {
    [ARTIFACT_IDS.fromCode]: 'fromCode',
    [ARTIFACT_IDS.html]: 'html',
    [ARTIFACT_IDS.css]: 'css',
    [ARTIFACT_IDS.js]: 'js',
    [ARTIFACT_IDS.readme]: 'readme',
    [ARTIFACT_IDS.agents]: 'agents',
  },
  [PLATFORM_KEY_H3YUN]: {
    [ARTIFACT_IDS.fromCode]: 'fromCode',
    [ARTIFACT_IDS.js]: 'js',
    [ARTIFACT_IDS.cs]: 'cs',
    [ARTIFACT_IDS.readme]: 'readme',
    [ARTIFACT_IDS.agents]: 'agents',
  },
};

/** 氚云 design 一拆二：老 design:true 映射为 designJs + designCs 都开 */
const H3YUN_SPLIT_DESIGN_IDS: readonly string[] = [ARTIFACT_IDS.designJs, ARTIFACT_IDS.designCs];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 按旧 generatedFiles 配置迁移单个平台 */
function migratePlatformArtifacts(platformKey: PlatformKey, legacyFlags: Record<string, unknown>): ArtifactDefinition[] {
  const legacyFlagByArtifact = LEGACY_FLAG_BY_ARTIFACT[platformKey];
  return buildDefaultArtifacts(platformKey).map((artifact) => {
    if (platformKey === PLATFORM_KEY_H3YUN && H3YUN_SPLIT_DESIGN_IDS.includes(artifact.id)) {
      return { ...artifact, enabled: legacyFlags.design === true };
    }
    if (platformKey === PLATFORM_KEY_CLOUDPIVOT && artifact.id === ARTIFACT_IDS.design) {
      return { ...artifact, enabled: legacyFlags.design === true };
    }
    const legacyKey = legacyFlagByArtifact[artifact.id];
    if (!legacyKey) return artifact;
    return { ...artifact, enabled: legacyFlags[legacyKey] === true };
  });
}

function migrateFromLegacyGeneratedFiles(raw: unknown): ArtifactConfig | null {
  if (!isPlainObject(raw)) return null;
  const result = buildDefaultArtifactConfig();
  for (const platformKey of ARTIFACT_PLATFORM_KEYS) {
    const platformRaw = raw[platformKey];
    if (!isPlainObject(platformRaw)) continue;
    result[platformKey] = migratePlatformArtifacts(platformKey, platformRaw);
  }
  logger.info('Migrated artifact config from legacy generatedFiles');
  return result;
}

// ── 归一化 ────────────────────────────────────────────

/** 单条产物归一化；形状非法返回 null */
function normalizeArtifact(value: unknown): ArtifactDefinition | null {
  if (!isPlainObject(value)) return null;
  const id = String(value.id ?? '').trim();
  if (!id) return null;
  const kind = value.kind === 'capture' ? 'capture' : 'template';
  return {
    id,
    kind,
    label: String(value.label ?? '').trim() || id,
    dirPath: String(value.dirPath ?? '').trim(),
    fileName: String(value.fileName ?? '').trim(),
    enabled: value.enabled === true,
    defaultContent: typeof value.defaultContent === 'string' ? value.defaultContent : '',
    builtin: value.builtin === true,
  };
}

/**
 * 归一化整个平台的产物配置。
 *
 * 以内置产物清单为骨架：已存的内置项按 id 取值（保留用户改动），
 * 代码新增的内置项补默认值，代码已删除的内置项丢弃；
 * 用户新建产物（`custom:` 前缀）追加在末尾。
 */
function normalizePlatformArtifacts(platformKey: PlatformKey, stored: unknown): ArtifactDefinition[] {
  const defaults = buildDefaultArtifacts(platformKey);
  if (!Array.isArray(stored)) return defaults;

  const storedById = new Map<string, ArtifactDefinition>();
  const customArtifacts: ArtifactDefinition[] = [];
  for (const item of stored) {
    const normalized = normalizeArtifact(item);
    if (!normalized) continue;
    if (normalized.id.startsWith(CUSTOM_ARTIFACT_ID_PREFIX)) {
      if (!normalized.builtin) customArtifacts.push(normalized);
      continue;
    }
    storedById.set(normalized.id, normalized);
  }

  const merged = defaults.map((artifact) => storedById.get(artifact.id) ?? artifact);
  return [...merged, ...customArtifacts];
}

/** 归一化完整产物配置 */
export function normalizeArtifactConfig(value: unknown): ArtifactConfig {
  const defaults = buildDefaultArtifactConfig();
  if (!isPlainObject(value)) return defaults;

  const result = { ...defaults };
  for (const platformKey of ARTIFACT_PLATFORM_KEYS) {
    result[platformKey] = normalizePlatformArtifacts(platformKey, value[platformKey]);
  }
  return result;
}

// ── 读写 ──────────────────────────────────────────────

/** 读取产物配置（含一次性旧配置迁移） */
export async function loadArtifactConfig(): Promise<ArtifactConfig> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ARTIFACTS,
    STORAGE_KEYS.GENERATED_FILES,
  ]);

  const artifactsRaw = stored[STORAGE_KEYS.ARTIFACTS];
  if (artifactsRaw !== undefined && artifactsRaw !== null) {
    return normalizeArtifactConfig(artifactsRaw);
  }

  const migrated = migrateFromLegacyGeneratedFiles(stored[STORAGE_KEYS.GENERATED_FILES]);
  if (migrated) {
    await saveArtifactConfig(migrated);
    return migrated;
  }

  return buildDefaultArtifactConfig();
}

/** 保存产物配置（先归一化再落盘） */
export async function saveArtifactConfig(config: ArtifactConfig): Promise<ArtifactConfig> {
  const normalized = normalizeArtifactConfig(config);
  await chrome.storage.local.set({ [STORAGE_KEYS.ARTIFACTS]: normalized });
  return normalized;
}

/** 恢复出厂产物配置并落盘 */
export async function resetArtifactConfig(): Promise<ArtifactConfig> {
  const defaults = buildDefaultArtifactConfig();
  await chrome.storage.local.set({ [STORAGE_KEYS.ARTIFACTS]: defaults });
  return defaults;
}

/** 生成用户新建产物的唯一 id */
export function createCustomArtifactId(): string {
  return `${CUSTOM_ARTIFACT_ID_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 构造一条用户新建产物 */
export function createCustomArtifact(): ArtifactDefinition {
  return {
    id: createCustomArtifactId(),
    kind: 'template',
    label: NEW_ARTIFACT_DEFAULTS.label,
    dirPath: NEW_ARTIFACT_DEFAULTS.dirPath,
    fileName: NEW_ARTIFACT_DEFAULTS.fileName,
    enabled: NEW_ARTIFACT_DEFAULTS.enabled,
    defaultContent: NEW_ARTIFACT_DEFAULTS.defaultContent,
    builtin: false,
  };
}

/** 取指定平台的产物列表（缺失时返回内置默认） */
export function getPlatformArtifacts(config: ArtifactConfig, platformKey: PlatformKey): ArtifactDefinition[] {
  return config[platformKey] ?? buildDefaultArtifacts(platformKey);
}
