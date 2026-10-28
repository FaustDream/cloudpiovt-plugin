/**
 * 产物默认定义与模板渲染（纯逻辑，不引用 chrome.*）。
 *
 * 职责：
 * - 声明云枢 / 氚云的内置产物清单与默认内容模板
 * - 提供 `{{变量}}` 扁平插值（无循环、无条件，保持"傻瓜式"）
 * - 提供产物路径规范化与重名校验
 */

import type { ArtifactConfig, ArtifactDefinition } from '../../types/artifacts.js';
import type { PlatformKey } from '../../types/platform.js';
import { PLATFORM_KEY_CLOUDPIVOT, PLATFORM_KEY_H3YUN, PLATFORM_LABELS } from '../constants.js';
import { normalizeArtifactPath } from '../utils.js';

// ── 产物标识常量 ──────────────────────────────────────

export const ARTIFACT_IDS = {
  fromCode: 'fromCode',
  html: 'html',
  css: 'css',
  js: 'js',
  java: 'java',
  cs: 'cs',
  readme: 'readme',
  agents: 'agents',
  design: 'design',
  sql: 'sql',
  designJs: 'designJs',
  designCs: 'designCs',
} as const;

/** 用户新建产物的 id 前缀 */
export const CUSTOM_ARTIFACT_ID_PREFIX = 'custom:';

/**
 * FromCode.md 固定文件名。
 * FromCode 是数据驱动产物（内容由抓取的控件渲染），文件名不参与用户配置。
 */
export const FROM_CODE_FILE_NAME = 'FromCode.md';

/** 云枢 fileMappings 的 key → 产物 id（`javascript` 对应产物 id `js`） */
export const FILE_MAPPING_KEY_TO_ARTIFACT_ID: Readonly<Record<string, string>> = {
  html: 'html',
  css: 'css',
  javascript: 'js',
};

// ── 模板变量 ──────────────────────────────────────────

/** 模板变量：`token` 为 `{{}}` 内的字面量，`label` 为设置页按钮文案 */
export interface ArtifactTemplateVariable {
  readonly token: string;
  readonly label: string;
}

/** 可供模板插值的变量清单（均为抓取上下文里现成的字段） */
export const ARTIFACT_TEMPLATE_VARIABLES: readonly ArtifactTemplateVariable[] = [
  { token: '页面地址', label: '页面地址' },
  { token: '应用编码', label: '应用编码' },
  { token: '表单编码', label: '表单编码' },
  { token: '表单名称', label: '表单名称' },
  { token: '主表编码', label: '主表编码' },
  { token: '平台', label: '平台' },
  { token: '页面类型', label: '页面类型' },
];

/** 模板插值上下文 */
export interface ArtifactTemplateContext {
  readonly pageUrl: string;
  readonly appCode: string;
  readonly formCode: string;
  readonly formName: string;
  readonly mainTableCode: string;
  readonly platformLabel: string;
  readonly pageLabel: string;
}

/** `{{变量}}` 匹配（允许变量名两侧有空白） */
const TEMPLATE_TOKEN_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** 构造模板上下文（外部输入统一转字符串并去空白） */
export function createArtifactTemplateContext(input: {
  pageUrl?: string;
  appCode?: string;
  formCode?: string;
  formName?: string;
  mainTableCode?: string;
  platformKey?: string;
  platformLabel?: string;
  pageLabel?: string;
}): ArtifactTemplateContext {
  const platformKey: PlatformKey = input.platformKey === PLATFORM_KEY_H3YUN ? PLATFORM_KEY_H3YUN : PLATFORM_KEY_CLOUDPIVOT;
  return {
    pageUrl: String(input.pageUrl ?? '').trim(),
    appCode: String(input.appCode ?? '').trim(),
    formCode: String(input.formCode ?? '').trim(),
    formName: String(input.formName ?? '').trim(),
    mainTableCode: String(input.mainTableCode ?? '').trim(),
    platformLabel: String(input.platformLabel ?? '').trim() || PLATFORM_LABELS[platformKey],
    pageLabel: String(input.pageLabel ?? '').trim(),
  };
}

