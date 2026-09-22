/**
 * 「更新范围」多选模型与逐项联动规则（纯逻辑，不引用 chrome.*）。
 *
 * 交互契约（主按钮 + 下拉多选）：
 * - 下拉 = 该抓取入口的**文件选项清单**，每个文件独立一行展示（不再有「全部 / 仅控件 / 仅前端」
 *   这类聚合项与说明文字）；勾选 = 本次抓取并写入该文件，取消 = 本次跳过该文件。
 * - 选项由设置页产物配置**动态读取**（`buildScopeOptions`）：设置页新增的内置产物或用户新建
 *   产物会自动出现在下拉中，本模块不维护任何产物清单，因此新增文件无需改动范围逻辑。
 * - 下拉的勾选会**保存**（见 `ArtifactScopeOverrides`）：关闭 / 重新打开弹窗后仍按上次选择还原；
 *   设置页产物配置仍是文件清单与默认值的来源，「恢复为设置页配置」即清除保存的选择。
 * - 空范围（一项都没启用）视为无效，调用方应禁用主按钮并提示。
 *
 * 单一真源 = 「当前启用的产物 id 集合」，范围状态（是否全部 / 计数 / 文案）由它反解。
 */

import type { ArtifactDefinition } from '../../types/artifacts.js';
import type { PlatformKey } from '../../types/platform.js';
import { PLATFORM_KEY_CLOUDPIVOT, PLATFORM_KEY_H3YUN } from '../constants.js';

/** 下拉中的一个文件选项（由设置页产物配置动态生成） */
export interface ArtifactScopeOption {
  readonly id: string;
  /** 完整名称（设置页显示名），用于鼠标悬浮提示 */
  readonly label: string;
  /** 下拉显示名：去掉名称末尾括号里的补充说明，避免窄面板里被截断 */
  readonly displayLabel: string;
}

/**
 * 下拉显示名：去掉名称**末尾**括号内的补充说明。
 *
 * 设置页产物名常写成「FromCode.md（字段/控件编码）」，在 236px 宽的下拉里会被截断成
 * 「FromCode.md（字段/控…」，因此列表只显示主体名称，完整名称留给 `title` 悬浮提示。
 * 括号内容被剥空时（如「（仅说明）」）保留原名，避免出现空行。
 */
export function toScopeDisplayLabel(label: string): string {
  const trimmed = String(label ?? '').trim();
  const stripped = trimmed.replace(/[（(][^（()）]*[)）]\s*$/, '').trim();
  return stripped || trimmed;
}

/**
 * 动态读取某个抓取入口的文件选项。
 *
 * 以设置页产物配置为唯一数据源（`label` 即选项文案，与设置页显示一致），并按入口裁剪：
 * 内置产物、用户新建产物、后续版本新增的产物都无需改动本模块即可出现在下拉中。
 *
 * @param artifacts 该平台的全部产物配置（设置页「文件助手」列表）
 * @param entryArtifactIds 该抓取入口涉及的产物 id（含模板类）
 */
export function buildScopeOptions(
  artifacts: readonly ArtifactDefinition[],
  entryArtifactIds: readonly string[],
): readonly ArtifactScopeOption[] {
  const entryIds = new Set(entryArtifactIds);
  return artifacts
    .filter((artifact) => entryIds.has(artifact.id))
    .map((artifact) => ({
      id: artifact.id,
      label: artifact.label,
      displayLabel: toScopeDisplayLabel(artifact.label),
    }));
}

/** 范围输入：入口文件选项 + 本次启用的产物 id */
export interface ArtifactScopeInput {
  readonly options: readonly ArtifactScopeOption[];
  readonly enabledIds: readonly string[];
}

/** 范围状态（由「启用的产物 id」反解，用于按钮徽标与提示文案） */
export interface ArtifactScopeState {
  /** 是否全部启用（= 入口文件全部启用） */
  readonly isAll: boolean;
  /** 是否空范围（一项都没启用） */
  readonly isEmpty: boolean;
  readonly enabledCount: number;
  readonly totalCount: number;
  /** 本次启用的选项（按入口顺序，用于摘要文案） */
  readonly enabledOptions: readonly ArtifactScopeOption[];
}

/** 反解当前范围状态 */
export function resolveArtifactScopeState(input: ArtifactScopeInput): ArtifactScopeState {
  const enabled = new Set(input.enabledIds);
  const enabledOptions = input.options.filter((option) => enabled.has(option.id));
  const enabledCount = enabledOptions.length;
  const totalCount = input.options.length;

  return {
    isAll: totalCount > 0 && enabledCount === totalCount,
    isEmpty: enabledCount === 0,
    enabledCount,
    totalCount,
    enabledOptions,
  };
}

/**
 * 产物级勾选：勾选 / 取消单个文件。
 * @returns 按入口顺序排列的启用产物 id（调用方据此保存新的范围选择）
 */
export function toggleScopeArtifact(
  input: ArtifactScopeInput,
  artifactId: string,
  on: boolean,
): readonly string[] {
  const enabled = new Set(input.enabledIds);
  if (on) enabled.add(artifactId);
  else enabled.delete(artifactId);
  return input.options.filter((option) => enabled.has(option.id)).map((option) => option.id);
}

