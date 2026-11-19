/**
 * 目标目录透明读写层（纯浏览器模式）。
 *
 * 使用 File System Access API（showDirectoryPicker + FileSystemDirectoryHandle）
 * 实现本地目录的读写，无需安装任何 Native Host。
 *
 * 目录选择、文件读写均在 popup/options 页面发起。
 */

import { logger } from '../lib/logger.js';
import { BusinessError, DirectoryError, ValidationError, ERROR_CODE } from '../lib/errors.js';
import { parseRelativePath, joinRelativePath, type RelativePathParts } from '../lib/utils.js';
import { getDefaultDirectoryHandle } from '../lib/directory/file-handle-db.js';
import { getPlatformKeyFromPageType } from './config.js';
import {
  getStoredDirectoryPath,
  saveHandleSelection,
  clearTabTargetDirectoryData,
  resolveTargetDirectoryHandle,
} from './target-directory-state.js';
import { createTargetDirectoryPageScope } from './target-directory-session.js';
import {
  extractPageFormCode,
  getFromcodeAssociation,
  setFromcodeAssociation,
  readDirectoryFromcode,
  removeLegacyDirectoryFromcode,
  verifyDirectoryFromcode,
} from './directory-fromcode.js';
import type { PlatformKey } from '../types/platform.js';
import { writeFileContent } from './target-directory-write.js';

// ── 公开类型 ──────────────────────────────────────────

/**
 * 待写入文件。
 *
 * `fileName` 支持相对路径（如 `design/design-js.md`），会按层级逐段创建子目录。
 * 当路径只包含目录段（如 `sql/`）时表示「只创建文件夹，不写文件」。
 */
export interface FileWriteEntry {
  readonly fileName: string;
  readonly content: string;
}

export interface FileReadEntry {
  readonly fileName: string;
  readonly content: string;
  readonly exists: boolean;
}

export interface FileStatEntry {
  readonly fileName: string;
  readonly exists: boolean;
  readonly size: number | null;
  readonly modifiedAt: string;
}

export interface ReadFilesResult {
  readonly files: readonly FileReadEntry[];
}

export interface StatFilesResult {
  readonly files: readonly FileStatEntry[];
}

export interface SelectDirectoryResult {
  readonly path: string;
  readonly source: 'handle';
  readonly label: string;
  /** fromcode 校验结论（matched / missing / skipped / mismatched-forced） */
  readonly fromcode?: string;
  /**
   * 目录 fromcode 与当前页面不匹配时携带：目录句柄 + 目录内的表单编码。
   * 调用方（popup）据此提示用户决定；确认后调用 confirmForcodeOverride 完成强制绑定。
   */
  readonly fromcodeConfirm?: {
    readonly handle: FileSystemDirectoryHandle;
    readonly fromcodeValue: string;
  };
}

export interface WriteFilesResult {
  /** 实际写入的文件数 */
  readonly written: number;
  /** 新建（或确认存在）的目录数 */
  readonly directories: number;
  /** 目录标签（Handle 通道为目录名） */
  readonly directoryPath?: string;
}

// ── 内部工具 ──────────────────────────────────────────

/** 目录解析选项：写入时需自动创建，读取时只需定位 */
interface ResolveDirectoryOptions {
  readonly create: boolean;
}

interface TabInfo {
  readonly id?: number;
  readonly url?: string;
  readonly pendingUrl?: string;
}

// Chrome Extension 环境中的 FileSystemDirectoryHandle 扩展
type ExtendedDirectoryHandle = FileSystemDirectoryHandle & {
  requestPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  queryPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
};

interface DirectoryPickerOptions {
  /** 目录选择器初始打开位置；缺省时不传 startIn，由浏览器按 id 记忆定位（见 toPickerStartIn） */
  readonly startIn?: PickerStartIn;
  /** 选择器记忆 id：浏览器按 id 记住上次选定的目录（见 buildPickerId） */
  readonly id?: string;
}

/** 浏览器标准目录名（startIn 可接受的字面量） */
type WellKnownDirectoryName = 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';