/** 变量名 → 取值 */
function resolveTemplateVariable(token: string, context: ArtifactTemplateContext): string {
  switch (token) {
    case '页面地址': return context.pageUrl;
    case '应用编码': return context.appCode;
    case '表单编码': return context.formCode;
    case '表单名称': return context.formName;
    case '主表编码': return context.mainTableCode;
    case '平台': return context.platformLabel;
    case '页面类型': return context.pageLabel;
    // 未知变量原样保留，便于用户排查拼写
    default: return `{{${token}}}`;
  }
}

/** 渲染模板：替换全部 `{{变量}}` */
export function renderArtifactTemplate(template: string, context: ArtifactTemplateContext): string {
  return String(template ?? '').replace(TEMPLATE_TOKEN_PATTERN, (_match, token: string) =>
    resolveTemplateVariable(String(token ?? '').trim(), context),
  );
}

// ── 默认内容模板 ──────────────────────────────────────

const CLOUDPIVOT_README_TEMPLATE = ['# 需求文档', ''].join('\n');

const CLOUDPIVOT_AGENTS_TEMPLATE = [
  '# 当前目录 Agent 规则',
  '',
  '## 文件职责',
  '',
  '- **README.md**：用户写业务需求，AI 只读不写。',
  '- **FromCode.md**：插件抓取字段/控件/表单编码，人工只补业务含义，AI 只读不写。',
  '- **design/**：AI 根据 README + FromCode 维护技术实现方案，每个 Java 类或功能模块一份文档。',
  '- **AGENTS.md**：用户写本目录的 AI 执行规则和约束，AI 执行前必读。',
  '- **sql/**：业务集成相关的 SQL 脚本。',
  '',
  '## 执行顺序',
  '',
  '0. 先读根目录的 `AGENTS.md`，确认根目录整个项目的 Agent 规则。',
  '1. 先读 `README.md`，确认用户业务需求和验收标准。',
  '2. 再读 `FromCode.md`，确认字段编码、控件名称、控件类型和表单上下文。',
  '3. 在 `design/` 下按 Java 类或功能模块新建设计文档，整理实现方案、状态流转、参数传递、涉及文件和验证方式。',
  '4. 按本目录平台约束修改代码文件，避免改动无关文件。',
  '',
  '## 平台约束',
  '',
  '- 云枢代码包含前端 HTML/CSS/JS 和业务规则 Java；两类文件通过业务规则传参协作。',
  '- 云枢 JS 不写 Ajax 直连后端，需要服务端逻辑时先设计业务规则入参、返回值和异常提示。',
  '- 业务规则 Java 改动必须说明数据查询、写入、校验或状态流转原因。',
  '- 本文件夹下面的 java 代码都需要增加每次调用往本文件夹对应的表单写入一条日志数据。',
  '- 每次新增 java 文件都向 `design/` 追加对应业务逻辑说明。',
  '- 响应示例的编码都要加上中文名称注释。',
  '- **Java 注释**：只写业务逻辑含义，禁止出现「参见 design/ 某文档」这类跨文档引用。',
  '- **design/**：按 Java 类或功能模块分文件组织，每个类/模块独立一份文档，避免所有实现逻辑杂糅在一起。',
  '',
  '## 注释与验证',
  '',
  '- 修改 JS、CSS、Java 或 C# 时补充有业务价值的中文注释，说明用途、关键变量、状态流转和外部调用原因。',
  '- 未实际执行验证时，不得声称已经通过；无法验证时在 `design/` 或交付说明中写明原因。',
  '',
].join('\n');

const H3YUN_README_TEMPLATE = CLOUDPIVOT_README_TEMPLATE;

