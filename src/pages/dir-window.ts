/**
 * 目录绑定窗口。
 *
 * 使用独立窗口而不是动作弹窗：动作弹窗在浏览器失焦（切到资源管理器取文件夹）时会关闭，
 * 收不到拖放；独立窗口可以稳定接收拖入的文件夹。
 *
 * 拖入文件夹是「不经过系统目录对话框」的绑定入口：Chrome 在 Windows 上存在
 * 「在对话框中选完文件夹后返回 AbortError」的已知问题（Edge 不受影响），
 * 该问题期间只能靠这条路径绑定新目录。
 *
 * 窗口参数（由弹窗打开时传入）：tabId / url / pageType，三者共同决定页面目录 scope。
 */

import { DirectoryError, ERROR_CODE } from '../lib/errors.js';
import { getStoredDirectoryPath } from '../services/target-directory-state.js';
import {
  confirmForcodeOverride,
  selectAndBindDirectory,
  selectDroppedDirectory,
  type SelectDirectoryResult,
} from '../services/target-directory-access.js';

/** DataTransferItem.getAsFileSystemHandle 尚未进入 TS 标准库，按可选能力访问 */
interface HandleCapableDataTransferItem extends DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}

type StatusLevel = 'info' | 'success' | 'error';

interface WindowParams {
  readonly tab: { readonly id?: number; readonly url?: string };
  readonly pageType: string;
}

const params = new URLSearchParams(window.location.search);
const windowParams: WindowParams = {
  tab: {
    id: Number(params.get('tabId') || '') || undefined,
    url: params.get('url') || '',
  },
  pageType: params.get('pageType') || 'default',
};

/** 拖入但尚未拿到写入授权的目录；点「授予写入权限」后继续绑定 */
let pendingHandle: FileSystemDirectoryHandle | null = null;
/** 正在绑定：避免同时发起两次绑定 */
let busy = false;
/** 已绑定成功：窗口即将关闭，不再接受新的绑定 */
let finished = false;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function setStatus(message: string, level: StatusLevel): void {
  const el = $('status');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.className = `status is-${level}`;
}

