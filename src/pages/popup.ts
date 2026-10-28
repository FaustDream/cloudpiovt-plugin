/**
 * Popup 弹窗控制器 —— 扩展 UI 主入口。
 *
 * 负责平台自动识别、目录选择/搜索、云枢前端抓取/回写、
 * 业务规则抓取/回写、氚云一键抓取写入/回写、预检诊断和状态日志。
 *
 * 架构：直接调用 chrome.scripting.executeScript 注入页面函数，
 * 不经过 background message hub（与原始架构一致，避免延迟）。
 */

// ── Types & Imports ───────────────────────────────────
import type { PlatformKey, PageTypeConfig } from '../types/platform.js';
import type { ExtensionConfig } from '../types/config.js';
import type { ArtifactConfig, ArtifactDefinition } from '../types/artifacts.js';
import type { RecentDirectoryEntry } from '../services/recent-target-directories.js';
import type { WriteFilesResult } from '../services/target-directory-access.js';
import type { PreflightResult } from '../services/preflight-diagnostics.js';
import type { PageCaptureResult, PageWritebackResult, BizRuleProbeResult, BizRuleWritebackResult, H3yunCodeEditorProbeResult, H3yunCodeEditorWritebackResult, H3yunDesignerMetadataResult } from '../types/injection.js';

import { logger } from '../lib/logger.js';
import { DirectoryError, ERROR_CODE } from '../lib/errors.js';
import { resolvePageTypeConfig, resolveH3yunDesignMode, loadConfig, isRecognizedPlatformUrl, getFallbackDirectoryPathByPlatform } from '../services/config.js';
import { pageCaptureMain } from '../injection/cloudpivot-capture.js';
import { pageWritebackMain } from '../injection/cloudpivot-writeback.js';
import { bizRuleProbeMain } from '../injection/cloudpivot-bizrule-probe.js';
import { bizRuleWritebackMain } from '../injection/cloudpivot-bizrule-writeback.js';
import { h3yunDesignerMetadataMain } from '../injection/h3yun-designer-metadata.js';
import { h3yunCodeEditorProbeMain } from '../injection/h3yun-code-probe.js';
import { h3yunCodeEditorWritebackMain } from '../injection/h3yun-code-writeback.js';
import { resolveH3yunBackendFileName, resolveH3yunFrontendFileName, buildH3yunFromCodeContent } from '../lib/platform/h3yun-code.js';
import { buildFromCodeContent, extractReadmeMetadataFromHtml } from '../lib/platform/readme-parser.js';
import {
  ARTIFACT_IDS,
  FILE_MAPPING_KEY_TO_ARTIFACT_ID,
  FROM_CODE_FILE_NAME,
  buildDefaultArtifactConfig,
} from '../lib/platform/artifacts.js';
import { BIZ_RULE_USAGE_NOTICE, buildBizRuleMissingFileDetails } from '../lib/platform/bizrule-constraints.js';
import {
  getRecentTargetDirectories,
  clearRecentTargetDirectoriesByPlatform,
  resolveRecentEntryPlatform,
} from '../services/recent-target-directories.js';
import {
  getStoredDirectoryPath,
  saveHandleSelection,
  type HandleSelectionResult,
} from '../services/target-directory-state.js';
import {
  buildScopeOptions,
  formatArtifactScopeBadge,
  formatArtifactScopeSummary,
  hasPlatformScopeOverrides,
  platformScopeOverrides,
  resolveArtifactScopeState,
  toggleScopeArtifact,
  withPlatformScopeOverrides,
  withoutPlatformScopeOverrides,
  type ArtifactScopeInput,
  type ArtifactScopeOverrides,
} from '../lib/platform/artifact-scope.js';
import { loadScopeOverrides, saveScopeOverrides, clearScopeOverrides } from '../services/artifact-scope-store.js';
import {
  selectAndBindDirectory,
  writeFilesToSelection,
  readFilesFromSelection,
  fileExistsInSelection,
  queryHandlePermissionState,
  requestHandlePermissionState,
  requestTargetDirectoryPermission,
  confirmForcodeOverride,
} from '../services/target-directory-access.js';
import { checkTargetDirectoryHealth } from '../services/target-directory-check.js';
import type { TargetDirectoryCheckResult } from '../services/target-directory-check.js';
import { getTargetDirectoryHandleForScope } from '../lib/directory/file-handle-db.js';
import {
  buildMissingArtifactFiles,
  resolveArtifactEnabled,
  toExistingPathSet,
  DIRECTORY_PATH_SUFFIX,
} from '../services/artifact-files.js';
import {
  getPlatformArtifacts,
  loadArtifactConfig,
} from '../services/artifacts.js';
import {
  createPreflightResult,
  hasBlockingPreflightResult,
  saveLastDiagnosticPackage,
  buildDiagnosticPackage,
} from '../services/preflight-diagnostics.js';
import { PREFLIGHT_OPERATION_IDS, PLATFORM_LABELS } from '../lib/constants.js';
import { CURRENT_EXTENSION_VERSION } from '../lib/release-notes.js';
import { normalizeArtifactPath } from '../lib/utils.js';
import {
  type PageContext,
  type LogEntry,
  H3YUN_CODE_EDITOR_CONFIG,
  extractLastFolderName,
  escapeHtml,
  filterHistoryRecords,
  resolveCloudpivotComponentName,
  formatProbeFailure,
  normalizeExcessBlankLines,
  resolveH3yunCodeFileName,
  buildDownloadTimestamp,
} from './popup-utils.js';

// ── Internal State ────────────────────────────────────

const state = {
  pageContext: { url: '', title: '' } as PageContext,
  pageTypeConfig: null as PageTypeConfig | null,
  config: null as ExtensionConfig | null,
  /** 产物配置（持久化默认值） */
  artifacts: null as ArtifactConfig | null,
  busy: false,
  logEntries: [] as LogEntry[],
  recentDirectories: [] as RecentDirectoryEntry[],
  currentDirectoryPath: '',
  currentDirectoryLabel: '',
  searchDropdownOpen: false,
  exportDropdownOpen: false,
  activePlatformTab: 'auto' as PlatformKey | 'auto',
  /**
   * 更新范围已保存的选择（平台 → 产物 id → 是否启用）。
   * 落盘在 `chrome.storage.local`，重开弹窗按它还原勾选；「恢复为设置页配置」清除。
   */
  scopeOverrides: null as ArtifactScopeOverrides | null,
};

// ── DOM Refs ──────────────────────────────────────────

function $(sel: string): HTMLElement | null { return document.querySelector(sel); }
function $$<T extends HTMLElement = HTMLElement>(sel: string): NodeListOf<T> { return document.querySelectorAll(sel); }

const dom = {
  get pageOriginEl() { return $('#page-origin') as HTMLElement; },
  get currentPathTag() { return $('#current-path-tag') as HTMLElement; },
  get refreshHandleBtn() { return $('#refresh-handle-btn') as HTMLElement; },
  get copyPathBtn() { return $('#copy-path-btn') as HTMLElement; },
  get searchInput() { return $('#search-path-input') as HTMLInputElement; },
  get searchDropdown() { return $('.search-dropdown') as HTMLElement; },
  get searchDropdownList() { return $('.search-dropdown .search-dropdown-list') as HTMLElement; },
  get platformTabs() { return Array.from($$('[data-platform-tab]')) as HTMLElement[]; },
  get platformPanels() { return Array.from($$('[data-platform-panel]')) as HTMLElement[]; },
  // Cloudpivot buttons
  get captureBtn() { return $('#frontend-capture-write-btn') as HTMLElement; },
  get writebackBtn() { return $('#frontend-writeback-btn') as HTMLElement; },
  get bizRuleCaptureBtn() { return $('#bizrule-capture-write-btn') as HTMLElement; },
  get bizRuleWritebackBtn() { return $('#bizrule-writeback-btn') as HTMLElement; },
  get cloudpivotScopeBtn() { return $('#cloudpivot-scope-btn') as HTMLElement; },
  get cloudpivotScopeMenu() { return $('#cloudpivot-scope-menu') as HTMLElement; },
  // H3Yun buttons
  get h3yunCaptureAllBtn() { return $('#h3yun-capture-all-btn') as HTMLElement; },
  get h3yunScopeBtn() { return $('#h3yun-scope-btn') as HTMLElement; },
  get h3yunScopeMenu() { return $('#h3yun-scope-menu') as HTMLElement; },
  get h3yunOneClickWritebackBtn() { return $('#h3yun-oneclick-writeback-btn') as HTMLElement; },
  get h3yunWritebackFrontendBtn() { return $('#h3yun-frontend-writeback-btn') as HTMLElement; },
  get h3yunWritebackBackendBtn() { return $('#h3yun-backend-writeback-btn') as HTMLElement; },
  // Status
  get statusOutput() { return $('.status-output') as HTMLElement; },
  // Overlays
  // Status action buttons (corrected IDs matching popup.html)
  get exportDropdownMenu() { return $('#export-dropdown-menu') as HTMLElement; },
  get exportDropdownBtn() { return $('#export-dropdown-btn') as HTMLElement; },
  get exportLogBtn() { return $('#export-log-btn') as HTMLElement; },
  get exportDiagBtn() { return $('#export-diagnostic-btn') as HTMLElement; },
  get copyLogBtn() { return $('#copy-log-btn') as HTMLElement; },
  get openOptionsBtn() { return $('#open-options-btn') as HTMLElement; },
};

// ── Status Logging ────────────────────────────────────

function addLog(message: string, level: LogEntry['level'] = 'info', suggestion?: string): void {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  state.logEntries.push({ time, message, level, suggestion });
  if (state.logEntries.length > 500) state.logEntries.splice(0, 100);
  renderStatus();
}

function addSuccessLog(message: string, suggestion?: string): void { addLog(message, 'success', suggestion); }
function addErrorLog(message: string, suggestion?: string): void { addLog(message, 'error', suggestion); }
function addWarningLog(message: string, suggestion?: string): void { addLog(message, 'warning', suggestion); }

/** 日志级别前缀图标（颜色由 CSS 按级别着色：错误红字、成功绿字） */
const LOG_LEVEL_PREFIX: Record<LogEntry['level'], string> = {
  info: 'ℹ',
  success: '✅',
  error: '❌',
  warning: '⚠️',
};

/**
 * 渲染状态区。
 *
 * 用 HTML 而非纯文本：错误与成功必须一眼可辨（红字 / 绿字），
 * 建议文案紧随同级日志（缩进一行），保证结论与处置动作同时可见。
 */