const H3YUN_AGENTS_TEMPLATE = [
  '# 当前目录 Agent 规则',
  '',
  '## 文件职责',
  '',
  '- **README.md**：用户写业务需求，AI 只读不写。',
  '- **FromCode.md**：插件抓取字段/控件/表单编码，人工只补业务含义，AI 只读不写。',
  '- **design/design-js.md**：AI 维护的前端 JS 实现方案。',
  '- **design/design-cs.md**：AI 维护的后端 C# 实现方案。',
  '- **AGENTS.md**：用户写本目录的 AI 执行规则和约束，AI 执行前必读。',
  '',
  '## 执行顺序',
  '',
  '0. 先读根目录的 `AGENTS.md`，确认根目录整个项目的 Agent 规则。',
  '1. 先读 `README.md`，确认用户业务需求和验收标准。',
  '2. 再读 `FromCode.md`，确认字段编码、控件名称、控件类型和表单上下文。',
  '3. 前端逻辑写入 `design/design-js.md`，后端逻辑写入 `design/design-cs.md`，写清状态流转、参数传递、涉及文件和验证方式。',
  '4. 按本目录平台约束修改代码文件，避免改动无关文件。',
  '',
  '## 平台约束',
  '',
  '- 氚云代码包含前端 `.vue` / `.js` 与后端 `.cs`；列表设计的前端为 Vue 单文件组件，涉及跨端逻辑时必须同时检查两端。',
  '- 前端 JS 通过 Ajax 与后端 C# 互通，参数名、返回字段和错误信息必须在 `design/` 下的对应文档中写清楚。',
  '- 只改前端展示且不需要服务端数据时，可以不改 C#，但要在 `design/design-cs.md` 标注原因。',
  '- 响应示例的编码都要加上中文名称注释。',
  '- **design/**：前后端各自独立成文件，避免前端与后端逻辑杂糅在同一份文档里。',
  '',
  '## 注释与验证',
  '',
  '- 修改 JS、CSS、Java 或 C# 时补充有业务价值的中文注释，说明用途、关键变量、状态流转和外部调用原因。',
  '- 未实际执行验证时，不得声称已经通过；无法验证时在 `design/` 或交付说明中写明原因。',
  '',
].join('\n');

const H3YUN_DESIGN_JS_TEMPLATE = [
  '# 前端设计',
  '',
  '> 文件用途：AI 根据 `README.md` 中的用户需求和 `FromCode.md` 中的编码上下文，维护前端 JS 实现方案。插件只在文件缺失时创建本模板。',
  '',
  '## 基本信息',
  '',
  '- 平台：{{平台}}',
  '- 页面类型：{{页面类型}}',
  '- 页面地址：{{页面地址}}',
  '- 表单编码：{{表单编码}}',
  '- 表单名称：{{表单名称}}',
  '',
  '## 前端实现',
  '',
  '（待补充）',
  '',
].join('\n');

const H3YUN_DESIGN_CS_TEMPLATE = [
  '# 后端设计',
  '',
  '> 文件用途：AI 根据 `README.md` 中的用户需求和 `FromCode.md` 中的编码上下文，维护后端 C# 实现方案。插件只在文件缺失时创建本模板。',
  '',
  '## 基本信息',
  '',
  '- 平台：{{平台}}',
  '- 页面类型：{{页面类型}}',
  '- 页面地址：{{页面地址}}',
  '- 表单编码：{{表单编码}}',
  '- 表单名称：{{表单名称}}',
  '',
  '## 后端实现',
  '',
  '（待补充）',
  '',
].join('\n');

// ── 内置产物定义 ──────────────────────────────────────

/** 目录路径常量（避免魔法值） */
const DIR_DESIGN = 'design';
const DIR_SQL = 'sql';

function captureArtifact(id: string, label: string, enabled: boolean): ArtifactDefinition {
  return { id, kind: 'capture', label, dirPath: '', fileName: '', enabled, defaultContent: '', builtin: true };
}

function templateArtifact(
  id: string,
  label: string,
  dirPath: string,
  fileName: string,
  enabled: boolean,
  defaultContent: string,
): ArtifactDefinition {
  return { id, kind: 'template', label, dirPath, fileName, enabled, defaultContent, builtin: true };
}