function formatError(error: unknown): string {
  if (error instanceof DirectoryError) return error.message;
  if (error instanceof DOMException) return `${error.name}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isPermissionFailure(error: unknown): boolean {
  return error instanceof DirectoryError && error.code === ERROR_CODE.DIRECTORY_PERMISSION_DENIED;
}

// ── 绑定流程 ──────────────────────────────────────────

/** 关闭本窗口（窗口已被用户关掉时忽略） */
async function closeWindow(): Promise<void> {
  try {
    const current = await chrome.windows.getCurrent();
    if (typeof current.id === 'number') await chrome.windows.remove(current.id);
  } catch {
    // 窗口已不存在，无需处理
  }
}

/** 绑定成功：给出结论并关闭窗口 */
function finishSuccess(label: string): void {
  finished = true;
  $('drop-zone')?.classList.add('is-done');
  setStatus(`已绑定目录「${label}」，本窗口即将关闭，请回到页面重新打开插件。`, 'success');
  setTimeout(() => { void closeWindow(); }, 2000);
}

/** 目录已关联其他表单：确认后强制关联并结束流程 */
async function confirmAndFinalize(
  handle: FileSystemDirectoryHandle,
  label: string,
  storedCode: string,
): Promise<void> {
  const confirmed = window.confirm(
    `目标目录「${label}」已关联其他表单（fromcode: ${storedCode || '未知编码'}）。\n\n` +
    '是否仍要关联到当前页面？',
  );
  if (!confirmed) {
    setStatus(`目录「${label}」属于其他表单，未关联。请换一个文件夹，或在提示中确认强制关联。`, 'error');
    return;
  }

  const forced = await confirmForcodeOverride(handle, windowParams.tab, windowParams.pageType);
  if (!forced) {
    setStatus('强制关联失败，请重试。', 'error');
    return;
  }
  finishSuccess(label);
}

/**
 * 绑定一个已取得的目录句柄。
 *
 * 拖入的句柄只带读授权，这里统一补读写授权；授权失败时把句柄留在这里，
 * 由「授予写入权限」按钮在用户点击（带手势）时重试。
 */
async function bindHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  if (busy || finished) return;
  busy = true;
  setStatus(`正在绑定「${handle.name}」...`, 'info');
  let result: SelectDirectoryResult;
  try {
    result = await selectDroppedDirectory(handle, windowParams.tab, windowParams.pageType);
  } catch (error: unknown) {
    busy = false;
    if (isPermissionFailure(error)) {
      pendingHandle = handle;
      const permissionBtn = $('permission-btn');
      if (permissionBtn) permissionBtn.hidden = false;
      setStatus(`目录「${handle.name}」还需要写入授权：点下方「授予写入权限」继续。`, 'error');
      return;
    }
    setStatus(`绑定失败：${formatError(error)}`, 'error');
    return;
  }
  busy = false;

  pendingHandle = null;
  const permissionBtn = $('permission-btn');
  if (permissionBtn) permissionBtn.hidden = true;

  if (result.fromcodeConfirm) {
    await confirmAndFinalize(handle, result.label, result.fromcodeConfirm.fromcodeValue);
    return;
  }
  finishSuccess(result.label);
}

/** 系统目录对话框：Edge / 未受影响的 Chrome 可用，失败原因直接展示 */
async function useSystemDialog(): Promise<void> {
  if (busy || finished) return;
  busy = true;
  const button = $('picker-btn') as HTMLButtonElement | null;
  if (button) button.disabled = true;
  setStatus('已打开系统目录对话框...', 'info');
  try {
    const result = await selectAndBindDirectory(windowParams.tab, { pageType: windowParams.pageType });
    if (!result) {
      setStatus(
        '系统对话框没有返回目录：Chrome 在 Windows 上选完文件夹会返回 AbortError（已知问题，Edge 不受影响）。请改用拖入文件夹。',
        'error',
      );
      return;
    }
    if (result.fromcodeConfirm) {
      await confirmAndFinalize(result.fromcodeConfirm.handle, result.label, result.fromcodeConfirm.fromcodeValue);
      return;
    }
    finishSuccess(result.label);
  } catch (error: unknown) {
    setStatus(`系统对话框不可用：${formatError(error)}。请改用拖入文件夹。`, 'error');
  } finally {
    if (!finished) busy = false;
    if (button && !finished) button.disabled = false;
  }
}

// ── 拖放 ──────────────────────────────────────────────

function hasFilePayload(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** 同步收齐拖入项的句柄请求（getAsFileSystemHandle 只在 drop 同步阶段可用） */
function collectDroppedHandleRequests(
  dataTransfer: DataTransfer | null,
): Array<Promise<FileSystemHandle | null>> {
  if (!dataTransfer) return [];
  const requests: Array<Promise<FileSystemHandle | null>> = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    const capable = item as HandleCapableDataTransferItem;
    if (typeof capable.getAsFileSystemHandle !== 'function') continue;
    requests.push(capable.getAsFileSystemHandle());
  }
  return requests;
}

/** 取第一个拖入的文件夹句柄；只拖入文件时返回 null */
async function firstDroppedDirectory(
  requests: Array<Promise<FileSystemHandle | null>>,
): Promise<FileSystemDirectoryHandle | null> {
  for (const request of requests) {
    try {
      const handle = await request;
      if (handle && handle.kind === 'directory') return handle as FileSystemDirectoryHandle;
    } catch {
      // 单个条目不可用不影响其它条目
    }
  }
  return null;
}

async function handleDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  const zone = $('drop-zone');
  if (zone) zone.classList.remove('is-over');

  const requests = collectDroppedHandleRequests(event.dataTransfer);
  if (requests.length === 0) return;

  const handle = await firstDroppedDirectory(requests);
  if (!handle) {
    setStatus('拖入的内容不是文件夹。请拖入一个文件夹；拖入文件不会绑定目录。', 'error');
    return;
  }
  await bindHandle(handle);
}

function bindDropZone(): void {
  window.addEventListener('dragenter', (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    $('drop-zone')?.classList.add('is-over');
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    const inside = event.clientX > 0 && event.clientY > 0
      && event.clientX < window.innerWidth && event.clientY < window.innerHeight;
    if (inside) return;
    $('drop-zone')?.classList.remove('is-over');
  });
  window.addEventListener('drop', (event) => { void handleDrop(event); });
}

// ── 初始化 ────────────────────────────────────────────

async function init(): Promise<void> {
  $('picker-btn')?.addEventListener('click', () => { void useSystemDialog(); });
  $('permission-btn')?.addEventListener('click', () => {
    if (pendingHandle) void bindHandle(pendingHandle);
  });
  bindDropZone();

  const pageUrlEl = $('page-url');
  if (pageUrlEl) pageUrlEl.textContent = windowParams.tab.url || '未取到页面地址';

  const current = await getStoredDirectoryPath(windowParams.tab, windowParams.pageType);
  const currentEl = $('current-dir');
  if (currentEl && current) {
    currentEl.textContent = `当前目录：${current}`;
    currentEl.hidden = false;
  }
}

void init();