/** 目录选择器初始位置：句柄或浏览器标准目录名 */
type PickerStartIn = FileSystemDirectoryHandle | WellKnownDirectoryName;

/**
 * 目录选择器「中性」初始位置。
 *
 * 只用于本平台从未绑定过目录的情况：此时既没有句柄，也没有本平台的选择记忆。
 * 一旦本平台选过目录，就交给选择器 id 记忆定位，不再用中性位置覆盖它。
 */
const NEUTRAL_PICKER_START_IN: WellKnownDirectoryName = 'documents';

/**
 * 目录选择器记忆 id。
 *
 * 浏览器会按 id 记住该 id 上次选定的目录：即使句柄丢失（未绑定 / 已失效），
 * 选择器也会打开在本平台上次选定的目录，而不是系统默认位置或另一个平台的目录。
 * 按「用途 + 平台」分桶，保证云枢与氚云的目录记忆互不干扰。
 */
function buildPickerId(kind: 'page' | 'default', platformKey: PlatformKey): string {
  return `${kind}-dir-${platformKey}`;
}

/** 把目录选择器抛出的异常转成一行可读信息（异常名 + 消息），用于日志定位 */
function describePickerFailure(error: unknown): string {
  if (error instanceof BusinessError) return error.message;
  if (error instanceof DOMException) return `${error.name}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 是否为「用户手势已失效」类失败。
 *
 * 每次弹窗都会消耗这次点击的用户手势，换初始位置重试也只会在没有手势的情况下
 * 再失败一次（还可能连续闪出对话框），因此这类失败不再降级重试。
 */
function isGestureFailure(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === 'SecurityError' || error.name === 'NotAllowedError' || error.name === 'InvalidStateError');
}

/**
 * 弹出目录选择器。
 *
 * 只在给了 startIn 时准备一次降级：句柄失效（目录被移动 / 删除）时改为不带
 * startIn 再弹一次，由选择器 id 记忆定位。其它失败（用户取消、缺少用户手势）
 * 直接抛给调用方，不重复弹窗。
 */
async function showDirPicker(options: DirectoryPickerOptions = {}): Promise<FileSystemDirectoryHandle> {
  const w = window as unknown as {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
      id?: string;
      startIn?: PickerStartIn;
    }) => Promise<FileSystemDirectoryHandle>;
  };
  if (typeof w.showDirectoryPicker !== 'function') {
    throw new ValidationError('showDirectoryPicker not available', { available: false });
  }

  // 选择时直接请求读写权限：授权状态由浏览器缓存，后续操作从缓存获取，避免首次回写失败
  const pick = (startIn?: PickerStartIn): Promise<FileSystemDirectoryHandle> => {
    const pickerOptions: { mode: 'readwrite'; id?: string; startIn?: PickerStartIn } = { mode: 'readwrite' };
    if (options.id) pickerOptions.id = options.id;
    if (startIn) pickerOptions.startIn = startIn;
    return w.showDirectoryPicker!(pickerOptions);
  };

  const candidates: Array<PickerStartIn | undefined> = options.startIn ? [options.startIn, undefined] : [undefined];

  let lastError: unknown = null;
  for (const startIn of candidates) {
    try {
      return await pick(startIn);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error; // 用户取消
      lastError = error;
      if (isGestureFailure(error)) throw error; // 换初始位置也不可能成功
      logger.warn('目录选择器初始位置不可用，降级重试', {
        startIn: typeof startIn === 'string' ? startIn : 'handle',
        error: describePickerFailure(error),
      });
    }
  }

  throw lastError ?? new ValidationError('目录选择器不可用', {});
}

function requestHandlePermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite',
): Promise<PermissionState> {
  const ext = handle as unknown as ExtendedDirectoryHandle;
  if (typeof ext.requestPermission === 'function') {
    return ext.requestPermission({ mode });
  }
  return Promise.resolve('granted');
}

/** 查询句柄当前权限（不触发授权弹窗） */
function queryHandlePermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  const ext = handle as unknown as ExtendedDirectoryHandle;
  if (typeof ext.queryPermission === 'function') {
    return ext.queryPermission({ mode: 'readwrite' });
  }
  return Promise.resolve('granted');
}

// ── 目录选择器可用性 ──────────────────────────────────

export function supportsDirectoryPicker(): boolean {
  try {
    return typeof window !== 'undefined'
      && 'showDirectoryPicker' in (window as unknown as Record<string, unknown>)
      && typeof (window as unknown as Record<string, unknown>).showDirectoryPicker === 'function';
  } catch {
    return false;
  }
}

// ── 目录选择 ──────────────────────────────────────────

/**
 * 解析目录选择器初始打开位置。
 *
 * 只把**已授权**的句柄交给浏览器：
 *  1) 当前页面 scope 句柄 / 当前平台默认目录句柄（已授权）→ 选择器定位到该目录；
 *  2) 句柄存在但未授权 → 不传 startIn，由选择器 id 记忆（本平台自己的上次位置）定位；
 *  3) 本平台从未绑定过目录 → 中性位置，绝不继承其他平台 / 其他页面的历史目录。
 *
 * 未授权句柄既无法用于定位，也会诱使这里先弹一次授权框；授权框会消耗这次点击的
 * 用户手势，浏览器随后会以「缺少用户手势」拒绝打开目录选择器（表现为选择器打不开、
 * 日志只留「目录选择已取消」）。补授权一律留到选择器之后。
 */
async function toPickerStartIn(
  handle: FileSystemDirectoryHandle | undefined,
): Promise<PickerStartIn | undefined> {
  if (!handle) return NEUTRAL_PICKER_START_IN;
  if (await queryHandlePermission(handle) === 'granted') return handle;
  logger.debug('目录句柄未授权，选择器改用本平台记忆位置', { label: handle.name });
  return undefined;
}

/**
 * 弹出原生目录选择器并保存绑定。
 *
 * @returns null 表示用户在浏览器对话框里取消；选择器打不开、未获读写授权属于失败，
 *          抛出业务异常由调用方写进日志，不能与「用户取消」混为一谈。
 */
export async function selectHandleDirectory(
  tab: TabInfo | number,
  pageType = 'default',
): Promise<SelectDirectoryResult | null> {
  if (!supportsDirectoryPicker()) return null;

  let handle: FileSystemDirectoryHandle;
  try {
    // 「更新当前路径」打开「当前有效路径 → 项目默认目录」对应的句柄（startIn），
    // 不回退到系统全局默认目录 / 其他平台的历史目录。
    const startIn = await toPickerStartIn(await resolveTargetDirectoryHandle(tab, pageType));
    handle = await showDirPicker({
      ...(startIn ? { startIn } : {}),
      id: buildPickerId('page', getPlatformKeyFromPageType(pageType)),
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    const detail = describePickerFailure(error);
    logger.error('Handle directory selection failed', { pageType, error: detail });
    throw new DirectoryError(ERROR_CODE.UNKNOWN, `目录选择器未能打开（${detail}）`, { pageType });
  }

  return await bindSelectedHandle(handle, tab, pageType);
}

/**
 * 绑定并登记一个已取得的目录句柄（系统目录选择器与拖入文件夹共用）。
 *
 * 句柄来源不同、带的授权也不同（选择器带读写授权，拖放只带读授权），
 * 因此统一在这里补一次读写授权；未授权按失败上报，不静默当作「已取消」。
 */
async function bindSelectedHandle(
  handle: FileSystemDirectoryHandle,
  tab: TabInfo | number,
  pageType: string,
): Promise<SelectDirectoryResult> {
  const permission = await requestHandlePermission(handle, 'readwrite');
  if (permission !== 'granted') {
    logger.warn('Directory readwrite permission not granted', { pageType, permission });
    throw new DirectoryError(
      ERROR_CODE.DIRECTORY_PERMISSION_DENIED,
      `目录「${handle.name}」未获读写授权（${permission}）`,
      { pageType, permission },
    );
  }

  const selection = await saveHandleSelection(handle, tab, pageType);
  if (!selection.handleModeSelected) {
    // 目录 fromcode 属于其他表单：不自动关联，交由调用方提示用户决定
    return {
      path: '',
      source: 'handle',
      label: selection.label,
      fromcode: selection.fromcode,
      fromcodeConfirm: {
        handle,
        fromcodeValue: selection.fromcodeValue ?? '',
      },
    };
  }
  return { path: '', source: 'handle', label: selection.label, fromcode: selection.fromcode };
}

/**
 * 绑定用户拖入弹窗的文件夹句柄。
 *
 * 拖放只带读授权，必须在拖放当次手势内调用；这是不经过系统目录对话框的
 * 选择入口，用于 Chrome 在 Windows 上「选完文件夹返回 AbortError」的场景。
 */
export async function selectDroppedDirectory(
  handle: FileSystemDirectoryHandle,
  tab: TabInfo | number,
  pageType = 'default',
): Promise<SelectDirectoryResult> {
  return await bindSelectedHandle(handle, tab, pageType);
}

/**
 * 用户确认强制关联 fromcode 不匹配的目录：绑定到当前页面并标记 forced，
 * 首次导出时覆盖写入当前页面表单编码。
 */
export async function confirmForcodeOverride(
  handle: FileSystemDirectoryHandle,
  tab: TabInfo | number,
  pageType = 'default',
): Promise<SelectDirectoryResult | null> {
  const selection = await saveHandleSelection(handle, tab, pageType, { forceFromcode: true });
  if (!selection.handleModeSelected) return null;
  return { path: '', source: 'handle', label: selection.label, fromcode: selection.fromcode };
}

/** 选择目录并保存绑定 */
export async function selectAndBindDirectory(
  tab: TabInfo | number,
  options: {
    pageType?: string;
    isPageSnapshot?: boolean;
  } = {},
): Promise<SelectDirectoryResult | null> {
  const pageType = String(options.pageType || 'default');
  const isPageSnapshot = options.isPageSnapshot ?? false;

  if (!supportsDirectoryPicker()) {
    throw new ValidationError('当前浏览器不支持 File System Access API', {
      hint: '请使用 Chrome 86+ 或 Edge 86+ 版本',
    });
  }

  return await selectHandleDirectory(tab, pageType);
}

/**
 * 设置页「默认目录」浏览：弹出目录选择器并返回句柄（null 表示用户取消）。
 *
 * 初始位置只用「本平台自己的默认目录句柄」（已授权时）或本平台的选择器记忆；
 * 本平台尚未配置时使用中性位置。绝不继承另一个平台 / 其他页面遗留的位置——否则
 * 很容易把云枢的工作目录绑成氚云的默认目录。
 *
 * 选择时直接请求读写权限（默认目录会被用于写入）。
 * 失败（非用户取消）抛出业务异常，由调用方提示。
 */
export async function selectPlatformDefaultDirectory(
  platformKey: PlatformKey,
): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsDirectoryPicker()) {
    throw new ValidationError('当前浏览器不支持 File System Access API', {
      hint: '请使用 Chrome 86+ 或 Edge 86+ 版本',
    });
  }

  let handle: FileSystemDirectoryHandle;
  try {
    const startIn = await toPickerStartIn(await getDefaultDirectoryHandle(platformKey));
    handle = await showDirPicker({
      ...(startIn ? { startIn } : {}),
      id: buildPickerId('default', platformKey),
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    const detail = describePickerFailure(error);
    logger.error('Default directory selection failed', { platformKey, error: detail });
    throw new DirectoryError(ERROR_CODE.UNKNOWN, `目录选择器未能打开（${detail}）`, { platformKey });
  }

  const permission = await requestHandlePermission(handle, 'readwrite');
  if (permission !== 'granted') {
    throw new DirectoryError(
      ERROR_CODE.DIRECTORY_PERMISSION_DENIED,
      `目录「${handle.name}」未获读写授权（${permission}）`,
      { platformKey, permission },
    );
  }
  return handle;
}

// ── 文件读写（仅 Handle 通道） ─────────────────────────

/** 相对路径解析结果 + 用于回传的统一路径字符串 */
interface ResolvedEntryPath {
  readonly parts: RelativePathParts;
  /** 统一形态的相对路径（如 `design/design-js.md`）；非法路径为空字符串 */
  readonly relativePath: string;
}

/** 解析条目路径；非法路径（含 `..` 逃逸、空路径）时 relativePath 为空 */
function resolveEntryPath(value: unknown): ResolvedEntryPath {
  const parts = parseRelativePath(value);
  return { parts, relativePath: joinRelativePath(parts.dirSegments, parts.fileName) };
}

/**
 * 按目录段逐级解析子目录句柄。
 * `create=false` 时任一环节缺失即返回 null（用于读取 / 存在性检查）。
 */
async function resolveSubDirectory(
  baseHandle: FileSystemDirectoryHandle,
  dirSegments: readonly string[],
  options: ResolveDirectoryOptions,
): Promise<FileSystemDirectoryHandle | null> {
  let current: FileSystemDirectoryHandle = baseHandle;
  for (const segment of dirSegments) {
    try {
      current = await current.getDirectoryHandle(segment, options.create ? { create: true } : {});
    } catch (error: unknown) {
      if (options.create) throw error;
      return null;
    }
  }
  return current;
}

/**
 * 解析当前页面绑定的写入目录句柄。
 *
 * 只要求页面 scope 句柄存在（目录归属由 fromcode 校验在 ensureFromcodeBeforeWrite
 * 中把守）；无编码页面不做归属校验，凭 scope 句柄直接读写。
 */
async function resolvePageBoundDirectoryHandle(
  tab: TabInfo | number,
  pageType: string,
): Promise<ExtendedDirectoryHandle> {
  const handle = await resolveTargetDirectoryHandle(tab, pageType);
  if (!handle) {
    throw new DirectoryError(
      ERROR_CODE.DIRECTORY_NOT_SELECTED,
      '当前页面尚未选择目标目录，请点击「更新当前路径」重新选择后再写入。',
    );
  }
  return handle as ExtendedDirectoryHandle;
}

/** 通过 Handle 通道写文件（支持子目录；路径只含目录段时仅创建文件夹） */
async function writeFilesViaHandle(
  handle: ExtendedDirectoryHandle,
  fileEntries: readonly FileWriteEntry[],
): Promise<WriteFilesResult> {
  const permission = await requestHandlePermission(handle, 'readwrite');
  if (permission !== 'granted') {
    throw new DirectoryError(ERROR_CODE.DIRECTORY_PERMISSION_DENIED, '目录写入权限未授予，请点击「更新当前路径」重新授权后重试。');
  }

  let written = 0;
  let directories = 0;
  for (const entry of fileEntries) {
    const { parts, relativePath } = resolveEntryPath(entry.fileName);
    if (!relativePath) {
      logger.warn('Skip write entry with invalid relative path', { fileName: String(entry.fileName || '') });
      continue;
    }

    try {
      // 先探测是否已存在，用于区分「新建目录」与「复用已有目录」
      let targetDir = await resolveSubDirectory(handle, parts.dirSegments, { create: false });
      if (!targetDir) {
        targetDir = await resolveSubDirectory(handle, parts.dirSegments, { create: true });
        if (parts.dirSegments.length > 0) directories++;
      }
      if (!targetDir) continue;

      // 只指定目录（如 `sql/`）：文件夹建好即完成，不写文件
      if (!parts.fileName) continue;

      await writeFileContent(targetDir, parts.fileName, entry.content);
      written++;
    } catch (error: unknown) {
      if (error instanceof DirectoryError && error.code === ERROR_CODE.FILE_WRITE_CLEANUP) throw error;
      logger.warn('Handle write file failed', { fileName: relativePath, error: String(error) });
    }
  }

  return { written, directories, directoryPath: handle.name };
}

/** 通过 Handle 通道读取文件（支持子目录） */
async function readFilesViaHandle(
  handle: ExtendedDirectoryHandle,
  fileNames: readonly string[],
): Promise<FileReadEntry[]> {
  const entries: FileReadEntry[] = [];

  for (const fileName of fileNames) {
    const { parts, relativePath } = resolveEntryPath(fileName);
    if (!relativePath || !parts.fileName) {
      entries.push({ fileName: String(fileName || ''), content: '', exists: false });
      continue;
    }

    const targetDir = await resolveSubDirectory(handle, parts.dirSegments, { create: false });
    if (!targetDir) {
      entries.push({ fileName: relativePath, content: '', exists: false });
      continue;
    }

    try {
      const fileHandle = await targetDir.getFileHandle(parts.fileName);
      const file = await fileHandle.getFile();
      const content = await file.text();
      entries.push({ fileName: relativePath, content, exists: true });
    } catch {
      entries.push({ fileName: relativePath, content: '', exists: false });
    }
  }

  return entries;
}

/** 通过 Handle 通道检查文件存在性（支持子目录） */
async function statFilesViaHandle(
  handle: ExtendedDirectoryHandle,
  fileNames: readonly string[],
): Promise<FileStatEntry[]> {
  const entries: FileStatEntry[] = [];

  for (const fileName of fileNames) {
    const { parts, relativePath } = resolveEntryPath(fileName);
    if (!relativePath || !parts.fileName) {
      entries.push({ fileName: String(fileName || ''), exists: false, size: null, modifiedAt: '' });
      continue;
    }

    const targetDir = await resolveSubDirectory(handle, parts.dirSegments, { create: false });
    if (!targetDir) {
      entries.push({ fileName: relativePath, exists: false, size: null, modifiedAt: '' });
      continue;
    }

    try {
      const fileHandle = await targetDir.getFileHandle(parts.fileName);
      const file = await fileHandle.getFile();
      entries.push({
        fileName: relativePath,
        exists: true,
        size: file.size,
        modifiedAt: new Date(file.lastModified).toISOString(),
      });
    } catch {
      entries.push({ fileName: relativePath, exists: false, size: null, modifiedAt: '' });
    }
  }

  return entries;
}

/** 写入前校验目录归属，并迁移、移除旧版遗留的 fromcode 标记文件。 */
async function ensureFromcodeBeforeWrite(
  handle: ExtendedDirectoryHandle,
  tab: TabInfo | number,
  pageType: string,
): Promise<void> {
  const pageUrl = typeof tab === 'object' ? (tab.url || tab.pendingUrl || '') : '';
  const formCode = extractPageFormCode(pageUrl, pageType);
  if (!formCode) return;

  const pageScope = createTargetDirectoryPageScope(tab, pageType);
  if (!pageScope) return;

  const status = await verifyDirectoryFromcode(handle, pageUrl, pageType, pageScope);
  if (status === 'mismatched') {
    const stored = await readDirectoryFromcode(handle);
    throw new DirectoryError(
      ERROR_CODE.DIRECTORY_NOT_SELECTED,
      `目标目录已关联其他表单（fromcode: ${stored || '未知编码'}），已阻止写入。如需关联当前页面，请点击「更新当前路径」重新选择该目录并确认强制关联。`,
    );
  }
  if (status === 'unreadable') {
    throw new DirectoryError(
      ERROR_CODE.DIRECTORY_PERMISSION_DENIED,
      '无法验证目标目录的表单归属，请重新授权或重新选择目标目录后重试。',
    );
  }

  const association = await getFromcodeAssociation(pageScope);
  const forced = association?.formCode === formCode && association.forced;
  await setFromcodeAssociation(pageScope, formCode, forced);
  await removeLegacyDirectoryFromcode(handle);
}

/** 写文件到当前绑定目录 */
export async function writeFilesToSelection(
  tab: TabInfo | number,
  pageType: string,
  fileEntries: readonly FileWriteEntry[],
): Promise<WriteFilesResult> {
  if (!Array.isArray(fileEntries) || fileEntries.length === 0) {
    return { written: 0, directories: 0 };
  }

  const handle = await resolvePageBoundDirectoryHandle(tab, pageType);
  await ensureFromcodeBeforeWrite(handle, tab, pageType);
  return await writeFilesViaHandle(handle, fileEntries);
}

/** 从当前绑定目录读取文件列表 */
export async function readFilesFromSelection(
  tab: TabInfo | number,
  pageType: string,
  fileNames: readonly string[],
): Promise<ReadFilesResult> {
  if (!Array.isArray(fileNames) || fileNames.length === 0) {
    return { files: [] };
  }

  const handle = await resolvePageBoundDirectoryHandle(tab, pageType);
  const permission = await requestHandlePermission(handle, 'read');
  if (permission !== 'granted') {
    throw new DirectoryError(ERROR_CODE.DIRECTORY_PERMISSION_DENIED, '目录读取权限未授予，请点击「更新当前路径」重新授权后重试。');
  }
  const files = await readFilesViaHandle(handle, fileNames);
  return { files };
}

/** 检查目标目录中文件是否存在 */
export async function fileExistsInSelection(
  tab: TabInfo | number,
  pageType: string,
  fileNames: readonly string[],
): Promise<StatFilesResult> {
  if (!Array.isArray(fileNames) || fileNames.length === 0) {
    return { files: [] };
  }

  const handle = await resolvePageBoundDirectoryHandle(tab, pageType);
  const permission = await requestHandlePermission(handle, 'read');
  if (permission !== 'granted') {
    throw new DirectoryError(ERROR_CODE.DIRECTORY_PERMISSION_DENIED, '目录读取权限未授予，请点击「更新当前路径」重新授权后重试。');
  }
  const files = await statFilesViaHandle(handle, fileNames);
  return { files };
}

// ── 句柄权限状态（重启后重新授权） ────────────────────

/** 目录句柄权限状态：none 表示未绑定句柄 */
export type DirectoryPermissionState = 'granted' | 'denied' | 'prompt' | 'none';

function normalizePermissionState(state: PermissionState): DirectoryPermissionState {
  return state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt';
}

/** 查询当前有效句柄的权限状态（不触发授权弹窗） */
export async function getTargetDirectoryPermission(
  tab: TabInfo | number,
  pageType: string,
): Promise<DirectoryPermissionState> {
  const handle = await resolveTargetDirectoryHandle(tab, pageType);
  if (!handle) return 'none';
  return normalizePermissionState(await queryHandlePermission(handle));
}

/** 主动请求当前句柄授权（会触发浏览器授权弹窗，需在用户手势中调用） */
export async function requestTargetDirectoryPermission(
  tab: TabInfo | number,
  pageType: string,
): Promise<DirectoryPermissionState> {
  const handle = await resolveTargetDirectoryHandle(tab, pageType);
  if (!handle) return 'none';
  return normalizePermissionState(await requestHandlePermission(handle, 'readwrite'));
}

// ── 指定句柄权限（历史路径恢复专用） ──────────────────

/**
 * 查询指定句柄的权限状态（不触发授权弹窗）。
 * 用于历史路径恢复：直接检查历史句柄自身权限，
 * 而非通过 resolveTargetDirectoryHandle 的 scope 解析（后者可能命中当前页面的其他句柄）。
 */
export async function queryHandlePermissionState(
  handle: FileSystemDirectoryHandle,
): Promise<DirectoryPermissionState> {
  return normalizePermissionState(await queryHandlePermission(handle));
}

/**
 * 请求指定句柄的读写授权（会触发浏览器授权弹窗，需在用户手势中调用）。
 * 用于历史路径恢复：直接对历史句柄请求授权。
 */
export async function requestHandlePermissionState(
  handle: FileSystemDirectoryHandle,
): Promise<DirectoryPermissionState> {
  return normalizePermissionState(await requestHandlePermission(handle, 'readwrite'));
}

// 重新导出
export {
  getStoredDirectoryPath,
  saveHandleSelection,
  clearTabTargetDirectoryData,
};