/** 云枢内置产物（顺序即设置页展示顺序） */
function buildCloudpivotArtifacts(): ArtifactDefinition[] {
  return [
    captureArtifact(ARTIFACT_IDS.fromCode, 'FromCode.md（字段/控件编码）', true),
    captureArtifact(ARTIFACT_IDS.html, 'HTML', true),
    captureArtifact(ARTIFACT_IDS.css, 'CSS', true),
    captureArtifact(ARTIFACT_IDS.js, 'JavaScript', true),
    // 业务规则 Java 原先无开关（无条件生成），默认开以保持既有行为
    captureArtifact(ARTIFACT_IDS.java, '业务规则 Java', true),
    templateArtifact(ARTIFACT_IDS.readme, 'README.md', '', 'README.md', false, CLOUDPIVOT_README_TEMPLATE),
    templateArtifact(ARTIFACT_IDS.agents, 'AGENTS.md', '', 'AGENTS.md', false, CLOUDPIVOT_AGENTS_TEMPLATE),
    // 只建文件夹：fileName 留空
    templateArtifact(ARTIFACT_IDS.design, 'design/ 设计文档目录', DIR_DESIGN, '', false, ''),
    templateArtifact(ARTIFACT_IDS.sql, 'sql/ SQL 脚本目录', DIR_SQL, '', false, ''),
  ];
}

/** 氚云内置产物 */
function buildH3yunArtifacts(): ArtifactDefinition[] {
  return [
    captureArtifact(ARTIFACT_IDS.fromCode, 'FromCode.md（字段/控件编码）', true),
    captureArtifact(ARTIFACT_IDS.js, '前端 JavaScript', true),
    captureArtifact(ARTIFACT_IDS.cs, '后端 C#', true),
    templateArtifact(ARTIFACT_IDS.readme, 'README.md', '', 'README.md', false, H3YUN_README_TEMPLATE),
    templateArtifact(ARTIFACT_IDS.agents, 'AGENTS.md', '', 'AGENTS.md', false, H3YUN_AGENTS_TEMPLATE),
    // 前后端说明各自独立成文件，可单独开关（有时只改前端、有时只改后端）
    templateArtifact(ARTIFACT_IDS.designJs, 'design/design-js.md（前端设计）', DIR_DESIGN, 'design-js.md', false, H3YUN_DESIGN_JS_TEMPLATE),
    templateArtifact(ARTIFACT_IDS.designCs, 'design/design-cs.md（后端设计）', DIR_DESIGN, 'design-cs.md', false, H3YUN_DESIGN_CS_TEMPLATE),
  ];
}

/** 构造全部平台的内置产物默认配置 */
export function buildDefaultArtifactConfig(): ArtifactConfig {
  return {
    [PLATFORM_KEY_CLOUDPIVOT]: buildCloudpivotArtifacts(),
    [PLATFORM_KEY_H3YUN]: buildH3yunArtifacts(),
  };
}

/** 构造指定平台的内置产物默认配置（返回新数组，调用方可安全修改） */
export function buildDefaultArtifacts(platformKey: PlatformKey): ArtifactDefinition[] {
  return platformKey === PLATFORM_KEY_H3YUN ? buildH3yunArtifacts() : buildCloudpivotArtifacts();
}

// ── 校验 ──────────────────────────────────────────────

/**
 * 校验同平台内的产物路径是否重复。
 * 重复会让两条产物互相覆盖，且谁赢取决于顺序，极难排查，因此禁止保存。
 * @returns 重复的路径（去重后）；无重复返回空数组
 */
export function findDuplicateArtifactPaths(artifacts: readonly ArtifactDefinition[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const artifact of artifacts) {
    if (!artifact.enabled) continue;
    const path = normalizeArtifactPath(artifact.dirPath, artifact.fileName);
    if (!path) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) duplicates.add(path);
    else seen.add(key);
  }
  return [...duplicates];
}