function renderStatus(): void {
  const el = dom.statusOutput;
  if (!el) return;
  el.innerHTML = state.logEntries.map((entry) => {
    const prefix = LOG_LEVEL_PREFIX[entry.level] || LOG_LEVEL_PREFIX.info;
    const suggestion = entry.suggestion ? `\n   ↳ ${escapeHtml(entry.suggestion)}` : '';
    return `<span class="log-line log-${entry.level}">[${escapeHtml(entry.time)}] ${prefix} ${escapeHtml(entry.message)}${suggestion}</span>`;
  }).join('\n');
  el.scrollTop = el.scrollHeight;
}

function clearStatus(): void {
  state.logEntries = [];
  renderStatus();
}

function isNotAllowedError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}

function formatExecutionError(error: unknown): string {
  if (isNotAllowedError(error)) {
    return '目标目录存在性探测失败：当前浏览器或平台不允许在当前上下文访问该目录（NotAllowedError）';
  }
  if (error instanceof DirectoryError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function reportExecutionError(operation: string, error: unknown): void {
  const message = formatExecutionError(error);
  const suggestion = isNotAllowedError(error)
    ? '请在扩展弹窗中点击「更新当前路径」重新选择目录后重试'
    : '请检查当前页面和目标目录后重试';
  addErrorLog(`${operation}：${message}`, suggestion);
}

// ── Busy State ────────────────────────────────────────

function setBusy(busy: boolean): void {
  state.busy = busy;
  const buttons = document.querySelectorAll('.actions button') as NodeListOf<HTMLButtonElement>;
  buttons.forEach((btn) => { btn.disabled = busy; });
}

async function runWithButtonBusy(button: HTMLElement | null, task: () => Promise<void>): Promise<void> {
  if (button) button.classList.add('btn-busy');
  setBusy(true);
  try {
    await task();
  } catch (error: unknown) {
    // 所有按钮操作统一在此记录一次，底层服务只负责继续抛出异常。
    reportExecutionError('操作失败', error);
  } finally {
    setBusy(false);
    if (button) button.classList.remove('btn-busy');
  }
}

// ── 安全注入工具 ──────────────────────────────────────

/**
 * 封装 chrome.scripting.executeScript，捕获注入异常（页面未就绪、API 未加载等）。
 * 返回 null 表示注入失败（自动打印错误日志）。
 */
/**
 * 安全注入脚本到目标页面，捕获页面未就绪或 API 未加载等运行时异常。
 * func 经过 `as any` 桥接 chrome.scripting.executeScript 的泛型约束。
 * 返回 null 表示注入失败（已自动记录错误日志）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeExecuteScript(
  tabId: number,
  func: (...args: any[]) => any,
  args: unknown[] = [],
  errorHint = '',
): Promise<unknown> {
  try {
    const injectionResult = await (chrome.scripting.executeScript as any)({
      target: { tabId },
      world: 'MAIN',
      func,
      args,
    });
    const item = (injectionResult as any[])?.[0] as { result?: unknown } | undefined;
    if (!item || item.result === undefined) {
      addErrorLog(`注入失败: 未返回有效结果${errorHint ? `（${errorHint}）` : ''}`);
      return null;
    }
    return item.result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('executeScript') || msg.includes('inject')) {
      addErrorLog(`脚本注入失败: ${msg}${errorHint ? `（${errorHint}）` : ''}`, '请确认页面已完全加载，且当前为支持的云枢/氚云设计页面');
    } else {
      addLog(`页面 API 未就绪: ${msg.substring(0, 120)}`, 'warning', '请等待页面完全加载后重试');
    }
    return null;
  }
}

// ── Directory Display ──────────────────────────────────

/**
 * 当前页面生效的 pageType（展示、选择器、预检、读写共用同一来源）。
 *
 * 页面已识别时用页面自身的 pageType；未识别时按用户当前打开的平台标签推导。
 * 统一来源可避免「展示按页面推导、选择器按标签推导」时各自回退到不同平台的目录。
 */
function resolveEffectivePageType(): string {
  if (state.pageTypeConfig) return state.pageTypeConfig.pageType;
  return getActivePlatformKey() === 'h3yun' ? 'h3yunDefault' : 'default';
}

async function updateDirectoryDisplay(): Promise<void> {
  // 未绑定页面时 getStoredDirectoryPath 会回退到本平台默认目录，展示与读写同源
  const path = await getStoredDirectoryPath(state.pageContext, resolveEffectivePageType());
  state.currentDirectoryPath = path;
  state.currentDirectoryLabel = extractLastFolderName(path);

  if (dom.copyPathBtn) {
    dom.copyPathBtn.style.display = path ? '' : 'none';
  }
  if (dom.currentPathTag) {
    dom.currentPathTag.textContent = path ? state.currentDirectoryLabel || path : '未选择目录';
    dom.currentPathTag.title = path
      ? path
      : '请点击「更新当前路径」选择本地目录，或从历史目录中搜索恢复';
  }
}

// ── Directory Selection ────────────────────────────────

// ── fromcode 目录归属校验 ──────────────────────────────

/** mismatched 时弹确认框：目录属于其他表单，是否仍强制关联到当前页面 */
function promptForcodeConfirm(label: string, storedCode: string): boolean {
  return window.confirm(
    `目标目录「${label}」已关联其他表单（fromcode: ${storedCode}）。\n\n` +
    '是否仍要关联到当前页面？\n' +
    '确认后将把该目录关联到当前页面的表单编码。',
  );
}

/** 用户确认强制关联：绑定目录并在扩展本地记录 forced 关联。 */
async function forceForcodeAssociate(
  handle: FileSystemDirectoryHandle,
  label: string,
  storedCode: string,
  pageType: string,
): Promise<boolean> {
  const forced = await confirmForcodeOverride(handle, state.pageContext, pageType);
  if (!forced) {
    addErrorLog('强制关联失败，请重试');
    return false;
  }
  addWarningLog(
    `目录「${label}」已强制关联（原 fromcode: ${storedCode}）`,
    '已记录目录与当前页面的强制关联',
  );
  return true;
}

/** 绑定成功后按校验结论输出日志反馈（matched / missing） */
function reportForcodeStatus(fromcode: string | undefined, label: string): void {
  if (fromcode === 'matched') {
    addSuccessLog('目录表单编码校验通过，目录与当前页面匹配');
  } else if (fromcode === 'missing') {
    addWarningLog(
      `目录「${label}」尚无表单归属关联（可能是新建或未初始化目录）`,
      '确认后首次写入会在扩展本地记录目录归属，不会在目录中新增标记文件',
    );
  }
}

/**
 * 统一处理 saveHandleSelection 的 fromcode 校验结果：
 * mismatched 时弹确认由用户决定（拒绝则不绑定，返回 false）；其余结论出日志并放行。
 */
async function applyHandleSelectionFromcode(
  selection: HandleSelectionResult,
  handle: FileSystemDirectoryHandle,
  pageType: string,
): Promise<boolean> {
  if (selection.handleModeSelected) {
    reportForcodeStatus(selection.fromcode, selection.label);
    return true;
  }
  const storedCode = selection.fromcodeValue || '未知编码';
  if (!promptForcodeConfirm(selection.label, storedCode)) {
    addWarningLog(
      `目录「${selection.label}」属于其他表单（fromcode: ${storedCode}），未关联`,
      '请选择其他目录；或重新选择该目录并在提示中确认强制关联',
    );
    return false;
  }
  return forceForcodeAssociate(handle, selection.label, storedCode, pageType);
}

/**
 * 恢复历史目录：通过历史记录中的 scope 精确定位 IndexedDB 中的页面级句柄，
 * 直接在该句柄上检查/请求权限（而非通过 resolveTargetDirectoryHandle 的 scope 解析，
 * 后者可能命中当前页面已绑定的其他句柄），然后通过 saveHandleSelection 绑定到当前页面。
 *
 * 这保证了：显示路径 = scope 句柄 = 实际写入句柄，三者完全一致。
 */
async function handleSelectHistoryPath(path: string): Promise<void> {
  if (!path || state.busy) return;
  closeSearchDropdown();

  // 精确定位历史路径对应的句柄：仅用历史条目自身记录的 scope 从 IndexedDB
  // 获取页面级句柄。目录归属不再依赖句柄名对比（旧验证已退役），
  // 由后续 saveHandleSelection 的 fromcode 校验统一判定。
  const activePlatform = getActivePlatformKey();
  const entry = state.recentDirectories.find(
    (r) => r.path === path && resolveRecentEntryPlatform(r, state.config) === activePlatform,
  );
  let handle: FileSystemDirectoryHandle | undefined;
  if (entry?.scope) {
    handle = await getTargetDirectoryHandleForScope(entry.scope);
  }
  if (!handle) {
    // 目录选择器只由用户显式点击「更新当前路径」触发，这里只提示、不代用户弹窗
    addWarningLog(
      `历史目录「${extractLastFolderName(path)}」的句柄已失效`,
      '请点击「更新当前路径」重新选择目标目录',
    );
    return;
  }

  // 直接在该句柄上检查权限（不经过 scope 解析，避免命中当前页面已绑定的其他句柄）
  const permission = await queryHandlePermissionState(handle);
  if (permission === 'granted') {
    const currentPageType = state.pageTypeConfig?.pageType || 'default';
    const selection = await saveHandleSelection(handle, state.pageContext, currentPageType);
    if (!(await applyHandleSelectionFromcode(selection, handle, currentPageType))) return;
    state.currentDirectoryPath = handle.name;
    state.currentDirectoryLabel = handle.name;
    await updateDirectoryDisplay();
    await loadRecentDirectories();
    addSuccessLog(`已恢复历史目录: ${state.currentDirectoryLabel || path}`);
    return;
  }

  // 权限失效，尝试重新授权（浏览器授权弹窗，已授权过则直接 granted 不弹窗）
  addLog(`历史目录「${extractLastFolderName(path)}」需要重新授权，正在请求授权...`, 'warning');
  const granted = await requestHandlePermissionState(handle);
  if (granted === 'granted') {
    const currentPageType = state.pageTypeConfig?.pageType || 'default';
    const selection = await saveHandleSelection(handle, state.pageContext, currentPageType);
    if (!(await applyHandleSelectionFromcode(selection, handle, currentPageType))) return;
    state.currentDirectoryPath = handle.name;
    state.currentDirectoryLabel = handle.name;
    await updateDirectoryDisplay();
    await loadRecentDirectories();
    addSuccessLog(`目录已重新授权并恢复: ${state.currentDirectoryLabel || path}`);
    return;
  }

  // 无句柄或用户拒绝授权：同样只提示，不代用户弹窗（选择器仅由显式点击触发）
  addWarningLog(
    `历史目录「${extractLastFolderName(path)}」无法恢复`,
    '请点击「更新当前路径」重新选择目标目录',
  );
}

async function handleRemoveHistoryPath(path: string): Promise<void> {
  // 给被删除项播放删除动画
  const items = document.querySelectorAll<HTMLElement>('.search-item');
  for (const el of items) {
    if (el.dataset.path === path) { el.classList.add('is-deleting'); break; }
  }
  // 直接从内存数组 + storage 同步删除（不经过模块封装，确保必定生效）
  state.recentDirectories = state.recentDirectories.filter((r) => r.path !== path);
  await chrome.storage.local.set({ targetDirectoryRecent: state.recentDirectories });
  // 动画播完后移除 DOM 项并重渲下拉（恢复空态/计数）
  setTimeout(() => {
    const stale = document.querySelector<HTMLElement>(`.search-item[data-path="${path.replace(/\\/g, '\\\\')}"]`);
    if (stale) { stale.remove(); }
    renderSearchDropdown('');
  }, 260);
}

async function handleClearHistory(): Promise<void> {
  const platformKey = getActivePlatformKey();
  state.recentDirectories = await clearRecentTargetDirectoriesByPlatform(platformKey, state.config);
  renderSearchDropdown('');
}

async function handleCopyPath(): Promise<void> {
  await updateDirectoryDisplay();
  const path = state.currentDirectoryPath;
  if (path) {
    await navigator.clipboard.writeText(path);
    addSuccessLog('路径已复制到剪贴板');
  } else {
    addWarningLog('当前未选择目录', '请先点击「选择目录」或从历史目录中选择');
  }
}

function reportDirectoryCheckSuccess(check: TargetDirectoryCheckResult, suggestion?: string): void {
  const label = check.label || '未命名目录';
  addSuccessLog(`目录校验通过：目录「${label}」的表单编码与当前页面匹配`, suggestion);
}

function reportDirectoryCheckResult(check: TargetDirectoryCheckResult): void {
  if (check.health === 'ok') {
    reportDirectoryCheckSuccess(check);
  } else if (check.health === 'unbound') {
    reportUnboundDefaultDirectory(check.platformKey);
  } else {
    reportDirectoryCheckIssue(check);
  }
}

/**
 * 输出自检未通过的原因（红字 / 黄字）与处置建议。
 *
 * 只处理「需要用户判断」的结论：尚无表单归属关联（黄，新建目录请用户确认）、
 * fromcode 属于其他表单（红，请用户确认归属）、权限被拒（黄/普通日志）。
 * 自检通过与未绑定不在此输出，由调用方决定是否需要提示。
 * 不做任何二次校验或临时文件测试。
 */
function reportDirectoryCheckIssue(check: TargetDirectoryCheckResult): void {
  const label = check.label || '未命名目录';

  switch (check.health) {
    case 'fromcode-missing':
      addWarningLog(
        `目录「${label}」尚无表单归属关联（可能是新建或未初始化目录）`,
        '请确认该目录是否用于当前页面；确认后归属只保存在扩展本地，不会新增标记文件',
      );
      return;
    case 'fromcode-mismatched':
      addErrorLog(
        `目录「${label}」的表单编码（fromcode: ${check.fromcodeValue || '未知'}）与当前页面不匹配，可能属于其他表单`,
        '请确认目录归属；如需关联当前页面，请点击「更新当前路径」重新选择该目录并确认强制关联',
      );
      return;
    case 'permission-prompt':
      // 浏览器重启后句柄权限退化为 prompt 是正常待授权状态，实际授权在用户手势内完成
      addLog(`目录「${label}」权限待确认，首次操作时浏览器会请求授权`);
      return;
    case 'permission-denied':
      addWarningLog(
        `目录校验未通过：目录「${label}」没有读取权限`,
        '请点击「更新当前路径」重新授权或重新选择目标目录',
      );
      return;
    default:
      return;
  }
}

/**
 * 平台默认目录「配了路径但没绑句柄」时给出可操作提示。
 *
 * File System Access 只能通过句柄访问目录：设置页里仅填写路径文本不会被浏览器授权，
 * 表现为「设置页看着配了默认目录，弹窗却定位不到、选择器只能打开系统默认位置」。
 *
 * @returns 是否输出了提示（false 表示该平台没有配置默认目录）
 */
function reportUnboundDefaultDirectory(platformKey: PlatformKey): boolean {
  const defaultPath = state.config ? getFallbackDirectoryPathByPlatform(state.config, platformKey) : '';
  if (!defaultPath) return false;

  addWarningLog(
    `${PLATFORM_LABELS[platformKey]}默认目录「${defaultPath}」未绑定访问句柄，无法定位该目录`,
    '请在设置页「默认目录」点「浏览」重新绑定该目录',
  );
  return true;
}

/**
 * 「更新当前路径」：用户主动点击即弹出目录选择器（云枢 / 氚云行为一致）。
 *
 * 自检只作为**信息反馈**（红字 / 绿字说明当前目录状态），不再阻断选择器：
 * - 目录正常 → 绿字说明当前目录可用，仍可换成其它目录；
 * - 目录已被移动 / 删除 → 红字提示并清理失效绑定；
 * - 无读写授权 → 先在手势内补一次授权（保证重新授权流程能完成、选择器能定位到当前目录），
 *   再进入选择器；
 * - 未绑定 / 平台默认目录没绑句柄 → 相应提示。
 */
async function handleRefreshDirectory(): Promise<void> {
  if (state.busy) return;
  await runWithButtonBusy(dom.refreshHandleBtn, async () => {
    const pageType = resolveEffectivePageType();

    // 1) 自检（fromcode 唯一校验方式）：只输出结论，不决定是否弹窗
    const check = await checkTargetDirectoryHealth(state.pageContext, pageType);
    const label = check.label || '未命名目录';

    if (check.health === 'ok') {
      reportDirectoryCheckSuccess(check, '可在弹出的对话框中选择其它目录');
    } else if (check.health === 'permission-denied' || check.health === 'permission-prompt') {
      // 浏览器重启后句柄权限常退化为 prompt：在用户手势内补授权，成功即恢复当前目录的读写
      const permission = await requestTargetDirectoryPermission(state.pageContext, pageType);
      if (permission === 'granted') {
        await updateDirectoryDisplay();
        addSuccessLog(`目录「${label}」已重新授权`, '可在弹出的对话框中选择其它目录');
      } else {
        addWarningLog(`目录「${label}」没有读写授权`, '可在弹出的对话框中选择目标目录');
      }
    } else if (check.health === 'unbound') {
      // 已配置默认目录却没有句柄时，提示去设置页重新绑定（路径文本无法定位目录）
      if (!reportUnboundDefaultDirectory(check.platformKey)) {
        addLog('当前页面尚未绑定目录，请选择目标目录');
      }
    } else {
      reportDirectoryCheckIssue(check);
    }

    // 2) 无论自检结论如何，用户点击即弹出目录选择器（初始位置由 access 层按本平台解析）
    const result = await selectAndBindDirectory(state.pageContext, { pageType, isPageSnapshot: false });
    if (!result) {
      addWarningLog('目录选择已取消');
      return;
    }
    // fromcode 校验：mismatched（目录属于其他表单）时弹确认由用户决定是否强制关联
    if (result.fromcodeConfirm) {
      const { handle, fromcodeValue } = result.fromcodeConfirm;
      const storedCode = fromcodeValue || '未知编码';
      if (!promptForcodeConfirm(result.label, storedCode)) {
        addWarningLog(
          `目录「${result.label}」属于其他表单（fromcode: ${storedCode}），未关联`,
          '请选择其他目录；或重新选择该目录并在提示中确认强制关联',
        );
        return;
      }
      if (!(await forceForcodeAssociate(handle, result.label, storedCode, pageType))) return;
    } else {
      reportForcodeStatus(result.fromcode, result.label);
    }
    await updateDirectoryDisplay();
    await loadRecentDirectories();
    addSuccessLog(`路径已更新：${result.label}`);

    // 新路径绑定后必须立即重新验证，确保句柄和实际读写能力一致。
    const reboundCheck = await checkTargetDirectoryHealth(state.pageContext, pageType);
    reportDirectoryCheckResult(reboundCheck);
  });
}

/** 「设置」按钮：打开选项页 */
async function handleOpenOptions(): Promise<void> {
  try {
    await chrome.runtime.openOptionsPage();
  } catch (error: unknown) {
    // 兜底：直接在 tab 中打开 options.html
    const url = chrome.runtime.getURL('options.html');
    await chrome.tabs.create({ url });
  }
}

/** 「导出」下拉切换 */
function handleExportDropdownToggle(): void {
  state.exportDropdownOpen = !state.exportDropdownOpen;
  const el = dom.exportDropdownMenu;
  if (el) el.hidden = !state.exportDropdownOpen;
}

/** 拷贝当前实际链接（即 popup 打开的 tab URL）到剪贴板 */
async function handleCopyCurrentLink(): Promise<void> {
  const url = state.pageContext?.url || (await getActiveTab()).url;
  if (url) {
    await navigator.clipboard.writeText(url);
    addSuccessLog('链接已复制');
  } else {
    addWarningLog('无法获取当前页链接');
  }
}

// ── Search Dropdown ────────────────────────────────────

/** 当前生效的平台标识（优先用户手动切换的标签，'auto' 时回退到页面识别平台） */
function getActivePlatformKey(): PlatformKey {
  if (state.activePlatformTab !== 'auto') return state.activePlatformTab;
  return state.pageTypeConfig?.platformKey ?? 'cloudpivot';
}

function renderSearchDropdown(query = ''): void {
  const list = dom.searchDropdownList;
  if (!list) return;
  // 历史记录按当前生效平台过滤：氚云/云枢区分展示（结合 pageType + 默认路径对比推断）
  const activePlatform = getActivePlatformKey();
  const platformRecords = state.recentDirectories.filter(
    (r) => resolveRecentEntryPlatform(r, state.config) === activePlatform,
  );
  const filtered = filterHistoryRecords(query, platformRecords);

  if (filtered.length === 0) {
    list.innerHTML = query
      ? '<div class="search-empty">暂无匹配目录</div>'
      : '<div class="search-empty">暂无历史目录</div>';
  } else {
    list.innerHTML = filtered.map((d, i) => {
      const platform = resolveRecentEntryPlatform(d, state.config);
      const badgeClass = platform === 'h3yun' ? 'badge-h3yun' : 'badge-cloudpivot';
      const badgeLabel = platform === 'h3yun' ? '氚云' : '云枢';
      return `
        <div class="search-item" data-index="${i}" data-path="${escapeHtml(d.path)}">
          <span class="search-item-platform ${badgeClass}">${badgeLabel}</span>
          <span class="search-item-path">${escapeHtml(extractLastFolderName(d.path))}</span>
          <button class="btn-danger is-quiet search-item-remove" data-remove="${escapeHtml(d.path)}" title="删除">×</button>
        </div>
      `;
    }).join('');
  }

  // 控制 HTML 中已有的"清空历史记录"区域（#search-dropdown-clear）
  const clearArea = $('#search-dropdown-clear') as HTMLElement | null;
  if (clearArea) clearArea.hidden = platformRecords.length === 0;
}

function openSearchDropdown(): void {
  state.searchDropdownOpen = true;
  const el = dom.searchDropdown;
  if (el) {
    // 必须同时移除 hidden attribute，否则 HTML hidden 属性优先级高于 style.display
    el.hidden = false;
  }
}
function closeSearchDropdown(): void {
  state.searchDropdownOpen = false;
  const el = dom.searchDropdown;
  if (el) el.hidden = true;
}

// ── Platform Detection ─────────────────────────────────

async function getActiveTab(): Promise<{ id?: number; url: string; title: string; pendingUrl: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return {
    id: tab?.id,
    url: tab?.url || tab?.pendingUrl || '',
    pendingUrl: tab?.pendingUrl || '',
    title: tab?.title || '',
  };
}

async function updatePageInfo(): Promise<void> {
  const tab = await getActiveTab();
  state.pageContext = { tabId: tab.id, url: tab.url, title: tab.title };
  state.pageTypeConfig = resolvePageTypeConfig(tab.url);

  // 页面链接区：显示"复制链接"按钮（不展示完整 URL）
  renderPageOriginAsCopyButton(tab);

  // 根据 URL 自动激活对应平台标签（同时隐藏未激活的 panel 和按钮）
  syncActivePlatformFromPage();
  renderPlatformButtons();
}

/**
 * 将 #page-origin 渲染为"复制链接"按钮。
 * 完全照搬原版 setCopyableValue 逻辑：displayLabel='复制链接', fullValue=tab.url。
 */
function renderPageOriginAsCopyButton(tab: { url: string }): void {
  const el = dom.pageOriginEl as HTMLButtonElement;
  if (!el) return;

  const normalizedValue = String(tab?.url || '').trim();
  if (!normalizedValue) {
    el.textContent = '无法获取';
    el.dataset.copyValue = '';
    el.dataset.copyLabel = '页面链接';
    el.disabled = true;
    return;
  }

  el.dataset.copyValue = normalizedValue;
  el.dataset.copyLabel = '页面链接';
  el.textContent = '复制链接';
  el.title = normalizedValue;
  el.disabled = false;
  // 确保 HTML 预设的 copy-chip 样式生效（原始 HTML 已有 copy-chip copy-chip-prominent）
  el.classList.add('copy-chip');
}

/** 点击 #page-origin 复制链接到剪贴板 */
async function handleCopyPageOrigin(): Promise<void> {
  const el = dom.pageOriginEl as HTMLButtonElement;
  if (el?.disabled) return;
  const copyValue = String(el?.dataset?.copyValue || '').trim();
  if (!copyValue) return;
  try {
    await navigator.clipboard.writeText(copyValue);
    addSuccessLog('页面链接已复制');
  } catch {
    addErrorLog('复制失败');
  }
}

// ── 氚云一键回写 ──────────────────────────────────────

/**
 * 氚云一键回写：顺序执行前端 + 后端回写，互不阻断。
 * 照搬原版 handleH3yunOneClickWriteback。
 */
async function handleH3yunOneClickWriteback(): Promise<void> {
  if (state.busy || !state.pageContext.tabId) return;
  const kinds: Array<'frontend' | 'backend'> = ['frontend', 'backend'];
  let okCount = 0;
  let failCount = 0;
  for (const codeKind of kinds) {
    try {
      await handleH3yunCodeWriteback(codeKind);
      okCount++;
    } catch {
      failCount++;
    }
  }
  if (failCount) {
    addErrorLog(`氚云一键回写部分失败（${okCount}/${kinds.length}），请尝试分别回写`);
  } else {
    addSuccessLog('氚云一键回写完成');
  }
}

// ── 更新范围（主按钮 + 下拉多选） ─────────────────────

/** 取指定平台的产物清单 */
function getArtifactsFor(platformKey: PlatformKey): ArtifactDefinition[] {
  const config = state.artifacts ?? buildDefaultArtifactConfig();
  return getPlatformArtifacts(config, platformKey);
}

/** 当前生效平台的产物清单 */
function getActiveArtifacts(): ArtifactDefinition[] {
  return getArtifactsFor(getActivePlatformKey());
}

/**
 * 解析某条产物是否启用。
 * 生效范围 = 设置页产物配置 ⊕ 该平台已保存的范围选择（见 `platformOverrides`）。
 */
function isArtifactOn(
  artifactId: string,
  overrides: Record<string, boolean> = {},
  platformKey: PlatformKey = getActivePlatformKey(),
): boolean {
  const artifact = getArtifactsFor(platformKey).find((item) => item.id === artifactId);
  // 配置中不存在该产物时视为启用，避免升级过程中静默丢功能
  if (!artifact) return true;
  return resolveArtifactEnabled(artifact, overrides);
}

/** 取某平台已保存的范围选择（无记录返回空表 = 完全按设置页配置） */
function platformOverrides(platformKey: PlatformKey): Record<string, boolean> {
  return platformScopeOverrides(state.scopeOverrides, platformKey);
}

/** 该平台是否存在已保存的范围选择（决定是否显示「恢复为设置页配置」） */
function hasScopeOverride(platformKey: PlatformKey): boolean {
  return hasPlatformScopeOverrides(state.scopeOverrides, platformKey);
}

/**
 * 读取已保存的范围选择（弹窗打开时调用，保证与上次选择一致）。
 * 读取失败按「无选择」处理：界面回退到设置页配置，不影响其它功能。
 */
async function restoreScopeOverrides(): Promise<void> {
  try {
    state.scopeOverrides = await loadScopeOverrides();
  } catch (error: unknown) {
    state.scopeOverrides = null;
    logger.warn('更新范围读取失败，按设置页配置显示', { error: String(error) });
  }
}

/**
 * 落盘当前范围选择。
 *
 * 失败只记录日志（内存与界面已生效），不阻断交互：范围保存只承担「记住上次选择」，
 * 不参与抓取本身的正确性。
 */
async function persistScopeOverrides(): Promise<void> {
  try {
    if (state.scopeOverrides) await saveScopeOverrides(state.scopeOverrides);
    else await clearScopeOverrides();
  } catch (error: unknown) {
    logger.error('更新范围保存失败', { error: String(error) });
    addErrorLog('更新范围保存失败，本次选择仅当前弹窗有效', '可在设置页「文件助手」直接调整产物开关');
  }
}

/**
 * 抓取入口涉及的产物 id。
 *
 * 云枢「前端抓取」不含业务规则 Java（由「业务规则抓取」独立入口负责），
 * 所以范围下拉里不会出现「业务规则 Java」；氚云「一键抓取写入」三类都覆盖。
 */
function resolveCaptureEntryArtifactIds(platformKey: PlatformKey): string[] {
  return getArtifactsFor(platformKey)
    .filter((artifact) => platformKey !== 'cloudpivot' || artifact.id !== ARTIFACT_IDS.java)
    .map((artifact) => artifact.id);
}

/**
 * 构造范围输入。
 *
 * 选项由设置页产物配置**动态读取**（`buildScopeOptions`）：设置页新增 / 改名 / 删除的文件
 * 会自动同步到下拉，无需改动范围逻辑；enabledIds = 生效范围（设置页开关 ⊕ 已保存的选择）。
 */
function buildScopeInput(platformKey: PlatformKey): ArtifactScopeInput {
  const artifacts = getArtifactsFor(platformKey);
  const entryArtifactIds = resolveCaptureEntryArtifactIds(platformKey);
  const owned = new Set(entryArtifactIds);
  const overrides = platformOverrides(platformKey);
  return {
    options: buildScopeOptions(artifacts, entryArtifactIds),
    enabledIds: artifacts
      .filter((artifact) => owned.has(artifact.id) && isArtifactOn(artifact.id, overrides, platformKey))
      .map((artifact) => artifact.id),
  };
}

/**
 * 应用范围选择：写入内存并**落盘**，重开弹窗后仍按本次选择还原。
 * 设置页产物配置不受影响，「恢复为设置页配置」可清除这里保存的选择。
 */
async function applyScopeEnabledIds(platformKey: PlatformKey, enabledIds: readonly string[]): Promise<void> {
  state.scopeOverrides = withPlatformScopeOverrides(
    state.scopeOverrides,
    platformKey,
    enabledIds,
    resolveCaptureEntryArtifactIds(platformKey),
  );

  renderScopeBadge(platformKey);
  renderScopeDropdown(platformKey);
  await persistScopeOverrides();
}

/** 恢复为设置页配置（清除该平台已保存的选择并落盘） */
async function resetScopeToConfig(platformKey: PlatformKey): Promise<void> {
  state.scopeOverrides = withoutPlatformScopeOverrides(state.scopeOverrides, platformKey);

  renderScopeBadge(platformKey);
  renderScopeDropdown(platformKey);
  await persistScopeOverrides();
}

/** 刷新范围徽标与主按钮可用性（已选状态的常驻展示） */
function renderScopeBadge(platformKey: PlatformKey): void {
  const isH3yun = platformKey === 'h3yun';
  const scopeState = resolveArtifactScopeState(buildScopeInput(platformKey));
  const summary = formatArtifactScopeSummary(scopeState);

  const badge = $(isH3yun ? '#h3yun-scope-badge' : '#cloudpivot-scope-badge');
  if (badge) badge.textContent = formatArtifactScopeBadge(scopeState);

  const source = hasScopeOverride(platformKey) ? '已保存的范围' : '设置页配置';
  const scopeBtn = isH3yun ? dom.h3yunScopeBtn : dom.cloudpivotScopeBtn;
  if (scopeBtn) scopeBtn.title = `更新范围（${source}）：${summary}`;

  // 空范围无法执行：禁用主按钮并说明原因，避免静默空跑
  const mainBtn = (isH3yun ? dom.h3yunCaptureAllBtn : dom.captureBtn) as HTMLButtonElement | null;
  if (mainBtn) {
    mainBtn.disabled = scopeState.isEmpty;
    mainBtn.title = scopeState.isEmpty
      ? '请先选择更新范围（至少一项）'
      : `本次范围（${source}）：${summary}`;
  }
}

/**
 * 渲染范围下拉：该入口的每个文件独立一行（勾选 = 本次抓取并写入，取消 = 本次跳过）。
 *
 * 选项由设置页产物配置动态读取（`buildScopeOptions`），设置页新增 / 改名 / 删除的文件会自动
 * 同步到这里，因此本函数不维护任何文件清单；`is-on` 供样式层叠加选中态（主色左条 / 行底 /
 * 文字色），勾选框本身由 CSS 样式化的原生 checkbox 呈现（`input:checked` 即真实状态）。
 * 列表只显示主体名称（`displayLabel`，去掉末尾括号说明），完整名称放在 `title` 悬浮提示里。
 */
function renderScopeDropdown(platformKey: PlatformKey): void {
  const menu = platformKey === 'h3yun' ? dom.h3yunScopeMenu : dom.cloudpivotScopeMenu;
  if (!menu) return;

  const input = buildScopeInput(platformKey);
  const overrides = platformOverrides(platformKey);
  const optionRows = input.options
    .map((option) => {
      const checked = isArtifactOn(option.id, overrides, platformKey);
      return `
      <label class="scope-artifact${checked ? ' is-on' : ''}" title="${escapeHtml(option.label)}">
        <input type="checkbox" data-scope-artifact="${escapeHtml(option.id)}" ${checked ? 'checked' : ''}>
        <span class="scope-artifact-name">${escapeHtml(option.displayLabel)}</span>
      </label>`;
    })
    .join('');

  // 「恢复为设置页配置」只在有已保存的范围时出现，作为撤销入口（属于操作而非说明文字）
  const resetRow = hasScopeOverride(platformKey)
    ? '<button class="scope-reset" type="button" data-scope-reset>↺ 恢复为设置页配置</button>'
    : '';

  menu.innerHTML = `${optionRows}${resetRow}`;
}

/** 关闭范围下拉（两个平台共用） */
function closeScopeDropdown(): void {
  for (const [btn, menu] of [[dom.cloudpivotScopeBtn, dom.cloudpivotScopeMenu], [dom.h3yunScopeBtn, dom.h3yunScopeMenu]] as const) {
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
}

/** 范围下拉开合（按钮点击切换；点击外部 / Esc 关闭） */
function handleScopeToggle(platformKey: PlatformKey): void {
  if (state.busy) return;
  const menu = platformKey === 'h3yun' ? dom.h3yunScopeMenu : dom.cloudpivotScopeMenu;
  const btn = platformKey === 'h3yun' ? dom.h3yunScopeBtn : dom.cloudpivotScopeBtn;
  if (!menu || !btn) return;

  const willOpen = menu.hidden;
  closeScopeDropdown();
  if (!willOpen) return;

  renderScopeDropdown(platformKey);
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
}

/** 范围下拉内的勾选处理：每个文件独立勾选（状态反解规则见 artifact-scope.ts） */
async function handleScopeMenuChange(platformKey: PlatformKey, target: HTMLInputElement): Promise<void> {
  const artifactId = target.dataset.scopeArtifact;
  if (!artifactId) return;
  await applyScopeEnabledIds(platformKey, toggleScopeArtifact(buildScopeInput(platformKey), artifactId, target.checked));
}

/**
 * 汇总写入结果并输出日志。
 * 「只建文件夹」的产物不产出文件，全部命中时 written 为 0 属正常，不算失败。
 * @param skipped 本次未写入的项（已关闭的产物 / 未挂载的编辑器），合并进结果行避免多行冗余
 * @returns 是否视为成功
 */
function reportArtifactWriteResult(
  writeResult: WriteFilesResult,
  fileEntries: readonly { fileName: string; content: string }[],
  label: string,
  skipped: readonly string[] = [],
): boolean {
  const hasFileEntries = fileEntries.some((entry) => !entry.fileName.endsWith(DIRECTORY_PATH_SUFFIX));
  if (writeResult.written === 0 && hasFileEntries) {
    addErrorLog(`${label}写入失败：所有文件均未写入目标目录`, '请确认已选择目标目录且目录可写，或点击「更新当前路径」重新选择');
    return false;
  }
  const dirNote = writeResult.directories > 0 ? `，新建 ${writeResult.directories} 个目录` : '';
  const dirPathNote = writeResult.directoryPath ? ` → ${writeResult.directoryPath}` : '';
  const skippedNote = skipped.length > 0 ? `；跳过：${skipped.join('、')}` : '';
  addSuccessLog(`${label}写入完成：${writeResult.written} 个文件${dirNote}${dirPathNote}${skippedNote}`);
  // 范围选择保持不变（已持久化），仅刷新徽标以反映当前生效值
  renderScopeBadge(getActivePlatformKey());
  return true;
}

/**
 * 判断是否为「目录未选择 / 未授权」这类正常前置状态。
 *
 * 用户还没选目录是操作顺序问题，不是故障；后续真正写入时会给出明确指引，
 * 这里不该按异常记录，否则每次抓取都会刷一条吓人的报错。
 */
function isDirectoryUnavailableError(error: unknown): boolean {
  if (!(error instanceof DirectoryError)) return false;
  return error.code === ERROR_CODE.DIRECTORY_NOT_SELECTED
    || error.code === ERROR_CODE.DIRECTORY_PERMISSION_DENIED;
}

/**
 * 探测模板类产物在目标目录中的存在状态。
 *
 * 未选择目录 / 未授权时只记录一条提示并返回空集合（按「全部待生成」处理），
 * 由后续写入环节统一给出「请先选择目标目录」的指引。
 */
async function probeExistingArtifactPaths(artifacts: readonly ArtifactDefinition[]): Promise<ReadonlySet<string>> {
  const pageType = state.pageTypeConfig?.pageType || 'default';
  const probePaths = artifacts
    .filter((artifact) => artifact.kind === 'template' && String(artifact.fileName ?? '').trim())
    .map((artifact) => normalizeArtifactPath(artifact.dirPath, artifact.fileName))
    .filter(Boolean);
  if (probePaths.length === 0) return new Set<string>();

  try {
    const stat = await fileExistsInSelection(state.pageContext, pageType, probePaths);
    return toExistingPathSet(stat.files.filter((file) => file.exists).map((file) => file.fileName));
  } catch (error: unknown) {
    if (isDirectoryUnavailableError(error)) {
      logger.debug('尚未选择目标目录，本次跳过产物存在性检查');
    } else {
      logger.warn('产物存在性检查失败，按「全部待生成」处理', { error: String(error) });
    }
    return new Set<string>();
  }
}

function renderPlatformButtons(): void {
  // 范围徽标与主按钮可用性依赖产物配置，平台按钮重算时一并刷新
  renderScopeBadge('cloudpivot');
  renderScopeBadge('h3yun');
  const isCP = state.pageTypeConfig?.platformKey === 'cloudpivot';
  const isHY = state.pageTypeConfig?.platformKey === 'h3yun';
  const hasConfig = Boolean(state.pageTypeConfig);

  const hide = (el: HTMLElement | null) => { if (el) el.style.display = 'none'; };
  const show = (el: HTMLElement | null) => { if (el) el.style.display = ''; };

  if (isCP && hasConfig) {
    show(dom.captureBtn); show(dom.writebackBtn); show(dom.bizRuleCaptureBtn);
    show(dom.bizRuleWritebackBtn); show(dom.cloudpivotScopeBtn);
    hide(dom.h3yunCaptureAllBtn); hide(dom.h3yunWritebackFrontendBtn); hide(dom.h3yunWritebackBackendBtn);
  } else if (isHY && hasConfig) {
    hide(dom.captureBtn); hide(dom.writebackBtn); hide(dom.bizRuleCaptureBtn);
    hide(dom.bizRuleWritebackBtn); hide(dom.cloudpivotScopeBtn);
    show(dom.h3yunCaptureAllBtn); show(dom.h3yunScopeBtn);
    // 一键回写 vs 分开回写：根据配置决定显示哪个
    const separateRow = $('#h3yun-separate-writeback-row');
    const captureGroup = $('#h3yun-capture-all-btn')?.parentElement;
    if (state.config?.h3yunOneClickWriteback) {
      show(dom.h3yunOneClickWritebackBtn);
      hide(dom.h3yunWritebackFrontendBtn); hide(dom.h3yunWritebackBackendBtn);
      if (separateRow) separateRow.setAttribute('hidden', '');
      if (captureGroup) captureGroup.style.flex = '';
    } else {
      hide(dom.h3yunOneClickWritebackBtn);
      show(dom.h3yunWritebackFrontendBtn); show(dom.h3yunWritebackBackendBtn);
      if (separateRow) separateRow.removeAttribute('hidden');
      if (captureGroup) captureGroup.style.flex = '1';
    }
  } else {
    hide(dom.captureBtn); hide(dom.writebackBtn); hide(dom.bizRuleCaptureBtn);
    hide(dom.bizRuleWritebackBtn); hide(dom.cloudpivotScopeBtn);
    hide(dom.h3yunCaptureAllBtn); hide(dom.h3yunScopeBtn);
    hide(dom.h3yunOneClickWritebackBtn);
    hide(dom.h3yunWritebackFrontendBtn); hide(dom.h3yunWritebackBackendBtn);
  }
}

/**
 * 切换平台标签的激活态 + 对应 panel 显隐（HTML 使用 BEM `is-active` 类与 `hidden` 属性）。
 * 面板本身即为可见反馈，不再输出「X标签已打开」这类无信息量日志。
 */
function setActivePlatform(platformKey: PlatformKey): void {
  const target = platformKey === 'h3yun' ? 'h3yun' : 'cloudpivot';
  state.activePlatformTab = target;
  closeScopeDropdown();

  for (const btn of dom.platformTabs) {
    const isActive = btn.dataset.platformTab === target;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }

  for (const panel of dom.platformPanels) {
    const isActive = panel.dataset.platformPanel === target;
    panel.classList.toggle('platform-panel-active', isActive);
    panel.hidden = !isActive;
  }
}

/**
 * 弹窗初始化或页面刷新后，按页面 URL 回填默认标签。
 * 平台已识别时隐藏整个标签行释放空间；未识别时显示标签让用户手动选择。
 */
function syncActivePlatformFromPage(): void {
  const platformKey = state.pageTypeConfig?.platformKey;
  const pageType = state.pageTypeConfig?.pageType;
  const pageUrl = state.pageContext.url;

  // 1) 同步标签 / panel 的激活态（一定有值，未识别则强制 cloudpivot）
  setActivePlatform((platformKey ?? 'cloudpivot') as PlatformKey);

  // 2) 当页面是 recognized 平台域名（含 workbench/portal 等）时隐藏 tab row
  const isKnownPlatform = isRecognizedPlatformUrl(pageUrl)
    || (pageType && pageType !== 'default' && pageType !== 'h3yunDefault');
  const tabsContainer = $('#platform-tabs');
  if (tabsContainer) {
    tabsContainer.classList.toggle('is-hidden', Boolean(isKnownPlatform));
  }
}

// ── Cloudpivot Frontend Capture ────────────────────────

async function handleCloudpivotCapture(): Promise<void> {
  if (state.busy || !state.pageContext.tabId) return;
  await runWithButtonBusy(dom.captureBtn, async () => {
    await runOperationWithPreflight(PREFLIGHT_OPERATION_IDS.CAPTURE, async () => {
      const tabId = state.pageContext.tabId!;
      const config = state.pageTypeConfig!;
      // 本次范围：使用该平台已保存的选择（弹窗下拉持久化，重开弹窗保持一致）
      const overrides = platformOverrides(config.platformKey);
      const componentName = resolveCloudpivotComponentName(config.pageType);

      // 注入 Vue 组件树扫描版抓取函数（读取编辑器组件 $data.codes 三键）
      const data = await safeExecuteScript(
        tabId,
        pageCaptureMain,
        [{ candidateComponentNames: [componentName] }],
        '云枢前端抓取',
      ) as PageCaptureResult | null;

      if (!data) return; // safeExecuteScript 已输出注入失败日志

      if (!data.ok) {
        addErrorLog(`前端抓取失败（${data.errorCode}）：${String(data.details || '未获取到代码内容')}`, '请确认页面为云枢在线开发页面，且编辑器已加载');
        return;
      }

      // 按页面类型 fileMappings 将 codes 三键映射为本地固定文件名（受对应抓取产物开关控制）
      const codes = (data.data?.codes ?? {}) as Record<string, unknown>;
      const filesToWrite: { fileName: string; content: string }[] = [];
      // availableCount 统计编辑器里「实际有内容」的代码块数，与产物开关无关，
      // 用于区分「编辑器没内容」与「用户把产物全关了」两种失败。
      let availableCount = 0;
      for (const mapping of config.fileMappings) {
        const content = codes[mapping.key];
        if (typeof content !== 'string' || !content.trim()) continue;
        availableCount++;
        const artifactId = FILE_MAPPING_KEY_TO_ARTIFACT_ID[mapping.key];
        if (artifactId && !isArtifactOn(artifactId, overrides, config.platformKey)) continue;
        filesToWrite.push({ fileName: mapping.fileName, content });
      }

      if (availableCount === 0) {
        addErrorLog('前端抓取失败：编辑器数据中无可用代码内容（HTML/CSS/JS 均为空）', '请确认编辑器已加载代码后再试');
        return;
      }

      const meta = data.metadata ?? {};
      const formName = typeof meta.formName === 'string' ? meta.formName : '';

      // Write FromCode：解析抓取到的 HTML（codes.html）提取控件元数据，修复控件为空
      if (isArtifactOn(ARTIFACT_IDS.fromCode, overrides, config.platformKey)) {
        const htmlSource = typeof codes.html === 'string' ? codes.html : '';
        const htmlMetadata = extractReadmeMetadataFromHtml(htmlSource, state.pageContext.url);
        // 优先使用 Vue 组件扫描出的表单名称（HTML 中 a-title 可能缺失）
        const metadata = { ...htmlMetadata, formName: formName || htmlMetadata.formName };
        // 读取现有 FromCode.md，跨多次抓取保留人工填写的关联表单信息
        const existingFromCodeRead = await readFilesFromSelection(state.pageContext, config.pageType, [FROM_CODE_FILE_NAME]);
        const existingFromCodeContent = existingFromCodeRead.files.find((f) => f.fileName === FROM_CODE_FILE_NAME)?.content ?? '';
        const fromCodeContent = buildFromCodeContent(metadata, state.pageContext.url, existingFromCodeContent);
        filesToWrite.push({ fileName: FROM_CODE_FILE_NAME, content: fromCodeContent });
      }

      // 补建模板类产物（README / AGENTS / design 目录 / sql 目录），已存在的不覆盖
      const templateArtifacts = getArtifactsFor(config.platformKey).filter((artifact) => artifact.kind === 'template');
      const existingPaths = await probeExistingArtifactPaths(templateArtifacts);
      const artifactFiles = buildMissingArtifactFiles(
        templateArtifacts,
        {
          platformKey: config.platformKey,
          pageLabel: config.pageLabel,
          pageUrl: state.pageContext.url,
          formName,
        },
        { existingPaths, overrides },
      );
      for (const artifactFile of artifactFiles) {
        filesToWrite.push({ fileName: artifactFile.relativePath, content: artifactFile.content });
      }

      if (filesToWrite.length === 0) {
        addWarningLog('本次没有任何产物需要写入（相关开关均已关闭）', '请在「更新范围」下拉或设置页开启需要的文件');
        return;
      }

      const writeResult = await writeFilesToSelection(state.pageContext, config.pageType, filesToWrite);
      reportArtifactWriteResult(writeResult, filesToWrite, '抓取');
    });
  });
}

// ── Cloudpivot Frontend Writeback ──────────────────────

async function handleCloudpivotWriteback(): Promise<void> {
  if (state.busy || !state.pageContext.tabId) return;
  await runWithButtonBusy(dom.writebackBtn, async () => {
    await runOperationWithPreflight(PREFLIGHT_OPERATION_IDS.WRITE_BACK, async () => {
      const tabId = state.pageContext.tabId!;
      const config = state.pageTypeConfig!;
      const componentName = resolveCloudpivotComponentName(config.pageType);

      const readResult = await readFilesFromSelection(state.pageContext, config.pageType, config.fileMappings.map((m) => m.fileName));
      // 与 gitHub 原版 readCodeFilesFromDirectory 一致：缺失/空内容计入 skippedKeys，仅回写有内容的 key
      const codeEntries: { key: string; content: string }[] = [];
      const skippedKeys: string[] = [];
      for (const mapping of config.fileMappings) {
        const file = readResult.files.find((f) => f.fileName === mapping.fileName);
        if (!file?.exists || !file.content) {
          skippedKeys.push(mapping.key);
          continue;
        }
        codeEntries.push({ key: mapping.key, content: file.content });
      }

      if (codeEntries.length === 0) {
        addErrorLog('本地目录中无对应文件，请先执行抓取写入', '确认当前目录中包含对应文件名的文件');
        return;
      }

      const data = await safeExecuteScript(
        tabId,
        pageWritebackMain,
        [{ candidateComponentNames: [componentName], codeEntries, skippedKeys }],
        '云枢前端回写',
      ) as PageWritebackResult | null;

      if (data?.ok) {
        const shimmed = (data.compatibilityState as { shimmed?: boolean } | undefined)?.shimmed;
        addSuccessLog(`回写完成：${data.updatedKeys.length} 个代码块已同步${shimmed ? '（已注入 webIDEService 兼容兜底）' : ''}`);
      } else {
        addErrorLog(`回写失败（${data?.errorCode ?? ''}）：${String(data?.details || data?.errorCode || '未知错误')}`, '确认页面为云枢在线开发页面，且编辑器已加载');
      }
    });
  });
}

// ── Cloudpivot BizRule Capture ─────────────────────────

async function handleCloudpivotBizRuleCapture(): Promise<void> {
  if (state.busy || !state.pageContext.tabId) return;
  await runWithButtonBusy(dom.bizRuleCaptureBtn, async () => {
    await runOperationWithPreflight(PREFLIGHT_OPERATION_IDS.CAPTURE, async () => {
      const tabId = state.pageContext.tabId!;

      // 业务规则入口独立于前端抓取范围，只读设置页持久配置（不受本次覆盖影响）
      if (!isArtifactOn(ARTIFACT_IDS.java, {}, state.pageTypeConfig!.platformKey)) {
        addWarningLog('「业务规则 Java」产物已关闭，本次跳过抓取', '如需抓取，请在设置页「文件助手」开启该项');
        return;
      }

      const data = await safeExecuteScript(tabId, bizRuleProbeMain, [{ multiModelHint: BIZ_RULE_USAGE_NOTICE }], '业务规则抓取') as BizRuleProbeResult | null;

      if (!data) return; // safeExecuteScript 已输出注入失败日志

      if (!data.ok) {
        const detail = Array.isArray(data.details) ? data.details.join('；') : String(data.details || '未找到业务规则代码');
        addErrorLog(`业务规则抓取失败（${data.errorCode}）：${detail}`, BIZ_RULE_USAGE_NOTICE);
        return;
      }

      if (!data.sourceContent) {
        addErrorLog('业务规则抓取失败：页面已找到 Monaco model，但源代码内容为空', BIZ_RULE_USAGE_NOTICE);
        return;
      }

      if (!data.fileName) {
        addErrorLog('业务规则抓取失败：已读取源代码，但未能解析输出文件名', BIZ_RULE_USAGE_NOTICE);
        return;
      }

      // 业务规则抓取只输出业务规则文件本身，不生成 README/AGENTS/DESIGN 等协作文件，
      // 也不受更新范围配置影响（与 gitHub 原版规则一致，避免污染业务规则目录）。
      const existingFiles = await fileExistsInSelection(state.pageContext, state.pageTypeConfig!.pageType, [data.fileName]);
      const hadTargetFile = existingFiles.files.find((f) => f.fileName === data.fileName)?.exists ?? false;

      const writeResult = await writeFilesToSelection(state.pageContext, state.pageTypeConfig!.pageType, [{ fileName: data.fileName, content: data.sourceContent }]);
      if (writeResult.written === 0) {
        addErrorLog(`业务规则抓取失败：${data.fileName} 未写入目标目录`, '请确认已选择目标目录且目录可写，或点击「更新当前路径」重新选择');
        return;
      }
      addSuccessLog(`业务规则抓取完成：${writeResult.written} 个文件（${data.fileName}${hadTargetFile ? '，已更新' : '，已新建'}） 类名:${data.className || '未解析'} 语言:${data.language || '未知'} 源码长度:${data.sourceLength}`);
    });
  });
}

// ── Cloudpivot BizRule Writeback ───────────────────────

async function handleCloudpivotBizRuleWriteback(): Promise<void> {
  if (state.busy || !state.pageContext.tabId) return;
  await runWithButtonBusy(dom.bizRuleWritebackBtn, async () => {
    await runOperationWithPreflight(PREFLIGHT_OPERATION_IDS.WRITE_BACK, async () => {
      const tabId = state.pageContext.tabId!;

      // 先探测 model 获取文件名（与 gitHub 原版一致：probe 传入 multiModelHint）
      const probeData = await safeExecuteScript(tabId, bizRuleProbeMain, [{ multiModelHint: BIZ_RULE_USAGE_NOTICE }], '业务规则模型探测') as BizRuleProbeResult | null;
      const fileName = probeData?.ok ? probeData.fileName : '';

      if (!fileName) {
        addErrorLog('未找到业务规则 model', BIZ_RULE_USAGE_NOTICE);
        return;
      }

      const readResult = await readFilesFromSelection(state.pageContext, state.pageTypeConfig!.pageType, [fileName]);
      const entry = readResult.files.find((f) => f.fileName === fileName);

      if (!entry?.exists || !entry.content) {
        const details = buildBizRuleMissingFileDetails(fileName);
        addErrorLog(details.summary, details.details[0]);
        return;
      }

      const writeData = await safeExecuteScript(tabId, bizRuleWritebackMain, [{ fileName, sourceContent: entry.content, multiModelHint: BIZ_RULE_USAGE_NOTICE }], '业务规则回写') as BizRuleWritebackResult | null;

      if (writeData?.ok) {
        addSuccessLog(`业务规则回写完成：${writeData.fileName || fileName}（语言:${writeData.language || '未知'} URI:${writeData.uri || '空'} 长度:${writeData.sourceLength} 编辑器:${writeData.editorCount ?? '-'} 模型:${writeData.modelCount ?? '-'}）`);
      } else {
        addErrorLog(`业务规则回写失败（${writeData?.errorCode ?? ''}）：${String(writeData?.details || writeData?.errorCode || '未知错误')}`, BIZ_RULE_USAGE_NOTICE);
      }
    });
  });
}

// ── H3Yun Capture All ──────────────────────────────────

async function handleH3yunCaptureAll(): Promise<void> {
  if (state.busy || !state.pageContext.tabId) return;
  await runWithButtonBusy(dom.h3yunCaptureAllBtn, async () => {
    await runOperationWithPreflight(PREFLIGHT_OPERATION_IDS.CAPTURE, async () => {
      const tabId = state.pageContext.tabId!;
      const designMode = resolveH3yunDesignMode(state.pageTypeConfig);
      // 本次范围：使用氚云已保存的选择（弹窗下拉持久化，重开弹窗保持一致）
      const overrides = platformOverrides('h3yun');
      const filesToWrite: { fileName: string; content: string }[] = [];
      const skipped: string[] = [];

      // 并行探测元数据 / 前端代码 / 后端 C#
      const [metadataResult, frontendResult, backendResult] = await Promise.all([
        safeExecuteScript(tabId, h3yunDesignerMetadataMain, [], '氚云元数据抓取') as Promise<H3yunDesignerMetadataResult | null>,
        safeExecuteScript(tabId, h3yunCodeEditorProbeMain, [H3YUN_CODE_EDITOR_CONFIG.frontend], '氚云前端JS抓取') as Promise<H3yunCodeEditorProbeResult | null>,
        safeExecuteScript(tabId, h3yunCodeEditorProbeMain, [H3YUN_CODE_EDITOR_CONFIG.backend], '氚云后端C#抓取') as Promise<H3yunCodeEditorProbeResult | null>,
      ]);
      const metadata = metadataResult || null;
      const metadataOk = metadata?.ok === true;
      const controls = metadataOk && Array.isArray(metadata.controls) ? metadata.controls : [];

      // 与产物开关无关的「页面是否有内容」判定，用于区分「未挂载」与「开关全关」
      const availableCount =
        (metadataOk && controls.length ? 1 : 0)
        + (frontendResult?.ok && frontendResult.sourceContent ? 1 : 0)
        + (backendResult?.ok && backendResult.sourceContent ? 1 : 0);

      const fromCodeEnabled = isArtifactOn(ARTIFACT_IDS.fromCode, overrides, 'h3yun');
      const frontendEnabled = isArtifactOn(ARTIFACT_IDS.js, overrides, 'h3yun');
      const backendEnabled = isArtifactOn(ARTIFACT_IDS.cs, overrides, 'h3yun');

      // 列表设计模式无图形控件，靠 controls.length 判断即可，无需单独分支
      if (fromCodeEnabled && metadataOk && controls.length) {
        filesToWrite.push({ fileName: FROM_CODE_FILE_NAME, content: buildH3yunFromCodeContent(metadata) });
        const sourceLabel = metadata?.ok && metadata.source === 'formDesignApi' ? '设计器接口' : 'DOM/状态';
        addLog(`图形控件：${controls.length} 个（来源：${sourceLabel}）`, 'info');
      } else if (fromCodeEnabled) {
        skipped.push('图形控件');
        if (!metadataOk) {
          addLog(`图形控件元数据未就绪：${formatProbeFailure(metadataResult, '未返回结果')}，将跳过 FromCode`, 'warning');
        } else {
          const readDiagnostic = metadata?.ok ? metadata.readDiagnostic || '无诊断信息' : '无诊断信息';
          addLog(`图形控件未解析出任何控件（${readDiagnostic}），将跳过 FromCode`, 'warning');
        }
      } else {
        skipped.push('FromCode（已关闭）');
      }

      if (!frontendEnabled) {
        skipped.push('前端代码（已关闭）');
      } else if (frontendResult?.ok && frontendResult.sourceContent) {
        const frontendFileName = resolveH3yunFrontendFileName({
          sourceContent: frontendResult.sourceContent,
          pageUrl: frontendResult.pageUrl || state.pageContext.url,
          designMode,
        });
        filesToWrite.push({ fileName: frontendFileName, content: frontendResult.sourceContent });
      } else {
        skipped.push('前端代码');
        addLog(`前端代码未挂载：${formatProbeFailure(frontendResult, '前端代码区域未找到或内容为空')}`, 'warning');
      }

      if (!backendEnabled) {
        skipped.push('后端 C#（已关闭）');
      } else if (backendResult?.ok && backendResult.sourceContent) {
        const backendFileName = resolveH3yunBackendFileName({ sourceContent: backendResult.sourceContent, pageUrl: backendResult.pageUrl || state.pageContext.url, designMode });
        filesToWrite.push({ fileName: backendFileName, content: backendResult.sourceContent });
      } else {
        skipped.push('后端 C#');
        addLog(`后端 C# 未挂载：${formatProbeFailure(backendResult, '后端代码区域未找到或内容为空')}`, 'warning');
      }

      if (availableCount === 0) {
        addErrorLog('当前页面没有挂载图形控件、前端代码或后端 C# 编辑器', '请确认：1) 已切换到氚云设计页 2) 页面完全加载 3) 前端/后端代码区域已打开');
        return;
      }

      // 补建模板类产物（README / AGENTS / design/design-js.md / design/design-cs.md），已存在的不覆盖
      // 注意：pageType 必须与"更新当前路径"绑定时一致（state.pageTypeConfig.pageType），
      // 否则读不到绑定目录会回退到平台兜底路径，导致文件写到错误目录。
      const h3yunPageType = state.pageTypeConfig?.pageType || 'default';
      const templateArtifacts = getArtifactsFor('h3yun').filter((artifact) => artifact.kind === 'template');
      const existingPaths = await probeExistingArtifactPaths(templateArtifacts);
      const artifactFiles = buildMissingArtifactFiles(
        templateArtifacts,
        {
          platformKey: 'h3yun',
          pageLabel: state.pageTypeConfig?.pageLabel || '',
          pageUrl: state.pageContext.url,
        },
        { existingPaths, overrides },
      );
      filesToWrite.push(...artifactFiles.map((artifactFile) => ({
        fileName: artifactFile.relativePath,
        content: artifactFile.content,
      })));

      if (filesToWrite.length === 0) {
        addWarningLog('本次没有任何产物需要写入（相关开关均已关闭）', '请在「更新范围」下拉或设置页开启需要的文件');
        return;
      }

      const writeResult = await writeFilesToSelection(state.pageContext, h3yunPageType, filesToWrite);
      reportArtifactWriteResult(writeResult, filesToWrite, '氚云一键抓取', skipped);
    });
  });
}

// ── H3Yun Writeback ────────────────────────────────────

async function handleH3yunCodeWriteback(codeKind: 'frontend' | 'backend'): Promise<void> {
  if (state.busy || !state.pageContext.tabId) return;
  const btnMap = { frontend: dom.h3yunWritebackFrontendBtn, backend: dom.h3yunWritebackBackendBtn };
  const btn = btnMap[codeKind];
  await runWithButtonBusy(btn, async () => {
    await runOperationWithPreflight(PREFLIGHT_OPERATION_IDS.WRITE_BACK, async () => {
      const config = H3YUN_CODE_EDITOR_CONFIG[codeKind];
      const tabId = state.pageContext.tabId!;
      const designMode = resolveH3yunDesignMode(state.pageTypeConfig);

      // 与 gitHub 原版 handleH3yunCodeWriteback 一致：
      // 先探测当前编辑器（拿到 pageUrl / sourceContent），再决定读取哪个本地文件。
      const probeResult = await safeExecuteScript(tabId, h3yunCodeEditorProbeMain, [config], '氚云编辑器探测') as H3yunCodeEditorProbeResult | null;

      if (!probeResult?.ok) {
        addErrorLog(`氚云${config.label}回写失败：${probeResult?.details || `${config.selector} 未找到可回写编辑器`}`, '确认氚云页面已切到对应前端/后端代码区域并完全加载');
        return;
      }

      const fileName = resolveH3yunCodeFileName(codeKind, probeResult, probeResult.pageUrl || state.pageContext.url, designMode);
      // 与一键抓取一致：pageType 用绑定时的 pageTypeConfig.pageType，避免回退到平台兜底路径
      const readResult = await readFilesFromSelection(state.pageContext, state.pageTypeConfig?.pageType || 'default', [fileName]);
      const file = readResult.files.find((f) => f.fileName === fileName);

      if (!file?.exists || !file.content) {
        addErrorLog(`目标目录中未找到 ${fileName}，请先执行一键抓取写入`);
        return;
      }

      const sourceContent = normalizeExcessBlankLines(file.content);
      const writeData = await safeExecuteScript(
        tabId,
        h3yunCodeEditorWritebackMain,
        [{ ...config, sourceContent }],
        '氚云代码回写',
      ) as H3yunCodeEditorWritebackResult | null;

      if (writeData?.ok) {
        const modelNote = writeData.writableCount > 1 ? `（已写入 ${writeData.writableCount} 个 model）` : '';
        addSuccessLog(`氚云${config.label}回写成功。${modelNote} 文件名：${fileName} 源码长度：${writeData.sourceLength} 字符`);
      } else {
        const logExtra = writeData?.debugLog ? `\n调试日志：${writeData.debugLog}` : '';
        addErrorLog(`氚云${config.label}回写失败：${writeData?.details || '页面编辑器拒绝回写'}${logExtra}`, '确认氚云页面已切到对应前端/后端代码区域并完全加载');
      }
    });
  });
}

// ── Preflight ──────────────────────────────────────────

/** 预检 blocker 的可读文案（内部 checkId 不直接展示给用户） */
const PREFLIGHT_BLOCKER_MESSAGES: Record<string, string> = {
  'page.recognized': '当前页面不是云枢 / 氚云的设计页面',
  'directory.selected': '尚未选择目标目录',
};

async function runOperationWithPreflight(
  operationId: string,
  task: (results: PreflightResult[]) => Promise<void>,
): Promise<void> {
  const results: PreflightResult[] = [];

  // Page context check
  const isRecognized = Boolean(
    state.pageContext?.url && isRecognizedPlatformUrl(state.pageContext.url),
  );
  results.push(createPreflightResult({
    operationId, checkId: 'page.recognized',
    severity: isRecognized ? 'info' : 'blocker',
    ok: isRecognized,
    errorCode: isRecognized ? '' : 'ERR_INVALID_TARGET',
    evidence: state.pageContext.url,
    nextAction: isRecognized ? '' : '请在云枢或氚云设计页面使用本扩展',
  }));

  // 目录检查：当前页面有效句柄存在即可（目录归属由 fromcode 校验在写入链路把守）
  if (isRecognized) {
    const path = await getStoredDirectoryPath(state.pageContext, resolveEffectivePageType());
    results.push(createPreflightResult({
      operationId, checkId: 'directory.selected',
      severity: path ? 'info' : 'blocker',
      ok: Boolean(path),
      errorCode: path ? '' : 'ERR_DIRECTORY_NOT_SELECTED',
      evidence: path || '未选择',
      nextAction: path ? '' : '请点击「更新当前路径」选择目标目录',
    }));
  }

  if (hasBlockingPreflightResult(results)) {
    for (const result of results) {
      if (result.severity !== 'blocker' || result.ok) continue;
      addErrorLog(PREFLIGHT_BLOCKER_MESSAGES[result.checkId] || `预检未通过：${result.checkId}`, result.nextAction);
    }
    return;
  }

  await task(results);
}

// ── Runtime Log Export ─────────────────────────────────

function buildRuntimeLogText(): string {
  const uiLines = state.logEntries.map((e) => `[${e.time}] ${e.message}` + (e.suggestion ? `\n  建议: ${e.suggestion}` : ''));
  const systemLines = logger.getLogBuffer().map((e) => `[${new Date(e.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}] [system:${e.level}] ${e.message}`);
  if (systemLines.length === 0) return uiLines.join('\n');
  return [...uiLines, '', '--- 系统日志 ---', ...systemLines].join('\n');
}

async function handleCopyRuntimeLog(): Promise<void> {
  const text = buildRuntimeLogText();
  await navigator.clipboard.writeText(text);
  addSuccessLog('日志已复制');
}

/** 复制原始实现风格的文件下载函数（避免 popup 被关闭） */
function downloadTextFile(fileName: string, text: string, mimeType = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 导出运行时日志：使用文件下载（同源 blob 不会关闭 popup） */
async function handleExportRuntimeLog(): Promise<void> {
  try {
    downloadTextFile(
      `cloudpiovt-plugin-log-${buildDownloadTimestamp()}.txt`,
      buildRuntimeLogText(),
      'text/plain;charset=utf-8',
    );
    addSuccessLog('运行日志已导出，请将日志文件发给作者排查');
  } catch (error: unknown) {
    // 兜底：剪贴板写入
    try {
      await navigator.clipboard.writeText(buildRuntimeLogText());
      addSuccessLog('导出失败但已复制到剪贴板');
    } catch {
      addErrorLog(`导出日志失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function handleExportDiagnosticPackage(): Promise<void> {
  try {
    // 合并系统日志（logger 缓冲）与 UI 日志，避免诊断时系统日志丢失
    const systemLogs = logger.getLogBuffer().map((entry) => ({
      time: new Date(entry.timestamp).toISOString(),
      level: entry.level,
      lines: [entry.message],
      suggestion: '',
      context: entry.context ?? {},
    }));
    const uiLogs = state.logEntries.map((e) => ({
      time: e.time,
      level: e.level,
      lines: [e.message],
      suggestion: e.suggestion ?? '',
      context: {},
    }));
    const pkg = buildDiagnosticPackage({
      operationId: 'diagnostic',
      extension: { name: '开发助手', version: CURRENT_EXTENSION_VERSION },
      browser: { userAgent: navigator.userAgent },
      logs: [...systemLogs, ...uiLogs],
    });
    await saveLastDiagnosticPackage(pkg as unknown as Record<string, unknown>);
    const text = JSON.stringify(pkg);
    await navigator.clipboard.writeText(text);
    addSuccessLog('诊断包已复制到剪贴板');
  } catch (err: unknown) {
    addErrorLog(`导出失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Recent Directories ─────────────────────────────────

async function loadRecentDirectories(): Promise<void> {
  state.recentDirectories = await getRecentTargetDirectories();
}

// ── Init ───────────────────────────────────────────────

async function init(): Promise<void> {
  logger.debug('Popup initializing');

  // 加载配置
  state.config = await loadConfig();
  state.artifacts = await loadArtifactConfig();
  // 更新范围：恢复上次保存的选择，重开弹窗后勾选与上次一致
  await restoreScopeOverrides();

  // 获取当前页信息
  await updatePageInfo();

  // 加载最近目录
  await loadRecentDirectories();

  // 渲染 UI（目录名从当前有效句柄解析，展示与读写同源）
  await updateDirectoryDisplay();

  // 只有识别为云枢 / 氚云页面时才自动自检；其它页面不触碰目录。
  if (isRecognizedPlatformUrl(state.pageContext.url)) {
    const check = await checkTargetDirectoryHealth(state.pageContext, resolveEffectivePageType());
    reportDirectoryCheckResult(check);
  }

  // 状态
  if (state.pageTypeConfig) {
    addLog(`平台: ${PLATFORM_LABELS[state.pageTypeConfig.platformKey]} (${state.pageTypeConfig.pageLabel})`);
  }
}

// ── Event Binding ──────────────────────────────────────

function bindEvents(): void {
  // 页面链接复制
  dom.pageOriginEl?.addEventListener('click', () => handleCopyPageOrigin());

  // 目录操作
  dom.refreshHandleBtn?.addEventListener('click', () => handleRefreshDirectory());
  dom.copyPathBtn?.addEventListener('click', () => handleCopyPath());

  // 搜索
  dom.searchInput?.addEventListener('input', () => {
    renderSearchDropdown(dom.searchInput?.value || '');
    openSearchDropdown();
  });
  dom.searchInput?.addEventListener('focus', () => { renderSearchDropdown(''); openSearchDropdown(); });

  dom.searchDropdown?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // × 删除按钮优先（它位于 .search-item 内部，必须比父容器先判断）
    const removeBtn = target.closest('.search-item-remove') as HTMLElement | null;
    if (removeBtn) {
      e.stopPropagation();
      const path = removeBtn.dataset.remove;
      if (path) { void handleRemoveHistoryPath(path); }
      return;
    }

    // 清除当前平台历史
    const clearBtn = target.closest('.search-clear-btn') as HTMLElement | null;
    if (clearBtn) {
      e.stopPropagation();
      void handleClearHistory();
      return;
    }

    // 选择目录项
    const item = target.closest('.search-item') as HTMLElement | null;
    if (item) {
      item.classList.add('is-selected');
      const path = item.dataset.path;
      if (path) setTimeout(() => { void handleSelectHistoryPath(path); }, 250);
      return;
    }
  });

  // 绑定"清空历史记录"按钮（HTML 中已有，仅需注册事件）
  $('#clear-history-btn')?.addEventListener('click', (e) => { e.stopPropagation(); handleClearHistory(); });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    // 关闭搜索下拉（点击搜索输入框和下拉列表容器外部时关闭）
    if (!target.closest('#search-input-wrap') && !target.closest('#search-dropdown') && state.searchDropdownOpen) {
      closeSearchDropdown();
    }
    // 点击外部关闭导出下拉
    if (!target.closest('#export-dropdown-menu') && !target.closest('#export-dropdown-btn') && state.exportDropdownOpen) {
      state.exportDropdownOpen = false;
      if (dom.exportDropdownMenu) dom.exportDropdownMenu.hidden = true;
    }
  });

  // 云枢按钮
  dom.captureBtn?.addEventListener('click', () => handleCloudpivotCapture());
  dom.writebackBtn?.addEventListener('click', () => handleCloudpivotWriteback());
  dom.bizRuleCaptureBtn?.addEventListener('click', () => handleCloudpivotBizRuleCapture());
  dom.bizRuleWritebackBtn?.addEventListener('click', () => handleCloudpivotBizRuleWriteback());

  // 氚云按钮
  dom.h3yunCaptureAllBtn?.addEventListener('click', () => handleH3yunCaptureAll());
  dom.h3yunOneClickWritebackBtn?.addEventListener('click', () => handleH3yunOneClickWriteback());
  dom.h3yunWritebackFrontendBtn?.addEventListener('click', () => handleH3yunCodeWriteback('frontend'));
  dom.h3yunWritebackBackendBtn?.addEventListener('click', () => handleH3yunCodeWriteback('backend'));

  // 更新范围：主按钮旁的 ▾ 打开下拉（面板绝对定位，不占布局）
  dom.cloudpivotScopeBtn?.addEventListener('click', (e) => { e.stopPropagation(); handleScopeToggle('cloudpivot'); });
  dom.h3yunScopeBtn?.addEventListener('click', (e) => { e.stopPropagation(); handleScopeToggle('h3yun'); });

  for (const [platformKey, menu] of [['cloudpivot', dom.cloudpivotScopeMenu], ['h3yun', dom.h3yunScopeMenu]] as const) {
    menu?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-scope-reset]')) {
        void resetScopeToConfig(platformKey as PlatformKey);
        return;
      }
      // 行内点击交给原生 checkbox，不关闭面板
      if (target.closest('.scope-artifact')) event.stopPropagation();
    });
    menu?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.matches('[data-scope-artifact]')) {
        void handleScopeMenuChange(platformKey as PlatformKey, target);
      }
    });
  }

  document.addEventListener('click', closeScopeDropdown);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeScopeDropdown(); });

  // 导出 / 复制日志 / 设置
  dom.exportDropdownBtn?.addEventListener('click', (e) => { e.stopPropagation(); handleExportDropdownToggle(); });
  dom.exportLogBtn?.addEventListener('click', () => { handleExportRuntimeLog(); state.exportDropdownOpen = false; if (dom.exportDropdownMenu) dom.exportDropdownMenu.hidden = true; });
  dom.exportDiagBtn?.addEventListener('click', () => { handleExportDiagnosticPackage(); state.exportDropdownOpen = false; if (dom.exportDropdownMenu) dom.exportDropdownMenu.hidden = true; });
  dom.copyLogBtn?.addEventListener('click', () => handleCopyRuntimeLog());
  dom.openOptionsBtn?.addEventListener('click', () => handleOpenOptions());

  // 平台标签：点击切换面板 + 同步 active 状态 + 刷新历史下拉
  dom.platformTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const platform = (tab.dataset.platformTab || 'cloudpivot') as PlatformKey;
      setActivePlatform(platform);
      renderSearchDropdown(dom.searchInput?.value || '');
    });
  });
}

// ── Bootstrap ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  init()
    .then(() => logger.debug('Popup ready'))
    .catch((error: unknown) => reportExecutionError('页面初始化失败', error));
});
