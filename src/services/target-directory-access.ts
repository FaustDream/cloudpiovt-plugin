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
import { getPlatformKeyFromPageType } from './config.js';
import {
  getStoredDirectoryPath,
  saveHandleSelection,
  clearTabTargetDirectoryData,
  resolveTargetDirectoryHandle,
} from './target-directory-state.js';
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
}

export interface WriteFilesResult {
  /** 实际写入的文件数 */
  readonly written: number;
  /** 新建（或确认存在）的目录数 */
  readonly directories: number;
  /** 目录标签（Handle 通道为目录名） */
  readonly directoryPath?: string;
  /** 写入失败的文件数（单个文件级失败，不影响其它文件） */
  readonly failed: number;
  /** 写入失败的文件相对路径 */
  readonly failedFiles: readonly string[];
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
  /** 声明在 DOM.AsyncIterable 库中，当前 tsconfig 未启用，浏览器实际提供 */
  values?(): AsyncIterableIterator<FileSystemHandle>;
};

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
 * 弹出目录选择器。
 *
 * 必须在用户点击的同步栈里调用：任何前置 await（读 IndexedDB 句柄、查权限）都会把
 * 调用推出用户激活有效期，表现为选择器既不出现也不报错。起始位置交给选择器 id 记忆，
 * 因此不再传 startIn（传 startIn 需要先解析句柄，正是这个 await 的位置）。
 */
async function showDirPicker(pickerId: string): Promise<FileSystemDirectoryHandle> {
  const w = window as unknown as {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
      id?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  };
  if (typeof w.showDirectoryPicker !== 'function') {
    throw new ValidationError('showDirectoryPicker not available', { available: false });
  }

  // 选择时直接请求读写权限：授权状态由浏览器缓存，后续操作从缓存获取，避免首次回写失败
  return await w.showDirectoryPicker({ mode: 'readwrite', id: pickerId });
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
    // 第一句就打开选择器：任何前置 await 都会把调用推出用户点击的有效期，
    // 表现为选择器既不出现也不报错。
    handle = await showDirPicker(buildPickerId('page', getPlatformKeyFromPageType(pageType)));
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
  return { path: '', source: 'handle', label: selection.label };
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
 * 起始位置由按平台分桶的选择器 id 记忆决定，因此不会停到另一个平台上次选定的目录。
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
    handle = await showDirPicker(buildPickerId('default', platformKey));
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

/** 目录句柄已失效（目录被移动 / 删除 / 授权被收回）时浏览器抛出的异常 */
function isDirectoryGoneError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === 'NotFoundError'
    || error.name === 'NotAllowedError'
    || error.name === 'InvalidStateError';
}

function createDirectoryGoneError(handle: FileSystemDirectoryHandle, cause: unknown): DirectoryError {
  return new DirectoryError(
    ERROR_CODE.DIRECTORY_UNAVAILABLE,
    `目标目录「${handle.name}」已无法访问（可能被移动、删除或授权已失效），请点击「更新当前路径」重新选择。`,
    { directory: handle.name, error: String(cause) },
  );
}

/**
 * 确认根目录句柄仍然可用。
 *
 * `getFileHandle` 对「文件不存在」与「目录已失效」抛同一个 `NotFoundError`，无法区分；
 * `values()` 迭代只在根目录失效时抛错，空目录正常返回 `done`，因此取首项即可用最低成本判断。
 */
async function assertDirectoryReachable(handle: ExtendedDirectoryHandle): Promise<void> {
  if (typeof handle.values !== 'function') return;
  try {
    await handle.values().next();
  } catch (error: unknown) {
    if (!isDirectoryGoneError(error)) throw error;
    throw createDirectoryGoneError(handle, error);
  }
}

/**
 * 解析当前页面绑定的写入目录句柄。
 *
 * 只要求页面 scope 句柄存在即可读写，不判断目录属于哪个表单（归属由用户自己负责）。
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
  await assertDirectoryReachable(handle);

  let written = 0;
  let directories = 0;
  const failedFiles: string[] = [];
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
      // 目录在写入过程中被移动或删除：剩余文件必然同样失败，整体上报而不是逐条刷日志
      if (isDirectoryGoneError(error)) throw createDirectoryGoneError(handle, error);
      failedFiles.push(relativePath);
      logger.warn('Handle write file failed', { fileName: relativePath, error: String(error) });
    }
  }

  return {
    written,
    directories,
    directoryPath: handle.name,
    failed: failedFiles.length,
    failedFiles,
  };
}

/** 通过 Handle 通道读取文件（支持子目录） */
async function readFilesViaHandle(
  handle: ExtendedDirectoryHandle,
  fileNames: readonly string[],
): Promise<FileReadEntry[]> {
  await assertDirectoryReachable(handle);
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
  await assertDirectoryReachable(handle);
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

/** 写文件到当前绑定目录 */
export async function writeFilesToSelection(
  tab: TabInfo | number,
  pageType: string,
  fileEntries: readonly FileWriteEntry[],
): Promise<WriteFilesResult> {
  if (!Array.isArray(fileEntries) || fileEntries.length === 0) {
    return { written: 0, directories: 0, failed: 0, failedFiles: [] };
  }

  const handle = await resolvePageBoundDirectoryHandle(tab, pageType);
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