/**
 * 范围徽标文案（主按钮旁的范围按钮显示，要求短）：
 * 全部 / 未选择 / 已选数量（如「3项」）。
 */
export function formatArtifactScopeBadge(state: ArtifactScopeState): string {
  if (state.isEmpty) return '未选择';
  if (state.isAll) return '全部';
  return `${state.enabledCount}项`;
}

/** 摘要中最多列出的文件数（超出以「等」收尾，避免按钮提示过长） */
const SUMMARY_LABEL_LIMIT = 3;

/** 范围摘要文案（按钮 title 提示用：列出本次启用的文件与计数） */
export function formatArtifactScopeSummary(state: ArtifactScopeState): string {
  if (state.isEmpty) return '未选择';

  const count = `${state.enabledCount}/${state.totalCount} 项`;
  if (state.isAll) return `全部（${count}）`;

  const labels = state.enabledOptions.map((option) => option.displayLabel);
  const shown = labels.slice(0, SUMMARY_LABEL_LIMIT).join('、');
  const omitted = labels.length > SUMMARY_LABEL_LIMIT ? ' 等' : '';
  return `${shown}${omitted}（${count}）`;
}

// ── 保存的范围选择（弹窗下拉的持久化状态） ─────────────

/** 平台标识白名单（校验存储输入用） */
const KNOWN_PLATFORM_KEYS: readonly PlatformKey[] = [PLATFORM_KEY_CLOUDPIVOT, PLATFORM_KEY_H3YUN];

/**
 * 已保存的范围选择：平台 → (产物 id → 是否启用)。
 *
 * 与设置页产物配置分开存储（设置页仍是文件清单与默认值的来源），因此：
 * - 弹窗下拉的勾选在关闭 / 重新打开弹窗后按此还原；
 * - 缺少某个平台键表示该平台完全使用设置页配置（下拉里所有文件按设置页开关显示）。
 */
export type ArtifactScopeOverrides = Partial<Record<PlatformKey, Readonly<Record<string, boolean>>>>;

/** 取某平台保存的覆盖表（无记录返回空表） */
export function platformScopeOverrides(
  overrides: ArtifactScopeOverrides | null | undefined,
  platformKey: PlatformKey,
): Record<string, boolean> {
  const platformOverrides = overrides?.[platformKey];
  return platformOverrides ? { ...platformOverrides } : {};
}

/** 某平台是否存在已保存的范围选择（决定是否显示「恢复为设置页配置」） */
export function hasPlatformScopeOverrides(
  overrides: ArtifactScopeOverrides | null | undefined,
  platformKey: PlatformKey,
): boolean {
  return Object.keys(overrides?.[platformKey] ?? {}).length > 0;
}

/**
 * 写入某平台的范围选择。
 *
 * 入口内的每个产物都写入明确的布尔值（true = 选中、false = 未选中），
 * 这样「取消勾选」也能被记住，不会在重新打开后回退成设置页的默认选中。
 */
export function withPlatformScopeOverrides(
  overrides: ArtifactScopeOverrides | null | undefined,
  platformKey: PlatformKey,
  enabledIds: readonly string[],
  entryArtifactIds: readonly string[],
): ArtifactScopeOverrides {
  const enabled = new Set(enabledIds);
  const platformOverrides: Record<string, boolean> = {};
  for (const artifactId of entryArtifactIds) platformOverrides[artifactId] = enabled.has(artifactId);
  return { ...(overrides ?? {}), [platformKey]: platformOverrides };
}

/** 清除某平台的范围选择（该平台回到设置页配置）；无剩余平台时返回 null */
export function withoutPlatformScopeOverrides(
  overrides: ArtifactScopeOverrides | null | undefined,
  platformKey: PlatformKey,
): ArtifactScopeOverrides | null {
  if (!overrides?.[platformKey]) return overrides ?? null;

  const next: Partial<Record<PlatformKey, Readonly<Record<string, boolean>>>> = { ...overrides };
  delete next[platformKey];
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * 校验外部输入（`chrome.storage` 读取结果）的范围选择结构。
 *
 * 只接受 `{ [平台]: { [产物 id]: boolean } }`：平台标识、产物 id、取值任一非法即丢弃该项；
 * 没有任何有效内容时返回 null（等同「全部使用设置页配置」）。
 */
export function normalizeScopeOverrides(value: unknown): ArtifactScopeOverrides | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const result: Partial<Record<PlatformKey, Record<string, boolean>>> = {};
  for (const platformKey of KNOWN_PLATFORM_KEYS) {
    const platformValue = raw[platformKey];
    if (!platformValue || typeof platformValue !== 'object' || Array.isArray(platformValue)) continue;

    const enabledById: Record<string, boolean> = {};
    for (const [artifactId, enabled] of Object.entries(platformValue as Record<string, unknown>)) {
      if (artifactId && typeof enabled === 'boolean') enabledById[artifactId] = enabled;
    }
    if (Object.keys(enabledById).length > 0) result[platformKey] = enabledById;
  }

  return Object.keys(result).length > 0 ? result : null;
}
