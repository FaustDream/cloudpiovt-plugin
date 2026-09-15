/**
 * 通用纯工具函数。
 *
 * lib/ 模块边界红线：不引用 chrome.*。
 * 所有函数为纯函数或仅依赖标准 API。
 */

// ── 文本清洗 ──────────────────────────────────────────

/** 折叠空白、去首尾空格、替换 &nbsp; */
export function cleanInlineText(text: string): string {
  return text
    .replace(/\u00A0/g, ' ')    // &nbsp;
    .replace(/\s+/g, ' ')
    .trim();
}

/** 多行清理：保留换行，去首尾空白行 */
export function cleanMultilineText(text: string): string {
  return text
    .replace(/\u00A0/g, ' ')
    .replace(/^[\s\n\r]+|[\s\n\r]+$/g, '')
    .trim();
}

// ── 路径工具 ──────────────────────────────────────────

/** 路径值标准化（trim 并去空） */
export function normalizePath(path: unknown): string {
  // 对齐 gitHub 原版：String(value || "").trim()，非字符串一律转字符串再 trim
  return String(path ?? '').trim();
}

/** 提取路径末级目录名 */
export function extractLastFolderName(path: string): string {
  const normalized = path.replace(/[\\/]$/, '');
  const lastSep = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return lastSep >= 0 ? normalized.substring(lastSep + 1) : normalized;
}

/** 路径分隔符统一为正斜杠 */
export function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

// ── 相对路径解析（产物路径 → 目录段 + 文件名） ────────

/** 路径段中不允许出现的字符（Windows / POSIX 双兼容；控制字符一并剔除） */
const INVALID_SEGMENT_CHARS = /[<>:"|?*\u0000-\u001F]/g;

/** 表示「向上一级」的路径段：出于安全考虑禁止出现在产物路径中 */
const PARENT_SEGMENT = '..';

/** 当前目录段（无意义，直接丢弃） */
const CURRENT_SEGMENT = '.';

/** 相对路径解析结果 */
export interface RelativePathParts {
  /** 目录段（按层级顺序，已清洗） */
  readonly dirSegments: readonly string[];
  /** 末级文件名（已清洗）；输入以 `/` 结尾或只有目录时为空 */
  readonly fileName: string;
}

/** 空解析结果：路径为空或非法（含 `..` 逃逸） */
export const EMPTY_RELATIVE_PATH: RelativePathParts = { dirSegments: [], fileName: '' };

/**
 * 解析相对路径为「目录段 + 文件名」。
 *
 * 规则：
 * - `\` 统一归一为 `/`；丢弃空段与 `.` 段
 * - 出现 `..` 段时返回空结果（禁止逃逸出目标目录）
 * - 每段清洗掉非法字符，清洗后为空的段被丢弃
 * - 输入以 `/` 结尾时视为「只指定目录」，fileName 为空（用于只建文件夹的产物）
 */
export function parseRelativePath(value: unknown): RelativePathParts {
  const raw = String(value ?? '').trim();
  if (!raw) return EMPTY_RELATIVE_PATH;

  const normalized = normalizePathSeparators(raw);
  const isDirectoryOnly = normalized.endsWith('/');
  const cleaned: string[] = [];

  for (const segment of normalized.split('/')) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed === CURRENT_SEGMENT) continue;
    if (trimmed === PARENT_SEGMENT) return EMPTY_RELATIVE_PATH;

    const safe = trimmed.replace(INVALID_SEGMENT_CHARS, '_').trim();
    if (!safe || safe === PARENT_SEGMENT || safe === CURRENT_SEGMENT) continue;
    cleaned.push(safe);
  }

  if (cleaned.length === 0) return EMPTY_RELATIVE_PATH;
  if (isDirectoryOnly) return { dirSegments: cleaned, fileName: '' };

  const fileName = cleaned[cleaned.length - 1] ?? '';
  if (!fileName) return EMPTY_RELATIVE_PATH;
  return { dirSegments: cleaned.slice(0, -1), fileName };
}

/** 把目录段与文件名拼回相对路径（不含前导斜杠） */
export function joinRelativePath(dirSegments: readonly string[], fileName: string): string {
  return [...dirSegments, fileName].filter(Boolean).join('/');
}

/**
 * 校验并规范化产物路径，返回统一形态的 `路径/文件名` 字符串。
 * 只声明目录（fileName 为空）时返回带结尾 `/` 的目录路径（如 `sql/`），
 * 供写入层识别「只建文件夹」语义。
 * 非法路径（含 `..`、清洗后为空）返回空字符串，调用方应跳过该产物。
 */
export function normalizeArtifactPath(dirPath: unknown, fileName: unknown): string {
  const dir = String(dirPath ?? '').trim().replace(/^[/\\]+/, '');
  const file = String(fileName ?? '').trim();
  const parts = parseRelativePath(file ? `${dir}/${file}` : `${dir}/`);
  if (!parts.dirSegments.length && !parts.fileName) return '';
  if (!parts.fileName) return `${joinRelativePath(parts.dirSegments, '')}/`;
  return joinRelativePath(parts.dirSegments, parts.fileName);
}

// ── JSON 安全包装 ─────────────────────────────────────

/** 安全 JSON.stringify（失败返回 fallback） */
export function safeStringify(value: unknown, fallback = ''): string {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return fallback;
  }
}

/** 安全 JSON.parse */
export function safeParse<T = unknown>(json: string): { ok: true; data: T } | { ok: false; error: string } {
  try {
    const data = JSON.parse(json) as T;
    return { ok: true, data };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    return { ok: false, error: message };
  }
}

// ── 类型守卫 ──────────────────────────────────────────

/** 判断是否为非空字符串 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 判断是否为合法 URL */
export function isUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    new URL(value);
    return true;
  } catch (_error) {
    return false;
  }
}

/** 从 URL 提取 hostname */
export function extractHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname;
  } catch (_error) {
    return '';
  }
}

/** 从 URL pathname 提取路径段 */
export function extractPathSegments(urlStr: string): readonly string[] {
  try {
    return new URL(urlStr).pathname.split('/').filter(Boolean);
  } catch (_error) {
    return [];
  }
}

// ── 深层克隆 ──────────────────────────────────────────

/** JSON 可序列化深克隆（只处理纯数据，不含函数/DOM） */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── ID 生成 ───────────────────────────────────────────

let idCounter = 0;
/** 简易请求 ID 生成器（短 UUID v4 风格） */
export function generateRequestId(): string {
  idCounter = (idCounter + 1) % Number.MAX_SAFE_INTEGER;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${time}-${rand}-${idCounter}`;
}

// ── 页面 scope 构建 ───────────────────────────────────

/**
 * 生成目录快照 scope。
 * 格式：`platformKey@pageType@<urlPathHash>`
 */
export function createPageScope(platformKey: string, pageType: string, url: string): string {
  let path = '';
  try {
    const { pathname, search } = new URL(url);
    path = `${pathname}${search}`;
  } catch (_error) {
    path = url;
  }
  // 简单 hash：取路径折叠后的特征
  const hashPart = path.split('/').filter(Boolean).slice(-3).join('/');
  return `${platformKey}@${pageType}@${hashPart}`;
}

// ── 等待工具 ──────────────────────────────────────────

/** Promise 超时包装 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = 'operation',
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}
