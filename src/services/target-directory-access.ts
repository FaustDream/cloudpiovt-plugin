/**
 * 目标目录透明读写层（纯浏览器模式）。
 *
 * 使用 File System Access API（showDirectoryPicker + FileSystemDirectoryHandle）
 * 实现本地目录的读写，无需安装任何 Native Host。
 *
 * 目录选择、文件读写均在 popup/options 页面发起。
 */

import { logger } from '../lib/logger.js';
import { DirectoryError, ValidationError, ERROR_CODE } from '../lib/errors.js';
import { parseRelativePath, joinRelativePath, type RelativePathParts } from '../lib/utils.js';
import { getDefaultDirectoryHandle } from '../lib/directory/file-handle-db.js';
import { getPlatformKeyFromPageType } from './config.js';
import {
  getStoredDirectoryPath,
  saveHandleSelection,
  clearTabTargetDirectoryData,
  resolveTargetDirectoryHandle,
} from './target-directory-state.js';
import type { PlatformKey } from '../types/platform.js';

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
  /** 目录选择器初始打开位置；缺省使用中性位置（见 NEUTRAL_PICKER_START_IN） */
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
 * 调用方没有可用句柄时必须显式传一个中性位置：不给 startIn 时浏览器会复用
 * 「上一次选择过的目录」，会把另一个平台的默认目录 / 其他页面的历史目录带进来，
 * 这正是「氚云选择器打开在云枢默认目录」的成因。
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

/**
 * 弹出目录选择器。
 *
 * 始终显式指定初始位置，并逐级降级：请求位置 → 中性位置 → 不带 startIn。
 * 不传 startIn 时浏览器会复用「上一次选择过的目录」（可能是另一个平台或另一个
 * 页面遗留的位置），因此只在指定位置都不可用时才作为最后兜底使用。
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

  const candidates: Array<PickerStartIn | undefined> = options.startIn
    ? [options.startIn, NEUTRAL_PICKER_START_IN, undefined]
    : [NEUTRAL_PICKER_START_IN, undefined];

  let lastError: unknown = null;
  for (const startIn of candidates) {
    try {
      return await pick(startIn);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error; // 用户取消
      lastError = error;
      logger.warn('目录选择器初始位置不可用，降级重试', {
        startIn: typeof startIn === 'string' ? startIn : 'handle',
        error: String(error),
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
 * 取得可作为目录选择器初始位置的句柄。
 *
 * 未授权的句柄可能被浏览器拒绝作为 startIn，从而静默落到系统默认位置——这正是
 * 「选择器没打开在设置里绑定的默认目录」的成因之一。这里在用户手势内补一次授权
 * 再返回原句柄：授权成功即可正确定位；授权失败也仍用原句柄尝试，由
 * showDirPicker 的降级链兜底。
 */
async function ensureUsablePickerStartIn(
  handle: FileSystemDirectoryHandle | undefined,
): Promise<FileSystemDirectoryHandle | undefined> {
  if (!handle) return undefined;
  if (await queryHandlePermission(handle) === 'granted') return handle;

  const granted = await requestHandlePermission(handle, 'readwrite');
  if (granted !== 'granted') {
    logger.warn('目录句柄未授权，选择器初始位置可能无法定位', { permission: granted });
  }
  return handle;
}

/**
 * 解析目录选择器初始打开位置（startIn）对应的句柄。
 *
 * 优先级（由高到低）：
 *  1) 当前页面 scope 句柄（该页面已绑定目录，选择器定位到当前目录）
 *  2) 当前平台默认目录句柄（页面未绑定时，选择器定位到该平台自己的默认目录）
 *  3) 无 → showDirPicker 使用中性位置（绝不继承其他平台 / 其他页面遗留的位置）
 *
 * 解析直接复用 resolveTargetDirectoryHandle，避免展示、读写和选择器各自维护
 * 不同的回退链；旧共享槽和其他平台目录不会进入此流程。
 */
