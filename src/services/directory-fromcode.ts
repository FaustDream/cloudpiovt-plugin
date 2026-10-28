/**
 * 目录表单编码关联（本地存储 + 旧版 fromcode 文件迁移）。
 *
 * 目录归属编码保存在扩展本地存储，并通过已绑定的页面级目录句柄比对目录身份，
 * 不再向用户目录写入无后缀标记文件。读取旧版遗留的 `fromcode` 文件仅用于迁移，
 * 第一次实际写入时会把归属保存到扩展存储并删除该旧标记。
 *
 * 语义：
 * - matched：本地关联编码与当前页面一致 → 目录属于当前页面
 * - mismatched：已关联编码与当前页面不一致 → 交由用户确认是否强制关联
 * - missing：本地与旧版标记均无关联 → 可能是新建目录，首次写入时登记本地关联
 * - skipped：当前页面提取不到表单编码（未识别页面）→ 不参与该机制
 */

import { logger } from '../lib/logger.js';
import { parseModelCodesFromPageUrl } from '../lib/platform/readme-parser.js';
import { extractH3yunDesignerId } from '../lib/platform/h3yun-code.js';
import { getAllTargetDirectoryHandlesForScopes } from '../lib/directory/file-handle-db.js';

const FROMCODE_FILE_NAME = 'fromcode';
const FROMCODE_MARKS_KEY = 'fromcodeAssociationMarks';

export type FromcodeStatus = 'matched' | 'mismatched' | 'missing' | 'skipped' | 'unreadable';

// ── 编码提取 ──────────────────────────────────────────

/** 从页面 URL 提取表单编码（云枢 applicationCode/formCode；氚云设计器 id；提取不到返回空串） */
export function extractPageFormCode(pageUrl: string, pageType: string): string {
  const url = String(pageUrl || '');
  if (!url) return '';

  const type = String(pageType || '').trim();
  if (type.toLowerCase().startsWith('h3yun')) {
    return extractH3yunDesignerId(url) || '';
  }
  const { applicationCode, formCode } = parseModelCodesFromPageUrl(url);
  return [applicationCode, formCode].filter(Boolean).join('/');
}

// ── fromcode 文件读写 ─────────────────────────────────

/**
 * 读取目录下的 fromcode 内容。
 * - 文件不存在（NotFoundError）→ null
 * - 权限拒绝（NotAllowedError / SecurityError）→ 原样抛出（调用方区分 prompt/denied 处理）
 * - 其他异常 → 记录警告并按无标记处理（不阻断主流程）
 */
export async function readDirectoryFromcode(handle: FileSystemDirectoryHandle): Promise<string | null> {
  try {
    const fileHandle = await handle.getFileHandle(FROMCODE_FILE_NAME);
    const file = await fileHandle.getFile();
    const content = (await file.text()).trim();
    return content || null;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
      throw error;
    }
    logger.warn('读取目录 fromcode 标记失败，按无标记处理', { error: String(error) });
    return null;
  }
}

/** 删除旧版遗留的 fromcode 文件；后续目录归属仅保存在扩展本地存储中。 */
export async function removeLegacyDirectoryFromcode(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await handle.getFileHandle(FROMCODE_FILE_NAME);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return;
    throw error;
  }

  try {
    await handle.removeEntry(FROMCODE_FILE_NAME);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return;
    throw error;
  }
}

/**
 * 按页面 scope 与目录句柄身份校验本地关联；没有本地关联时回读旧版 fromcode 文件。
 * 本地关联编码与当前页面一致时返回 matched，否则返回 mismatched。
 * 提取不到页面编码时返回 skipped（该页面不参与 fromcode 机制）；
 * 无法读取目录或关联句柄时返回 unreadable。
 */
export async function verifyDirectoryFromcode(
  handle: FileSystemDirectoryHandle,
  pageUrl: string,
  pageType: string,
  pageScope = '',
): Promise<FromcodeStatus> {
  const formCode = extractPageFormCode(pageUrl, pageType);
  if (!formCode) return 'skipped';

  try {
    const associationStatus = pageScope
      ? await findDirectoryAssociationStatus(handle, formCode, pageScope)
      : null;
    if (associationStatus) return associationStatus;
  } catch (error: unknown) {
    logger.warn('检查目录表单关联失败', { error: String(error) });
    return 'unreadable';
  }

  let stored: string | null;
  try {
    stored = await readDirectoryFromcode(handle);
  } catch {
    return 'unreadable';
  }
  if (stored === null) return 'missing';
  return pageUrl.includes(stored) ? 'matched' : 'mismatched';
}

// ── 页面 scope 关联（chrome.storage.local，不向目录写标记文件） ─────

interface FromcodeAssociation {
  readonly formCode: string;
  readonly forced: boolean;
}

type FromcodeAssociations = Record<string, FromcodeAssociation>;

function normalizeAssociations(value: unknown): FromcodeAssociations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const associations: FromcodeAssociations = {};
  for (const [scope, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!scope || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const formCode = Reflect.get(entry, 'formCode');
    const forced = Reflect.get(entry, 'forced');
    if (typeof formCode === 'string' && formCode.trim()) {
      associations[scope] = { formCode: formCode.trim(), forced: forced === true };
    }
  }
  return associations;
}

async function loadAssociations(): Promise<FromcodeAssociations> {
  const stored = await chrome.storage.local.get({ [FROMCODE_MARKS_KEY]: {} });
  return normalizeAssociations(stored[FROMCODE_MARKS_KEY]);
}

/** 查询页面 scope 的目录表单编码关联。 */
export async function getFromcodeAssociation(scope: string): Promise<FromcodeAssociation | undefined> {
  const key = String(scope || '').trim();
  if (!key) return undefined;
  return (await loadAssociations())[key];
}

/** 记录页面 scope 的目录表单编码关联，不创建目录标记文件。 */
export async function setFromcodeAssociation(
  scope: string,
  formCode: string,
  forced = false,
): Promise<void> {
  const key = String(scope || '').trim();
  const code = String(formCode || '').trim();
  if (!key || !code) return;
  const associations = await loadAssociations();
  associations[key] = { formCode: code, forced };
  await chrome.storage.local.set({ [FROMCODE_MARKS_KEY]: associations });
}

/** 清除页面 scope 的目录关联（换绑目录 / 取消绑定时）。 */
export async function clearFromcodeAssociation(scope: string): Promise<void> {
  const key = String(scope || '').trim();
  if (!key) return;
  const associations = await loadAssociations();
  if (!(key in associations)) return;
  delete associations[key];
  await chrome.storage.local.set({ [FROMCODE_MARKS_KEY]: associations });
}

async function findDirectoryAssociationStatus(
  handle: FileSystemDirectoryHandle,
  currentFormCode: string,
  currentPageScope: string,
): Promise<FromcodeStatus | null> {
  const [associations, scopedHandles] = await Promise.all([
    loadAssociations(),
    getAllTargetDirectoryHandlesForScopes(),
  ]);
  const matches: Array<{ pageScope: string; association: FromcodeAssociation }> = [];

  for (const scoped of scopedHandles) {
    const association = associations[scoped.pageScope];
    if (association && await handle.isSameEntry(scoped.handle)) {
      matches.push({ pageScope: scoped.pageScope, association });
    }
  }
  if (matches.length === 0) return null;

  const currentAssociation = matches.find((match) => match.pageScope === currentPageScope)?.association;
  if (currentAssociation?.forced && currentAssociation.formCode === currentFormCode) return 'matched';
  return matches.some(({ association }) => association.formCode !== currentFormCode)
    ? 'mismatched'
    : 'matched';
}
