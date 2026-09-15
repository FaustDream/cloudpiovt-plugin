/**
 * 产物（生成物）配置形状。
 *
 * 产物分两类：
 * - `capture`：抓取类产物，内容来自页面抓取，只暴露开关（路径 / 内容不可编辑）。
 * - `template`：静态模板类产物，5 个字段全可编辑（名称 / 路径 / 文件名 / 开关 / 默认内容）。
 *
 * 说明：本模块的字段刻意不加 `readonly` —— 产物配置由设置页直接增删改，
 * 全程使用可变对象可避免大量无意义的不可变拷贝，降低编辑器侧复杂度。
 */

import type { PlatformKey } from './platform.js';

/** 产物类别 */
export type ArtifactKind = 'capture' | 'template';

/** 单条产物定义 */
export interface ArtifactDefinition {
  /** 稳定标识：内置产物用固定常量，用户新建产物用生成的 id */
  id: string;
  /** 产物类别：决定设置页归属分区与可编辑字段 */
  kind: ArtifactKind;
  /** 设置页显示名（仅用于展示，不参与文件生成） */
  label: string;
  /** 相对目标目录的路径；空字符串表示根目录 */
  dirPath: string;
  /** 文件名；空字符串表示只创建文件夹 */
  fileName: string;
  /** 是否参与生成 */
  enabled: boolean;
  /** 默认内容模板（仅 template 类使用，支持 `{{变量}}` 插值） */
  defaultContent: string;
  /** 是否为内置产物（内置产物不可删除） */
  builtin: boolean;
}

/** 按平台组织的产物配置 */
export type ArtifactConfig = Record<PlatformKey, ArtifactDefinition[]>;
