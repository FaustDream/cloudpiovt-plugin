/**
 * 项目级常量定义。「禁止魔法值」——所有裸数字/字符串/状态码统一在此声明。
 * 本模块不引用 chrome.*（纯逻辑，lib/ 边界红线）。
 */

// ── 平台相关 ──────────────────────────────────────────
export const PLATFORM_KEY_CLOUDPIVOT = 'cloudpivot' as const;
export const PLATFORM_KEY_H3YUN = 'h3yun' as const;

export const PLATFORM_LABELS = {
  [PLATFORM_KEY_CLOUDPIVOT]: '云枢',
  [PLATFORM_KEY_H3YUN]: '氚云',
} as const;

/** 域名 → 平台标识映射 */
export const PLATFORM_HOST_MAP: Readonly<Record<string, 'cloudpivot' | 'h3yun'>> = {
  'ztna-dingtalk.com': 'cloudpivot',
  'h3yun.com': 'h3yun',
};

// ── 页面类型 ──────────────────────────────────────────
export const PAGE_TYPE_DEFAULT = 'default' as const;

// ── 文件映射 ──────────────────────────────────────────
/** 云枢前端固定文件名映射 */
export const CLOUDPIVOT_FILE_MAPPINGS = [
  { key: 'html' as const, fileName: 'form-index.html' },
  { key: 'css' as const, fileName: 'form-style.css' },
  { key: 'javascript' as const, fileName: 'form-script.js' },
] as const;

/** 氚云代码特征正则 */
export const H3YUN_CSHARP_PATTERN = /using\s+System|namespace\s+\w+|public\s+class\s+\w+|H3\.SmartForm/;
export const H3YUN_FRONTEND_PATTERN = /\/\*|\$\..*extend|function\s*\(|控件接口/;

// ── Markdown ──────────────────────────────────────────

/**
 * Markdown 代码块围栏。
 *
 * FromCode.md 是「标签: 值」逐行结构，行间只有单个换行；CommonMark 会把段落内的
 * 单个换行渲染为空格，导致 Markdown 预览里所有行糊成一整段。用围栏包住整份内容后
 * 预览所见即所得，且围栏行不会被 FromCode 的反向解析误判。
 */
export const MARKDOWN_FENCE = '```';

// ── 存储键 ────────────────────────────────────────────
export const STORAGE_KEYS = {
  CONFIG: 'config',
  /** 产物配置（新结构，替代旧的 generatedFiles） */
  ARTIFACTS: 'artifacts',
  /** @deprecated 旧版逐字段开关，仅用于一次性迁移 */
  GENERATED_FILES: 'generatedFiles',
  H3YUN_ONE_CLICK_WRITEBACK: 'h3yunOneClickWriteback',
  FALLBACK_DIRECTORY_PATHS: 'fallbackDirectoryPaths',
  RECENT_DIRECTORIES: 'targetDirectoryRecent',
  LAST_DIAGNOSTIC: 'lastDiagnosticPackage',
  LAST_DIRECTORY: 'targetDirectoryLastSelection',
  DIRECTORY_SNAPSHOT_PREFIX: 'targetDirectorySnapshot:',
  DIRECTORY_SELECTION_PREFIX: 'targetDirectory:',
  DIRECTORY_PATH_PREFIX: 'targetDirectoryPath:',
} as const;

// ── IndexedDB ─────────────────────────────────────────
export const FILE_HANDLE_DB_NAME = 'FileHandleDB';
export const FILE_HANDLE_DB_VERSION = 1;
export const FILE_HANDLE_STORE_NAME = 'directoryHandles';

// ── 预检 ──────────────────────────────────────────────
export const PREFLIGHT_SEVERITY = {
  BLOCKER: 'blocker',
  WARNING: 'warning',
  INFO: 'info',
} as const;

export const PREFLIGHT_OPERATION_IDS = {
  WRITE_BACK: 'writeBack',
  CAPTURE: 'capture',
  DIAGNOSTIC: 'diagnostic',
} as const;

// ── FNV-1a 哈希 ───────────────────────────────────────
/** FNV-1a 32bit offset basis */
export const FNV1A_OFFSET_BASIS = 2166136261;
/** FNV-1a 32bit prime */
export const FNV1A_PRIME = 16777619;
