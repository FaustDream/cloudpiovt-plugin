/**
 * 产物文件生成服务。
 *
 * 按产物配置生成「静态模板类」产物：
 * - 统一覆盖策略：补建缺失，不覆盖已有内容（因此变量只在首次生成时替换一次）
 * - 只声明目录的产物（`fileName` 为空）只建文件夹，不产出文件
 *
 * 抓取类产物（FromCode / HTML / CSS / JS / Java / C#）由 popup 抓取链路直接处理，
 * 不走本模块。
 */

import type { ArtifactDefinition } from '../types/artifacts.js';
import { cleanMultilineText, normalizeArtifactPath } from '../lib/utils.js';
import {
  createArtifactTemplateContext,
  renderArtifactTemplate,
  type ArtifactTemplateContext,
} from '../lib/platform/artifacts.js';

/** 模板插值所需的抓取上下文 */
export interface ArtifactFileInput {
  readonly pageUrl?: string;
  readonly appCode?: string;
  readonly formCode?: string;
  readonly formName?: string;
  readonly mainTableCode?: string;
  readonly platformKey?: string;
  readonly platformLabel?: string;
  readonly pageLabel?: string;
}

export interface ArtifactFileOptions {
  /** 目标目录中已存在的相对路径集合（小写比较），用于「补建缺失」门控 */
  readonly existingPaths?: ReadonlySet<string>;
  /** 本次一次性覆盖：产物 id → 是否启用（齿轮弹层的「本次」选择） */
  readonly overrides?: Readonly<Record<string, boolean>>;
}

export interface ArtifactFile {
  /** 相对目标目录的路径；只建目录时以 `/` 结尾 */
  readonly relativePath: string;
  readonly content: string;
}

/** 目录路径结尾标记（只建文件夹的产物） */
export const DIRECTORY_PATH_SUFFIX = '/';

/** 把已存在路径列表转为小写集合，便于大小写不敏感比较 */
export function toExistingPathSet(paths: readonly string[]): ReadonlySet<string> {
  return new Set(paths.map((path) => String(path ?? '').trim().toLowerCase()).filter(Boolean));
}

/** 该产物是否为「只建文件夹」（无文件名） */
export function isDirectoryOnlyArtifact(artifact: ArtifactDefinition): boolean {
  return !String(artifact.fileName ?? '').trim();
}

/** 解析某条产物在本次抓取中是否启用（弹窗已保存的范围优先于设置页配置） */
export function resolveArtifactEnabled(
  artifact: ArtifactDefinition,
  overrides?: Readonly<Record<string, boolean>>,
): boolean {
  const override = overrides?.[artifact.id];
  return typeof override === 'boolean' ? override : artifact.enabled;
}

/**
 * 生成本次需要补建的模板类产物。
 *
 * 「只建文件夹」的产物不做存在性门控 —— `getDirectoryHandle({ create: true })` 本身幂等，
 * 重复写入不会产生副作用，交给写入层处理即可。
 */
export function buildMissingArtifactFiles(
  artifacts: readonly ArtifactDefinition[],
  input: ArtifactFileInput = {},
  options: ArtifactFileOptions = {},
): ArtifactFile[] {
  const context: ArtifactTemplateContext = createArtifactTemplateContext(input);
  const existingPaths = options.existingPaths ?? new Set<string>();
  const files: ArtifactFile[] = [];

  for (const artifact of artifacts) {
    if (artifact.kind !== 'template') continue;
    if (!resolveArtifactEnabled(artifact, options.overrides)) continue;

    const relativePath = normalizeArtifactPath(artifact.dirPath, artifact.fileName);
    if (!relativePath) continue;

    const directoryOnly = isDirectoryOnlyArtifact(artifact);
    if (!directoryOnly && existingPaths.has(relativePath.toLowerCase())) continue;

    const content = directoryOnly ? '' : cleanMultilineText(renderArtifactTemplate(artifact.defaultContent, context));
    files.push({ relativePath, content: content ? `${content}\n` : '' });
  }

  return files;
}