async function resolveDirectoryPickerStartIn(
  tab: TabInfo | number,
  pageType: string,
): Promise<FileSystemDirectoryHandle | undefined> {
  // 即使句柄当前权限为 prompt/denied 也继续尝试作为 startIn：目录选择器的定位信息与
  // 授权状态是两件事；先补一次授权以最大化定位成功率，失效时由降级链兜底。
  return ensureUsablePickerStartIn(await resolveTargetDirectoryHandle(tab, pageType));
}

/** 弹出原生目录选择器并保存绑定 */
export async function selectHandleDirectory(
  tab: TabInfo | number,
  pageType = 'default',
): Promise<SelectDirectoryResult | null> {
  if (!supportsDirectoryPicker()) return null;

  try {
    // 「更新当前路径」默认打开「当前有效路径 → 项目默认目录」对应的句柄（startIn），
    // 禁止回退到系统全局默认目录 / 上一次缓存目录 / 其他项目历史目录。
    const startIn = await resolveDirectoryPickerStartIn(tab, pageType);

    const handle = await showDirPicker({
      ...(startIn ? { startIn } : {}),
      id: buildPickerId('page', getPlatformKeyFromPageType(pageType)),
    });
    // 选择后立即确认读写权限已授予（showDirectoryPicker({ mode: 'readwrite' }) 会弹浏览器自带授权，
    // 授权状态写入浏览器缓存，后续 queryPermission/requestPermission 直接复用缓存）
    const permission = await requestHandlePermission(handle, 'readwrite');
    if (permission !== 'granted') {
      logger.warn('Directory readwrite permission not granted', { pageType, permission });
      return null;
    }
    await saveHandleSelection(handle, tab, pageType);
    return { path: '', source: 'handle', label: handle.name || '' };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    logger.error('Handle directory selection failed', { error: String(error) });
    return null;
  }
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
 * 初始位置只用「本平台自己的默认目录句柄」；本平台尚未配置时使用中性位置。
 * 绝不继承另一个平台 / 其他页面遗留的位置——否则很容易把云枢的工作目录绑成
 * 氚云的默认目录，导致平台默认目录指向错误的工作目录。
 *
 * 选择时直接请求读写权限（默认目录会被用于写入）。
 * 失败（非用户取消）抛出异常，由调用方提示。
 */
export async function selectPlatformDefaultDirectory(
  platformKey: PlatformKey,
): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsDirectoryPicker()) {
    throw new ValidationError('当前浏览器不支持 File System Access API', {
      hint: '请使用 Chrome 86+ 或 Edge 86+ 版本',
    });
  }

  const startIn = await ensureUsablePickerStartIn(await getDefaultDirectoryHandle(platformKey));

  try {
    const handle = await showDirPicker({
      ...(startIn ? { startIn } : {}),
      id: buildPickerId('default', platformKey),
    });
    const permission = await requestHandlePermission(handle, 'readwrite');
    if (permission !== 'granted') {
      throw new ValidationError('默认目录未授予读写权限', { platformKey, permission });
    }
    return handle;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
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

      const fileHandle = await targetDir.getFileHandle(parts.fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(entry.content);
      await writable.close();
      written++;
    } catch (error: unknown) {
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

/** 写文件到当前绑定目录 */
export async function writeFilesToSelection(
  tab: TabInfo | number,
  pageType: string,
  fileEntries: readonly FileWriteEntry[],
): Promise<WriteFilesResult> {
  if (!Array.isArray(fileEntries) || fileEntries.length === 0) {
    return { written: 0, directories: 0 };
  }

  const handle = await resolveTargetDirectoryHandle(tab, pageType) as ExtendedDirectoryHandle | undefined;
  if (!handle) {
    throw new DirectoryError(ERROR_CODE.DIRECTORY_NOT_SELECTED, '请先选择目标目录。');
  }

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

  const handle = await resolveTargetDirectoryHandle(tab, pageType) as ExtendedDirectoryHandle | undefined;
  if (!handle) {
    throw new DirectoryError(ERROR_CODE.DIRECTORY_NOT_SELECTED, '请先选择目标目录。');
  }

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

  const handle = await resolveTargetDirectoryHandle(tab, pageType) as ExtendedDirectoryHandle | undefined;
  if (!handle) {
    throw new DirectoryError(ERROR_CODE.DIRECTORY_NOT_SELECTED, '请先选择目标目录。');
  }

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