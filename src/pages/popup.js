import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_SELECTION_STRATEGY,
  PLATFORM_CONFIG,
  isOriginAllowed,
  loadConfig,
  resolvePageTypeConfig,
  resolveH3yunDesignMode
} from "../../lib/config.js";
import {
  BIZ_RULE_USAGE_NOTICE,
  buildBizRuleMissingFileDetails
} from "../../lib/platform/bizrule-constraints.js";
import {
  ensureTargetDirectorySelection,
  fileExistsInSelection,
  readFilesFromSelection,
  refreshTargetDirectorySelection,
  supportsDirectoryPicker,
  writeFilesToSelection
} from "../../lib/directory/target-directory-access.js";
import {
  createTargetDirectoryPageScope,
  ensureTargetDirectorySnapshot,
  getStoredDirectoryPath,
  getStoredTargetDirectorySelection,
  saveNativeTargetDirectorySelection
} from "../../lib/directory/target-directory-state.js";
import { buildReadmeWriteFiles, extractReadmeMetadataFromHtml } from "../../lib/platform/readme-parser.js";
import {
  addRecentTargetDirectory,
  getRecentTargetDirectories,
  removeRecentTargetDirectory
} from "../../lib/directory/recent-target-directories.js";
import {
  launchNativeEditor,
  pickNativeDirectory,
  probeNativeHost,
  statNativeDirectoryFiles
} from "../../lib/services/native-host.js";
import {
  buildH3yunFromCodeContent,
  resolveH3yunBackendFileName,
  resolveH3yunFrontendFileName
} from "../../lib/platform/h3yun-code.js";
import {
  buildMissingWorkspaceDocumentFiles,
  LEGACY_WORKSPACE_DOCUMENT_FILE_NAMES,
  WORKSPACE_DOCUMENT_FILE_NAMES
} from "../../lib/services/workspace-documents.js";
import {
  PREFLIGHT_OPERATION_IDS,
  PREFLIGHT_SEVERITY,
  buildDiagnosticPackage,
  createWritebackRiskResult,
  createPreflightResult,
  formatPreflightStatusLines,
  hasBlockingPreflightResult,
  saveLastDiagnosticPackage
} from "../../lib/services/preflight-diagnostics.js";
import {
  getAvailableLaunchers,
  getLauncherIconPath,
  selectDefaultLauncher
} from "../../lib/services/custom-launchers.js";

const pageOriginEl = document.querySelector("#page-origin");
const targetHandleEl = document.querySelector("#target-handle");
const copyPathButton = document.querySelector("#copy-path-btn");
const targetPathSectionEl = document.querySelector("#target-path-section");
const historyFlatItems = document.querySelector("#history-flat-items");
const historyEmptyEl = document.querySelector("#history-empty");
const historyMoreButton = document.querySelector("#history-more-btn");
const refreshHandleButton = document.querySelector("#refresh-handle-btn");
const statusOutput = document.querySelector("#status-output");
const copyLogButton = document.querySelector("#copy-log-btn");
const exportLogButton = document.querySelector("#export-log-btn");
const exportDiagnosticButton = document.querySelector("#export-diagnostic-btn");
const exportDropdownButton = document.querySelector("#export-dropdown-btn");
const exportDropdownMenu = document.querySelector("#export-dropdown-menu");
const frontendCaptureWriteButton = document.querySelector("#frontend-capture-write-btn");
const frontendWritebackButton = document.querySelector("#frontend-writeback-btn");
const bizruleCaptureWriteButton = document.querySelector("#bizrule-capture-write-btn");
const bizruleWritebackButton = document.querySelector("#bizrule-writeback-btn");
const launcherMainButton = document.querySelector("#launcher-main-btn");
const launcherMainIcon = document.querySelector("#launcher-main-icon");
const launcherMenuButton = document.querySelector("#launcher-menu-btn");
const launcherMenu = document.querySelector("#launcher-menu");
const openOptionsButton = document.querySelector("#open-options-btn");
const platformTabsEl = document.querySelector("#platform-tabs");
const platformTabButtons = Array.from(document.querySelectorAll("[data-platform-tab]"));
const platformPanels = Array.from(document.querySelectorAll("[data-platform-panel]"));
const h3yunCaptureAllButton = document.querySelector("#h3yun-capture-all-btn");
const h3yunOneClickWritebackButton = document.querySelector("#h3yun-oneclick-writeback-btn");
const h3yunFrontendWritebackButton = document.querySelector("#h3yun-frontend-writeback-btn");
const h3yunBackendWritebackButton = document.querySelector("#h3yun-backend-writeback-btn");
const h3yunSeparateWritebackRow = document.querySelector("#h3yun-separate-writeback-row");
// 文件选择器弹层元素
const filePickerOverlay = document.querySelector("#file-picker-overlay");
const extraReadmeCheck = document.querySelector("#extra-readme-check");
const extraAgentsCheck = document.querySelector("#extra-agents-check");
const extraDesignCheck = document.querySelector("#extra-design-check");
const filePickerConfirmButton = document.querySelector("#file-picker-confirm-btn");
const filePickerSkipButton = document.querySelector("#file-picker-skip-btn");

let currentPageContext = null;
// 当前弹窗会话的配置快照，每次 init 刷新。
let currentConfig = null;
let currentTargetPath = "";
let isPopupBusy = false;
// 历史目录展开状态：默认展示前 3 条，对超出的条目折叠为"更多 (N个)"按钮。
let isHistoryExpanded = false;
// 运行日志只保存在当前弹窗会话中，便于用户复制/导出给作者排查，不持久化业务数据。
const runtimeLogs = [];
// 历史目录平铺展示上限，超出折叠。
const HISTORY_VISIBLE_LIMIT = 3;
// 文件选择器回调：挂起的写入操作，用户确认后继续执行。
let pendingFilePickerCallback = null;
// 弹窗生命周期很短，限制最近 80 条可以保留完整排查上下文，同时避免日志撑爆弹窗内存。
const RUNTIME_LOG_LIMIT = 80;
let lastDiagnosticPackage = null;
// 当前弹窗选中的平台标签，只影响 UI 展示，不直接决定页面实际适配类型。
let activePlatformKey = PLATFORM_CONFIG.cloudpivot.platformKey;
let currentLaunchers = [];
let defaultLauncher = null;
let isLauncherMenuOpen = false;

const H3YUN_CODE_EDITOR_CONFIG = {
  frontend: {
    codeKind: "frontend",
    label: "前端代码",
    selector: "#jsText",
    // 氚云 Monaco 编辑器未设置 language ID，需要匹配 undefined + 内容特征
    modeIds: ["javascript", "typescript", undefined, ""]
  },
  backend: {
    codeKind: "backend",
    label: "后端代码",
    selector: "#csText",
    modeIds: ["alonesharp", "csharp", undefined, ""]
  }
};
const WORKSPACE_README_FILE_NAMES = [
  WORKSPACE_DOCUMENT_FILE_NAMES.readme,
  ...LEGACY_WORKSPACE_DOCUMENT_FILE_NAMES.readme
];
const WORKSPACE_DESIGN_FILE_NAMES = [
  WORKSPACE_DOCUMENT_FILE_NAMES.design,
  ...LEGACY_WORKSPACE_DOCUMENT_FILE_NAMES.design
];
const COMMON_DIAGNOSTIC_FILE_NAMES = [
  WORKSPACE_DOCUMENT_FILE_NAMES.readme,
  ...LEGACY_WORKSPACE_DOCUMENT_FILE_NAMES.readme,
  WORKSPACE_DOCUMENT_FILE_NAMES.agents,
  WORKSPACE_DOCUMENT_FILE_NAMES.design,
  ...LEGACY_WORKSPACE_DOCUMENT_FILE_NAMES.design,
  WORKSPACE_DOCUMENT_FILE_NAMES.fromCode,
  "form-index.html",
  "form-style.css",
  "form-script.js",
  "list-index.html",
  "list-style.css",
  "list-script.js",
  "index.html",
  "style.css",
  "script.js"
];

function syncRecentPathInteractionState() {
  for (const element of recentPathsListEl.querySelectorAll("button")) {
    element.disabled = isPopupBusy;
  }
}

function syncLauncherInteractionState() {
  const hasDefaultLauncher = Boolean(defaultLauncher);
  launcherMainButton.disabled = isPopupBusy || !hasDefaultLauncher;
  launcherMenuButton.disabled = isPopupBusy || !getAvailableLaunchers(currentLaunchers).length;
  for (const element of launcherMenu.querySelectorAll("button")) {
    element.disabled = isPopupBusy;
  }
}

function setLauncherMenuOpen(isOpen) {
  isLauncherMenuOpen = Boolean(isOpen);
  launcherMenu.hidden = !isLauncherMenuOpen;
  launcherMenuButton.setAttribute("aria-expanded", isLauncherMenuOpen ? "true" : "false");
}

function renderLauncherMenuItem(launcher) {
  const button = document.createElement("button");
  button.className = "launcher-menu-item";
  button.type = "button";
  button.setAttribute("role", "menuitem");
  button.dataset.launcherId = launcher.launcherId;
  const icon = document.createElement("img");
  icon.className = "launcher-menu-icon";
  icon.src = getLauncherIconPath(launcher, 16);
  icon.alt = "";
  const name = document.createElement("span");
  name.className = "launcher-menu-name";
  name.textContent = launcher.name;
  button.append(icon, name);
  return button;
}

function renderLauncherControls(config) {
  currentLaunchers = Array.isArray(config?.customLaunchers) ? config.customLaunchers : [];
  defaultLauncher = selectDefaultLauncher(currentLaunchers);
  const availableLaunchers = getAvailableLaunchers(currentLaunchers);

  if (defaultLauncher) {
    launcherMainIcon.src = getLauncherIconPath(defaultLauncher, 16);
    launcherMainButton.title = `用 ${defaultLauncher.name} 打开当前目录`;
    launcherMainButton.setAttribute("aria-label", `用 ${defaultLauncher.name} 打开当前目录`);
  } else {
    launcherMainIcon.src = getLauncherIconPath({ iconKey: "file-explorer" }, 16);
    launcherMainButton.title = "请先在设置页配置打开方式";
    launcherMainButton.setAttribute("aria-label", "请先在设置页配置打开方式");
    setLauncherMenuOpen(false);
  }

  // 图标加载失败时隐蔽破损图标避免视觉干扰
  launcherMainIcon.onerror = () => {
    launcherMainIcon.style.display = "none";
  };

  launcherMenu.replaceChildren(...availableLaunchers.map(renderLauncherMenuItem));
  syncLauncherInteractionState();
}

function setBusy(isBusy) {
  isPopupBusy = Boolean(isBusy);
  frontendCaptureWriteButton.disabled = isBusy;
  frontendWritebackButton.disabled = isBusy;
  bizruleCaptureWriteButton.disabled = isBusy;
  bizruleWritebackButton.disabled = isBusy;
  refreshHandleButton.disabled = isBusy;
  syncLauncherInteractionState();
  targetPathToggleButton.disabled = isBusy;
  h3yunCaptureAllButton.disabled = isBusy;
  h3yunFrontendWritebackButton.disabled = isBusy;
  h3yunBackendWritebackButton.disabled = isBusy;
  for (const button of platformTabButtons) {
    button.disabled = isBusy;
  }
  syncRecentPathInteractionState();
}

// 长任务按钮只标记触发源，禁用其它操作仍由 setBusy 统一控制，避免多个抓取/回写任务并发写文件。
async function runWithButtonBusy(button, task) {
  button?.classList.add("is-running");
  button?.setAttribute("aria-busy", "true");
  try {
    return await task();
  } finally {
    button?.classList.remove("is-running");
    button?.removeAttribute("aria-busy");
  }
}

// 将数组、字符串和空值统一成日志行，后续级别判断和导出都基于同一份结构化内容。
function normalizeStatusLines(message) {
  return Array.isArray(message) ? message.map((item) => String(item || "")) : String(message || "").split(/\r?\n/);
}

// 每条日志都带上页面和目录上下文，方便作者从导出文件定位用户当时操作的位置。
function getCurrentLogContext() {
  const pageContext = currentPageContext || {};
  return {
    platform: getPlatformLabel(pageContext.pageTypeConfig?.platformKey || activePlatformKey),
    pageType: pageContext.pageType || "unknown",
    pageUrl: pageContext.tab?.url || "",
    targetPath: currentTargetPath || ""
  };
}

// 根据状态文案推断展示级别，避免每个业务分支都重复维护 info/warn/error。
function inferStatusLevel(lines) {
  const text = lines.join("\n")
    .replace(/未挂载：无/g, "")
    .replace(/缺失：无/g, "");
  if (/失败|错误|未找到|拒绝|异常|读取失败|写入失败|回写失败|failed|error|exception|denied/i.test(text)) return "error";
  if (/取消|跳过|缺失|未挂载|未选择|无法/.test(text)) return "warn";
  if (/成功|完成|已写入|已复制|已打开|已更新/.test(text)) return "success";
  return "info";
}

// 将常见失败归类为用户可执行的处理建议；无法归类时再提示导出日志给作者排查插件适配。
function inferTroubleshooting(lines) {
  const text = lines.join("\n");
  if (/Native Host|原生助手|native/i.test(text)) {
    return "处理建议：打开设置页检查原生助手状态；若未安装或扩展 ID 不匹配，请重新运行安装脚本。";
  }
  if (/目标目录|当前路径|文件夹|目录|尚未选择|权限|folder|directory|permission|denied|open folder dialog|implementation reports error/i.test(text)) {
    return "处理建议：点击当前路径旁的刷新按钮重新选择目录；确认浏览器或原生助手有读写该目录的权限。";
  }
  if (/Monaco|model|编辑器|未挂载|#jsText|#csText/.test(text)) {
    return "处理建议：确认氚云页面已完全加载，并切到对应前端/后端代码区域后重试；若仍失败，请导出日志联系作者适配页面结构。";
  }
  if (/子表控件编码缺失/.test(text)) {
    return "处理建议：若缺失数量不为 0，请导出日志，并附带问题子表 DOM 快照发给作者补充适配规则。";
  }
  if (/当前页面|平台|云枢|氚云|不支持/.test(text)) {
    return "处理建议：确认当前标签页是云枢在线开发页或氚云表单设计页，并选择匹配的平台标签。";
  }
  if (/未找到 .*\.java|目标目录中未找到/.test(text)) {
    return "处理建议：确认当前路径中存在要回写的同名源码文件；业务规则同页多开时请先关闭多余编辑器。";
  }
  if (/插件|扩展|适配/.test(text)) {
    return "处理建议：可能是插件适配不足，请复制或导出日志联系作者修改插件。";
  }
  if (/失败|错误|异常|拒绝|未找到/i.test(text)) {
    return "处理建议：按日志中的页面地址、页面类型和当前路径逐项确认；若页面和目录都正常但仍复现，请导出日志联系作者修改插件适配。";
  }
  return "";
}

// 单条日志的展示和导出保持同一格式，避免用户看到的信息与发给作者的信息不一致。
function formatLogEntry(entry) {
  const contextLines = [
    `平台：${entry.context.platform}`,
    `页面类型：${entry.context.pageType}`,
    entry.context.pageUrl ? `页面地址：${entry.context.pageUrl}` : "",
    entry.context.targetPath ? `当前路径：${entry.context.targetPath}` : ""
  ].filter(Boolean);

  return [
    `[${entry.time}] ${entry.level.toUpperCase()}`,
    ...contextLines,
    "状态：",
    ...entry.lines,
    entry.suggestion || "",
    entry.level === "error" ? "插件原因提示：若页面已加载、目录权限正常但仍失败，请导出日志联系作者排查插件适配。" : ""
  ].filter(Boolean).join("\n");
}

// 生成可直接发给作者的完整日志文本，包含扩展版本和浏览器环境，便于复现版本差异。
function buildRuntimeLogText() {
  const manifest = globalThis.chrome?.runtime?.getManifest?.() || {};
  return [
    "开发助手运行日志",
    `导出时间：${new Date().toLocaleString()}`,
    `扩展名称：${manifest.name || "unknown"}`,
    `扩展版本：${manifest.version || "unknown"}`,
    `浏览器环境：${globalThis.navigator?.userAgent || "unknown"}`,
    `日志条数：${runtimeLogs.length}`,
    "",
    ...runtimeLogs.map(formatLogEntry)
  ].join("\n\n---\n\n");
}

function buildDownloadTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function downloadTextFile(fileName, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildPageProbeSnapshot(pageContext = currentPageContext || {}) {
  const tab = pageContext.tab || {};
  const pageTypeConfig = pageContext.pageTypeConfig || {};
  const executableContextError = getExecutableContextError(tab);
  return {
    url: tab.url || "",
    title: tab.title || "",
    platformKey: pageTypeConfig.platformKey || activePlatformKey,
    pageType: pageContext.pageType || "",
    pageLabel: pageTypeConfig.pageLabel || "",
    executableContextOk: !executableContextError,
    monacoModels: []
  };
}

function buildExtensionDiagnosticContext() {
  const manifest = globalThis.chrome?.runtime?.getManifest?.() || {};
  return {
    extension: {
      name: manifest.name || "unknown",
      version: manifest.version || "unknown"
    },
    browser: {
      userAgent: globalThis.navigator?.userAgent || "unknown"
    }
  };
}

function buildDiagnosticFileNames(pageTypeConfig = {}) {
  const mappedFiles = Array.isArray(pageTypeConfig.fileMappings)
    ? pageTypeConfig.fileMappings.map((item) => item.fileName)
    : [];
  return Array.from(new Set([
    ...COMMON_DIAGNOSTIC_FILE_NAMES,
    ...mappedFiles
  ].filter(Boolean)));
}

async function statHandleDirectoryFiles(directorySelection, fileNames) {
  const files = [];
  for (const fileName of fileNames) {
    try {
      const fileHandle = await directorySelection.handle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      files.push({
        fileName,
        exists: true,
        size: file.size,
        modifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : ""
      });
    } catch (error) {
      if (error?.name === "NotFoundError") {
        files.push({ fileName, exists: false, size: null, modifiedAt: "" });
        continue;
      }
      files.push({
        fileName,
        exists: false,
        size: null,
        modifiedAt: "",
        error: error?.message || String(error)
      });
    }
  }
  return files;
}

async function buildDirectorySnapshotForDiagnostics(directorySelection, pageTypeConfig = {}) {
  if (!directorySelection) {
    return { accessMode: "", targetPath: currentTargetPath, files: [] };
  }

  const fileNames = buildDiagnosticFileNames(pageTypeConfig);
  if (directorySelection.kind === "native-path") {
    const response = await statNativeDirectoryFiles({
      directoryPath: directorySelection.directoryPath,
      fileNames
    });
    return {
      accessMode: "Native Host",
      targetPath: directorySelection.directoryPath || "",
      files: Array.isArray(response?.files) ? response.files : []
    };
  }

  if (directorySelection.kind === "handle") {
    return {
      accessMode: "File System Access API",
      targetPath: currentTargetPath || directorySelection.label || "",
      files: await statHandleDirectoryFiles(directorySelection, fileNames)
    };
  }

  return { accessMode: "", targetPath: currentTargetPath, files: [] };
}

async function statSingleDirectoryFile(directorySelection, fileName) {
  if (!directorySelection || !fileName) {
    return { fileName, exists: false, size: null, modifiedAt: "" };
  }

  if (directorySelection.kind === "native-path") {
    const response = await statNativeDirectoryFiles({
      directoryPath: directorySelection.directoryPath,
      fileNames: [fileName]
    });
    return Array.isArray(response?.files) && response.files[0]
      ? response.files[0]
      : { fileName, exists: false, size: null, modifiedAt: "" };
  }

  if (directorySelection.kind === "handle") {
    const [file] = await statHandleDirectoryFiles(directorySelection, [fileName]);
    return file || { fileName, exists: false, size: null, modifiedAt: "" };
  }

  return { fileName, exists: false, size: null, modifiedAt: "" };
}

async function persistDiagnosticPackage(packageData) {
  lastDiagnosticPackage = buildDiagnosticPackage(packageData);
  await saveLastDiagnosticPackage(lastDiagnosticPackage);
  return lastDiagnosticPackage;
}

async function handleExportDiagnosticPackage() {
  try {
    if (!lastDiagnosticPackage) {
      const pageContext = currentPageContext || await updatePageInfo({ syncPlatform: false });
      lastDiagnosticPackage = buildDiagnosticPackage({
        ...buildExtensionDiagnosticContext(),
        operationId: "manual.exportDiagnostic",
        logs: runtimeLogs,
        pageProbe: buildPageProbeSnapshot(pageContext),
        directorySnapshot: { accessMode: "", targetPath: currentTargetPath, files: [] },
        preflightResults: []
      });
    }

    downloadTextFile(
      `cloudpiovt-plugin-diagnostic-${buildDownloadTimestamp()}.json`,
      JSON.stringify(lastDiagnosticPackage, null, 2),
      "application/json;charset=utf-8"
    );
    setStatus("诊断 JSON 已导出，可直接发给作者定位问题。", { level: "success" });
    setExportDropdownOpen(false);
  } catch (error) {
    setStatus(`导出诊断 JSON 失败。\n${error?.message || String(error)}`, {
      level: "error",
      suggestion: "处理建议：先点击复制日志；若需要结构化诊断，请重新执行失败操作后再导出。"
    });
  }
}

// 导出下拉菜单状态（当前弹窗会话内）
let isExportDropdownOpen = false;

function setExportDropdownOpen(isOpen) {
  isExportDropdownOpen = Boolean(isOpen);
  exportDropdownMenu.hidden = !isExportDropdownOpen;
}

function toggleExportDropdown() {
  setExportDropdownOpen(!isExportDropdownOpen);
}

// 统一状态入口：既更新弹窗展示，也把同一条记录写入当前会话运行日志。
function setStatus(message, options = {}) {
  const lines = normalizeStatusLines(message);
  const level = options.level || inferStatusLevel(lines);
  const suggestion = options.suggestion || inferTroubleshooting(lines);
  const entry = {
    time: new Date().toLocaleString(),
    level,
    lines,
    suggestion,
    context: getCurrentLogContext()
  };
  runtimeLogs.push(entry);
  if (runtimeLogs.length > RUNTIME_LOG_LIMIT) {
    runtimeLogs.shift();
  }

  // 清除旧状态类
  statusOutput.classList.remove("is-success", "is-error", "is-idle");

  if (level === "success") {
    // 成功：单行绿色条
    statusOutput.classList.add("is-success");
    statusOutput.textContent = lines.join(" ") || "完成。";
  } else if (level === "error") {
    // 失败：展开红色日志区，保留 suggestion
    statusOutput.classList.add("is-error");
    statusOutput.textContent = formatLogEntry(entry);
  } else if (lines.length === 0 || (lines.length === 1 && !lines[0].trim())) {
    // 空态
    statusOutput.classList.add("is-idle");
    statusOutput.textContent = "等待操作。";
  } else {
    statusOutput.textContent = formatLogEntry(entry);
  }
}

// 复制完整运行日志用于即时沟通；失败时保留当前错误并提示改用导出文件。
async function handleCopyRuntimeLog() {
  try {
    await navigator.clipboard.writeText(buildRuntimeLogText());
    setStatus("运行日志已复制，可直接发给作者排查。", { level: "success" });
  } catch (error) {
    setStatus(`复制运行日志失败。\n${error?.message || String(error)}`, {
      level: "error",
      suggestion: "处理建议：请手动选中执行状态区域内容复制，或点击导出日志保存文件。"
    });
  }
}

// 导出 UTF-8 文本日志文件，用户可以直接把文件发给作者定位页面、目录或插件适配问题。
function handleExportRuntimeLog() {
  try {
    downloadTextFile(
      `cloudpiovt-plugin-log-${buildDownloadTimestamp()}.txt`,
      buildRuntimeLogText(),
      "text/plain;charset=utf-8"
    );
    setStatus("运行日志已导出，请将日志文件发给作者排查。", { level: "success" });
  } catch (error) {
    setStatus(`导出运行日志失败。\n${error?.message || String(error)}`, {
      level: "error",
      suggestion: "处理建议：点击复制日志，或手动复制执行状态内容发给作者。"
    });
  }
}

function normalizePlatformKey(platformKey) {
  return platformKey === PLATFORM_CONFIG.h3yun.platformKey
    ? PLATFORM_CONFIG.h3yun.platformKey
    : PLATFORM_CONFIG.cloudpivot.platformKey;
}

function getPlatformLabel(platformKey) {
  const normalizedPlatformKey = normalizePlatformKey(platformKey);
  return normalizedPlatformKey === PLATFORM_CONFIG.h3yun.platformKey
    ? PLATFORM_CONFIG.h3yun.platformLabel
    : PLATFORM_CONFIG.cloudpivot.platformLabel;
}

// 切换平台标签时只切换操作面板，页面识别仍以当前活动标签页 URL 为准。
function setActivePlatform(platformKey, options = {}) {
  activePlatformKey = normalizePlatformKey(platformKey);

  for (const button of platformTabButtons) {
    const isActive = button.dataset.platformTab === activePlatformKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }

  for (const panel of platformPanels) {
    const isActive = panel.dataset.platformPanel === activePlatformKey;
    panel.classList.toggle("platform-panel-active", isActive);
    panel.hidden = !isActive;
  }

  if (!options.silent) {
    setStatus(`${getPlatformLabel(activePlatformKey)}标签已打开。`);
  }
}

// 弹窗初始化或页面刷新后，用实际页面平台回填默认标签，减少用户误点错误平台入口。
// 平台已明确识别时隐藏标签行释放一行高度；unknown/default 时显示让用户手动选择。
function syncActivePlatformFromPage(pageTypeConfig) {
  setActivePlatform(pageTypeConfig?.platformKey, { silent: true });

  // 明确识别到具体平台（非 unknown/default）时隐藏标签行
  const pageType = pageTypeConfig?.pageType;
  const isKnownPlatform = pageType && pageType !== "default" && pageType !== "h3yun-default";
  if (isKnownPlatform) {
    platformTabsEl.classList.add("is-hidden");
  } else {
    platformTabsEl.classList.remove("is-hidden");
  }
}

function setCopyableValue(element, options) {
  const {
    fullValue,
    shortLabel,
    emptyLabel,
    copyLabel
  } = options;

  const normalizedValue = String(fullValue || "").trim();
  if (!normalizedValue) {
    element.textContent = emptyLabel;
    element.title = emptyLabel;
    element.dataset.copyValue = "";
    element.dataset.copyLabel = copyLabel;
    element.disabled = true;
    return;
  }

  element.textContent = shortLabel;
  element.title = `点击复制完整${copyLabel}\n${normalizedValue}`;
  element.dataset.copyValue = normalizedValue;
  element.dataset.copyLabel = copyLabel;
  element.disabled = false;
}

async function handleCopyValue(event) {
  const element = event.currentTarget;
  const copyValue = String(element?.dataset?.copyValue || "").trim();
  const copyLabel = String(element?.dataset?.copyLabel || "内容");
  if (!copyValue) {
    return;
  }

  try {
    await navigator.clipboard.writeText(copyValue);
    setStatus(`已复制${copyLabel}。\n${copyValue}`);
  } catch (error) {
    setStatus(`复制${copyLabel}失败。\n${error?.message || String(error)}`);
  }
}

function cleanInlineText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getDirectoryName(directoryPath) {
  const normalizedPath = String(directoryPath || "").trim();
  if (!normalizedPath) {
    return "";
  }

  return normalizedPath.split(/[\\/]/).filter(Boolean).pop() || normalizedPath;
}

/**
 * 历史目录平铺展示：前 3 条直接展示，超出部分折叠为"更多 (N个)"按钮。
 * 每条左侧圆点（当前选中高亮）+ 路径 + ✕ 移除，点击路径一键切换。
 */
async function renderHistoryFlatList(activePath = "") {
  const recentTargetDirectories = await getRecentTargetDirectories();
  historyFlatItems.replaceChildren();
  historyMoreButton.hidden = true;

  const hasHistory = recentTargetDirectories.length > 0;
  targetPathSectionEl.hidden = !hasHistory;
  historyEmptyEl.hidden = hasHistory;
  historyFlatItems.hidden = !hasHistory;

  if (!hasHistory) {
    return;
  }

  const visibleItems = isHistoryExpanded
    ? recentTargetDirectories
    : recentTargetDirectories.slice(0, HISTORY_VISIBLE_LIMIT);

  const fragment = document.createDocumentFragment();
  for (const entry of visibleItems) {
    const isCurrentPath = entry.path === activePath;
    const listItem = document.createElement("li");
    listItem.className = isCurrentPath ? "history-item is-current" : "history-item";
    listItem.title = entry.path;
    listItem.dataset.historyPath = entry.path;

    const dot = document.createElement("span");
    dot.className = "history-dot";
    dot.setAttribute("aria-hidden", "true");

    const pathSpan = document.createElement("span");
    pathSpan.className = "history-path";
    pathSpan.textContent = getDirectoryName(entry.path) || entry.path;

    const removeButton = document.createElement("button");
    removeButton.className = "history-remove";
    removeButton.type = "button";
    removeButton.textContent = "✕";
    removeButton.title = "移除此目录";
    removeButton.setAttribute("aria-label", `移除 ${getDirectoryName(entry.path) || entry.path}`);
    removeButton.dataset.removeHistoryPath = entry.path;

    listItem.append(dot, pathSpan, removeButton);
    fragment.appendChild(listItem);
  }

  historyFlatItems.appendChild(fragment);

  // 超出展示上限时显示"更多"按钮
  if (!isHistoryExpanded && recentTargetDirectories.length > HISTORY_VISIBLE_LIMIT) {
    historyMoreButton.hidden = false;
    historyMoreButton.textContent = `更多 (${recentTargetDirectories.length - HISTORY_VISIBLE_LIMIT} 个)`;
    historyMoreButton.dataset.action = "expand";
  } else if (isHistoryExpanded && recentTargetDirectories.length > HISTORY_VISIBLE_LIMIT) {
    historyMoreButton.hidden = false;
    historyMoreButton.textContent = "收起";
    historyMoreButton.dataset.action = "collapse";
  }
}

async function renderTargetPathSection(directoryPath) {
  currentTargetPath = String(directoryPath || "").trim();
  // 当前路径展示真实值（非句柄名）
  targetHandleEl.textContent = currentTargetPath || "未选择目录";
  targetHandleEl.title = currentTargetPath || "";
  await renderHistoryFlatList(currentTargetPath);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab;
}

function describeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (_error) {
    return "不可识别页面";
  }
}

function renderCurrentPageUrl(tab) {
  setCopyableValue(pageOriginEl, {
    fullValue: tab?.url || "",
    shortLabel: "复制链接",
    emptyLabel: "无法获取",
    copyLabel: "页面链接"
  });
}

async function updatePageInfo(options = {}) {
  const tab = await getActiveTab();
  renderCurrentPageUrl(tab);
  const pageTypeConfig = resolvePageTypeConfig(tab?.url || "");
  const targetScope = createTargetDirectoryPageScope(tab, pageTypeConfig.pageType);

  // 页面级快照用于固定已打开页面的目录选择；全局默认变化只影响后续新页面。
  await ensureTargetDirectorySnapshot(pageTypeConfig.pageType, targetScope);
  currentPageContext = {
    tab,
    pageType: pageTypeConfig.pageType,
    pageTypeConfig,
    targetScope
  };
  if (options.syncPlatform !== false) {
    syncActivePlatformFromPage(pageTypeConfig);
  }
  return currentPageContext;
}

function getCurrentPageContext() {
  return currentPageContext || {
    tab: null,
    pageType: "default",
    pageTypeConfig: resolvePageTypeConfig(""),
    targetScope: ""
  };
}

async function updateDirectoryInfo(pageType, targetScope = "") {
  try {
    const selection = await getStoredTargetDirectorySelection(pageType, targetScope);
    const targetPath = selection.kind === "native-path" ? selection.directoryPath : "";
    // 当前路径展示真实值（非句柄名）
    targetHandleEl.textContent = targetPath || "未选择目录";
    targetHandleEl.title = targetPath || "";
    // 每次选择/更新目录即时落库到历史
    if (targetPath) {
      await addRecentTargetDirectory(targetPath, pageType);
    }
    await renderTargetPathSection(targetPath);
    return true;
  } catch (error) {
    currentTargetPath = "";
    targetHandleEl.textContent = "读取失败";
    targetHandleEl.title = "读取失败";
    targetPathSectionEl.hidden = true;
    historyEmptyEl.hidden = false;
    historyFlatItems.hidden = true;
    historyFlatItems.replaceChildren();
    historyMoreButton.hidden = true;
    setStatus(`读取目标目录失败。
${error?.message || String(error)}`);
    return false;
  }
}

// 抓取和回写始终使用当前页面快照，避免旧页面被全局默认目录变化影响。
async function ensureDirectoryAccessForOperation(pageType, mode, targetScope) {
  return ensureTargetDirectorySelection(pageType, mode, targetScope);
}

// 打开编辑器必须拿到 Native Host 绝对路径，只有句柄快照时返回空值并触发重新选择。
async function resolveLaunchTargetPath(pageType, targetScope) {
  const selection = await getStoredTargetDirectorySelection(pageType, targetScope);
  if (selection.kind === "native-path" && selection.directoryPath) {
    return selection.directoryPath;
  }

  return "";
}

async function ensureLaunchTargetPath(pageType, targetScope) {
  const existingPath = await resolveLaunchTargetPath(pageType, targetScope);
  if (existingPath) {
    return existingPath;
  }

  const initialPath = await getStoredDirectoryPath(pageType, targetScope);
  const response = await pickNativeDirectory(initialPath);
  if (!response?.ok) {
    if (response?.cancelled) {
      const error = new Error("已取消选择目标目录。");
      error.name = "AbortError";
      throw error;
    }
    throw new Error(response?.error || "选择目标目录失败。");
  }

  const directoryPath = String(response.directoryPath || "").trim();
  if (!directoryPath) {
    throw new Error("原生助手未返回目标目录绝对路径。");
  }

  await saveNativeTargetDirectorySelection(pageType, directoryPath, targetScope);
  await updateDirectoryInfo(pageType, targetScope);
  return directoryPath;
}

async function refreshDirectoryHandle(pageType, targetScope) {
  // 刷新按钮应优先从弹窗正在展示的当前路径打开系统目录选择框，避免用户被带到未知默认目录。
  const selection = await refreshTargetDirectorySelection(pageType, targetScope, currentTargetPath);
  await updateDirectoryInfo(pageType, targetScope);
  return {
    handleLabel:
      selection.kind === "handle"
        ? (selection.label || "未选择目录")
        : getDirectoryName(selection.directoryPath),
    directoryPath: selection.kind === "native-path" ? selection.directoryPath : ""
  };
}

async function handleRefreshDirectoryHandle() {
  setBusy(true);
  setStatus("正在更新当前路径...");

  try {
    const { pageType, targetScope } = await updatePageInfo();
    const nativePreflight = await runNativeHostPreflight(PREFLIGHT_OPERATION_IDS.directoryRefresh);
    if (hasBlockingPreflightResult(nativePreflight.results) && supportsDirectoryPicker()) {
      nativePreflight.results = [
        createPreflightWarning(
          PREFLIGHT_OPERATION_IDS.directoryRefresh,
          "nativeHost.ping",
          "NATIVE_HOST_UNAVAILABLE_BROWSER_PICKER_AVAILABLE",
          nativePreflight.hostStatus.error || "native host unavailable, browser directory picker available",
          "继续使用浏览器目录选择器；绝对路径历史和一键打开编辑器仍需原生助手。",
          nativePreflight.hostStatus
        )
      ];
    }
    setStatus([
      "自动预检完成。",
      `operationId=${PREFLIGHT_OPERATION_IDS.directoryRefresh}`,
      ...formatPreflightStatusLines(nativePreflight.results)
    ]);
    await persistDiagnosticPackage({
      ...buildExtensionDiagnosticContext(),
      operationId: PREFLIGHT_OPERATION_IDS.directoryRefresh,
      logs: runtimeLogs,
      pageProbe: buildPageProbeSnapshot(currentPageContext),
      directorySnapshot: { accessMode: "", targetPath: currentTargetPath, files: [] },
      preflightResults: nativePreflight.results,
      nativeHost: nativePreflight.hostStatus
    });
    if (hasBlockingPreflightResult(nativePreflight.results)) {
      return;
    }
    const selection = await refreshDirectoryHandle(pageType, targetScope);
    setStatus([
      "当前路径已更新。",
      `当前路径：${selection.handleLabel || "未选择目录"}`,
      `绝对路径：${selection.directoryPath || "未选择目录"}`
    ]);
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("已取消更新当前路径。");
      return;
    }
    setStatus(`更新当前路径失败。
${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

// 复制当前路径到剪贴板
async function handleCopyTargetPath() {
  if (isPopupBusy) {
    return;
  }
  try {
    await navigator.clipboard.writeText(currentTargetPath);
    setStatus(`已复制路径。\n${currentTargetPath}`, { level: "success" });
  } catch (error) {
    setStatus(`复制路径失败。\n${error?.message || String(error)}`);
  }
}

// 历史目录展开/收起
function handleHistoryMoreClick() {
  isHistoryExpanded = !isHistoryExpanded;
  renderHistoryFlatList(currentTargetPath);
}

/**
 * 点击历史目录时直接复用 Native 路径保存流程，避免分叉出另一套目录状态更新逻辑。
 * 每次选择/更新目录即时落库到 addRecentTargetDirectory。
 */
async function handleUseHistoryPath(directoryPath) {
  const normalizedPath = String(directoryPath || "").trim();
  if (!normalizedPath || isPopupBusy) {
    return;
  }

  setBusy(true);
  setStatus("正在切换历史目录...");

  try {
    const { pageType, targetScope } = await updatePageInfo();
    const selection = await getStoredTargetDirectorySelection(pageType, targetScope);
    const activePath = selection.kind === "native-path" ? selection.directoryPath : "";

    if (activePath === normalizedPath) {
      setStatus([
        "当前路径已在使用。",
        `当前路径：${normalizedPath}`
      ]);
      return;
    }

    await saveNativeTargetDirectorySelection(pageType, normalizedPath, targetScope);
    await updateDirectoryInfo(pageType, targetScope);
    setStatus([
      "已切换到历史目录。",
      `当前路径：${normalizedPath}`
    ]);
  } catch (error) {
    setStatus(`切换历史目录失败。\n${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

async function handleRemoveHistoryPath(directoryPath) {
  const normalizedPath = String(directoryPath || "").trim();
  if (!normalizedPath || isPopupBusy) {
    return;
  }

  setBusy(true);
  setStatus("正在移除历史目录...");

  try {
    // 删除历史记录只影响快捷入口，不能反向清空当前页面已经绑定的目录状态。
    await removeRecentTargetDirectory(normalizedPath);
    const pageContext = currentPageContext || await updatePageInfo();
    await updateDirectoryInfo(pageContext.pageType, pageContext.targetScope);
    setStatus([
      "已移除历史目录。",
      "当前路径绑定保持不变。",
      normalizedPath
    ]);
  } catch (error) {
    setStatus(`移除历史目录失败。\n${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

// 历史目录平铺列表点击处理：切换路径 / 移除路径
async function handleHistoryFlatListClick(event) {
  const removeButton = event.target.closest("[data-remove-history-path]");
  if (removeButton) {
    event.preventDefault();
    event.stopPropagation();
    await runWithButtonBusy(removeButton, () => handleRemoveHistoryPath(removeButton.dataset.removeHistoryPath));
    return;
  }

  const historyItem = event.target.closest("[data-history-path]");
  if (historyItem) {
    event.preventDefault();
    await runWithButtonBusy(historyItem, () => handleUseHistoryPath(historyItem.dataset.historyPath));
  }
}

function findLauncherById(launcherId) {
  return currentLaunchers.find((launcher) => launcher.launcherId === launcherId) || null;
}

function createLauncherPreflightResult(operationId, launcher) {
  if (!launcher) {
    return createPreflightResult({
      operationId,
      checkId: "launcher.selection",
      severity: PREFLIGHT_SEVERITY.blocker,
      ok: false,
      errorCode: "NO_AVAILABLE_LAUNCHER",
      evidence: "No enabled launcher with executablePath",
      nextAction: "打开设置页，在\"打开方式\"中启用并配置至少一个软件路径。"
    });
  }

  return createPreflightResult({
    operationId,
    checkId: "launcher.selection",
    severity: launcher.executablePath ? PREFLIGHT_SEVERITY.info : PREFLIGHT_SEVERITY.blocker,
    ok: Boolean(launcher.executablePath),
    errorCode: launcher.executablePath ? "" : "LAUNCHER_PATH_MISSING",
    evidence: `launcherId=${launcher.launcherId} | iconKey=${launcher.iconKey} | executablePath=${launcher.executablePath || ""} | argumentsTemplate=${launcher.argumentsTemplate || ""}`,
    nextAction: launcher.executablePath ? "" : "打开设置页为该打开方式配置应用路径。",
    data: {
      launcherId: launcher.launcherId,
      iconKey: launcher.iconKey,
      name: launcher.name,
      executablePath: launcher.executablePath,
      argumentsTemplate: launcher.argumentsTemplate
    }
  });
}

async function handleOpenCustomLauncher(launcherId = "") {
  setBusy(true);
  let launcher = null;
  let launcherLabel = "打开方式";
  setStatus(`正在打开 ${launcherLabel}...`);

  try {
    const config = await loadConfig();
    renderLauncherControls(config);
    launcher = launcherId ? findLauncherById(launcherId) : selectDefaultLauncher(currentLaunchers);
    launcherLabel = launcher?.name || "打开方式";
    setStatus(`正在打开 ${launcherLabel}...`);

    await runOperationWithPreflight(
      PREFLIGHT_OPERATION_IDS.nativeOpenCustomLauncher,
      async ({ pageContext }) => {
        const { pageType, targetScope } = pageContext;
        if (!launcher?.executablePath) {
          throw new Error("请先在设置页配置可用打开方式。");
        }

        const targetPath = await ensureLaunchTargetPath(pageType, targetScope);

        const response = await launchNativeEditor({
          executablePath: launcher.executablePath,
          argumentsTemplate: launcher.argumentsTemplate,
          targetPath
        });

        if (!response?.ok) {
          throw new Error(response?.error || `打开 ${launcher.name} 失败。`);
        }

        setStatus([
          `${launcher.name} 已打开目标目录。`,
          `页面类型：${getCurrentPageContext().pageTypeConfig.pageLabel}`,
          `目标目录：${targetPath}`,
          `launcherId：${launcher.launcherId}`,
          `iconKey：${launcher.iconKey}`,
          `可执行文件：${launcher.executablePath}`,
          `参数模板：${launcher.argumentsTemplate || "{rawPath}"}`
        ]);
      },
      {
        requireNativeHost: true,
        skipExecutableContextCheck: true,
        collectExtraResults: async ({ operationId }) => [
          createLauncherPreflightResult(operationId, launcher)
        ]
      }
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus(`已取消打开 ${launcherLabel}。`);
      return;
    }
    setStatus(`打开 ${launcherLabel} 失败。\n${error?.message || String(error)}`);
  } finally {
    setLauncherMenuOpen(false);
    setBusy(false);
  }
}

async function writeTextToFile(handle, payload) {
  const writable = await handle.createWritable();
  await writable.write(payload);
  await writable.close();
}

async function readTextFromFile(handle) {
  const file = await handle.getFile();
  return file.text();
}

function normalizeExcessBlankLines(content) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n(?:[ \t]*\n){2,}/g, "\n\n");
}

function getExecutableContextError(tab) {
  if (!tab?.id || !tab.url) {
    return "未找到当前活动标签页。";
  }
  if (!/^https?:/i.test(tab.url)) {
    return "当前标签页不是普通网页，无法注入脚本。";
  }
  return "";
}

function getOriginError(tabUrl) {
  if (!isOriginAllowed(tabUrl, DEFAULT_ALLOWED_ORIGINS)) {
    return `当前页面 origin 不在允许列表中：${describeOrigin(tabUrl)}`;
  }
  return "";
}

function assertCloudpivotOperation(pageContext, actionLabel) {
  const platformKey = pageContext?.pageTypeConfig?.platformKey;
  if (platformKey === PLATFORM_CONFIG.cloudpivot.platformKey) {
    return;
  }

  // 云枢抓取依赖页面内的 data.codes 和 Monaco 业务规则模型，氚云结构未确认前不能复用这套写入逻辑。
  const platformLabel = pageContext?.pageTypeConfig?.platformLabel || getPlatformLabel(platformKey);
  throw new Error(`${actionLabel}仅支持云枢页面。当前识别为${platformLabel}，请使用氚云标签的页面探测。`);
}

function buildCodeExportPlan(data, pageTypeConfig) {
  const codes = data?.codes;
  if (!codes || typeof codes !== "object" || Array.isArray(codes)) {
    return {
      ok: false,
      errorCode: "NO_CODES_OBJECT",
      details: "目标组件的$data 中未找到有效的 data.codes 对象。"
    };
  }

  const filesToWrite = [];
  const skippedKeys = [];

  for (const { key, fileName } of pageTypeConfig.fileMappings) {
    const value = codes[key];
    if (typeof value !== "string" || value.length === 0) {
      skippedKeys.push(key);
      continue;
    }

    filesToWrite.push({
      key,
      fileName,
      content: value
    });
  }

  if (!filesToWrite.length) {
    return {
      ok: false,
      errorCode: "NO_EXPORTABLE_CODE_FILES",
      details: "data.codes 中没有可导出的 javascript、html、css 文本内容。",
      skippedKeys
    };
  }

  return {
    ok: true,
    filesToWrite,
    skippedKeys
  };
}

async function writeCodeFilesToDirectory(directorySelection, filesToWrite) {
  await writeFilesToSelection(directorySelection, filesToWrite);
}

async function readCodeFilesFromDirectory(directorySelection, pageTypeConfig) {
  const filesToImport = [];
  const skippedKeys = [];
  let readResults;

  try {
    readResults = await readFilesFromSelection(
      directorySelection,
      pageTypeConfig.fileMappings.map((item) => item.fileName)
    );
  } catch (error) {
    return {
      ok: false,
      errorCode: "DIRECTORY_READ_FAILED",
      details: error?.message || String(error)
    };
  }

  const resultMap = new Map(
    readResults.map((item) => [
      item.fileName,
      {
        exists: Boolean(item?.exists),
        content: String(item?.content ?? "")
      }
    ])
  );

  for (const { key, fileName } of pageTypeConfig.fileMappings) {
    const fileResult = resultMap.get(fileName);
    if (!fileResult?.exists) {
      skippedKeys.push(key);
      continue;
    }

    filesToImport.push({
      key,
      fileName,
      content: normalizeExcessBlankLines(fileResult.content)
    });
  }

  if (!filesToImport.length) {
    return {
      ok: false,
      errorCode: "NO_IMPORTABLE_CODE_FILES",
      details: `${pageTypeConfig.pageLabel} 对应的默认文件不存在`,
      skippedKeys
    };
  }

  return {
    ok: true,
    filesToImport,
    skippedKeys
  };
}

async function fileExists(directorySelection, fileName) {
  return fileExistsInSelection(directorySelection, fileName);
}

async function anyFileExists(directorySelection, fileNames) {
  // 协作文件改为标准大小写后仍兼容旧文件名，避免用户已有 README.MD / design.md 被重复创建。
  for (const fileName of fileNames) {
    if (await fileExists(directorySelection, fileName)) {
      return true;
    }
  }
  return false;
}

async function getWorkspaceDocumentState(directorySelection) {
  // 三个协作入口均为人工维护文件，抓取时只补缺失项，不能覆盖已有业务需求或设计说明。
  return {
    hasReadme: await anyFileExists(directorySelection, WORKSPACE_README_FILE_NAMES),
    hasAgents: await fileExists(directorySelection, WORKSPACE_DOCUMENT_FILE_NAMES.agents),
    hasDesign: await anyFileExists(directorySelection, WORKSPACE_DESIGN_FILE_NAMES)
  };
}

async function readOptionalDirectoryFile(directorySelection, fileName) {
  try {
    const [fileResult] = await readFilesFromSelection(directorySelection, [fileName]);
    return fileResult?.exists ? String(fileResult.content || "") : "";
  } catch {
    // 旧文档读取失败时只放弃保留逻辑，不能反过来让本次抓取写入整体失败。
    return "";
  }
}

async function readBizRuleFileFromDirectory(directorySelection, fileName) {
  let readResults;

  try {
    readResults = await readFilesFromSelection(directorySelection, [fileName]);
  } catch (error) {
    return {
      ok: false,
      errorCode: "DIRECTORY_READ_FAILED",
      details: error?.message || String(error)
    };
  }

  const fileResult = Array.isArray(readResults) ? readResults[0] : null;
  if (!fileResult?.exists) {
    return {
      ok: false,
      errorCode: "BIZRULE_FILE_NOT_FOUND",
      details: buildBizRuleMissingFileDetails(fileName)
    };
  }

  return {
    ok: true,
    fileName,
    content: normalizeExcessBlankLines(fileResult.content)
  };
}

async function writeReadmeFile(directorySelection, metadata, pageTypeConfig, pageUrl, options = {}) {
  const existingFromCodeContent = await readOptionalDirectoryFile(directorySelection, "FromCode.md");
  const filesToWrite = buildReadmeWriteFiles(metadata, pageTypeConfig, pageUrl, {
    ...options,
    existingFromCodeContent
  });
  await writeFilesToSelection(directorySelection, filesToWrite);
}

/**
 * 补写缺失的协作文件。
 * @param {object} options - { generatedFiles, extraDocs } 门控选项
 */
async function writeMissingWorkspaceDocumentFiles(directorySelection, documentInput, workspaceDocumentState, options = {}) {
  // 业务规则或氚云局部抓取没有统一 FromCode 入口时，仍要补齐 AI 协作文件，已有人工内容保持不覆盖。
  const filesToWrite = buildMissingWorkspaceDocumentFiles(documentInput, workspaceDocumentState, options);
  if (!filesToWrite.length) {
    return [];
  }

  await writeFilesToSelection(directorySelection, filesToWrite);
  return filesToWrite;
}

function buildCloudpivotBizRuleWorkspaceDocumentInput(pageTypeConfig, pageUrl, fileName = "") {
  // 云枢业务规则目录需要写明 JS 只能通过业务规则传参协作，避免后续 AI 误生成 Ajax 方案。
  return {
    platformKey: PLATFORM_CONFIG.cloudpivot.platformKey,
    platformLabel: PLATFORM_CONFIG.cloudpivot.platformLabel,
    pageLabel: pageTypeConfig?.pageLabel || "业务规则开发",
    pageUrl,
    codeFiles: [fileName || "业务规则 .java 文件"]
  };
}

function describeDirectoryAccessMode(directorySelection) {
  return directorySelection.kind === "native-path"
    ? "Native Host"
    : "File System Access API";
}

function createPreflightInfo(operationId, checkId, evidence, data = {}) {
  return createPreflightResult({
    operationId,
    checkId,
    severity: PREFLIGHT_SEVERITY.info,
    ok: true,
    evidence,
    data
  });
}

function createPreflightBlocker(operationId, checkId, errorCode, evidence, nextAction, data = {}) {
  return createPreflightResult({
    operationId,
    checkId,
    severity: PREFLIGHT_SEVERITY.blocker,
    ok: false,
    errorCode,
    evidence,
    nextAction,
    data
  });
}

function createPreflightWarning(operationId, checkId, errorCode, evidence, nextAction, data = {}) {
  return createPreflightResult({
    operationId,
    checkId,
    severity: PREFLIGHT_SEVERITY.warning,
    ok: false,
    errorCode,
    evidence,
    nextAction,
    data
  });
}

async function runDirectoryPreflight(operationId, pageType, targetScope, mode) {
  try {
    const directorySelection = await ensureDirectoryAccessForOperation(pageType, mode, targetScope);
    return {
      directorySelection,
      results: [
        createPreflightInfo(operationId, `directory.${mode}`, "target directory access granted", {
          accessMode: describeDirectoryAccessMode(directorySelection),
          targetPath: directorySelection.kind === "native-path" ? directorySelection.directoryPath : ""
        })
      ]
    };
  } catch (error) {
    return {
      directorySelection: null,
      results: [
        createPreflightBlocker(
          operationId,
          `directory.${mode}`,
          "DIRECTORY_ACCESS_FAILED",
          error?.message || String(error),
          "重新选择当前路径并确认目录权限。"
        )
      ]
    };
  }
}

async function collectCloudpivotImportFilePreflight({ pageContext, directorySelection, operationId }) {
  if (!directorySelection) {
    return [];
  }

  const fileNames = Array.isArray(pageContext.pageTypeConfig?.fileMappings)
    ? pageContext.pageTypeConfig.fileMappings.map((item) => item.fileName)
    : [];
  if (!fileNames.length) {
    return [
      createPreflightBlocker(
        operationId,
        "directory.importFiles",
        "NO_CONFIGURED_IMPORT_FILES",
        "pageType has no fileMappings",
        "检查页面类型识别是否正确。"
      )
    ];
  }

  try {
    const readResults = await readFilesFromSelection(directorySelection, fileNames);
    const existingFiles = readResults.filter((item) => item?.exists).map((item) => item.fileName);
    if (!existingFiles.length) {
      return [
        createPreflightBlocker(
          operationId,
          "directory.importFiles",
          "NO_IMPORTABLE_CODE_FILES",
          `missing=${fileNames.join(",")}`,
          "先执行抓取写入，或确认当前路径中存在对应代码文件。",
          { expectedFiles: fileNames }
        )
      ];
    }

    const metadataResults = await Promise.all(
      existingFiles.map((fileName) => statSingleDirectoryFile(directorySelection, fileName))
    );
    return [
      createPreflightInfo(operationId, "directory.importFiles", `existing=${existingFiles.join(",")}`, {
        expectedFiles: fileNames,
        existingFiles
      }),
      ...metadataResults.map((file) => createWritebackRiskResult({
        operationId,
        checkId: "writeback.localFileRisk",
        fileName: file.fileName,
        size: file.size,
        modifiedAt: file.modifiedAt
      }))
    ];
  } catch (error) {
    return [
      createPreflightBlocker(
        operationId,
        "directory.importFiles",
        "IMPORT_FILE_PREFLIGHT_FAILED",
        error?.message || String(error),
        "确认当前路径可读，并重新执行回写。"
      )
    ];
  }
}

function collectH3yunLazyLoadWarning({ operationId }) {
  return [
    createPreflightWarning(
      operationId,
      "h3yun.lazyLoad",
      "H3YUN_PARTIAL_MOUNT_ALLOWED",
      "h3yun designer may lazy-load graph/js/cs areas",
      "若一键抓取只写入部分文件，请切到对应区域加载后重试。"
    )
  ];
}

function runPageContextPreflight(operationId, pageContext, expectedPlatformKey = "", skipExecutableContextCheck = false) {
  const { tab, pageTypeConfig } = pageContext;
  const results = [
    createPreflightInfo(operationId, "page.context", "page context resolved", {
      pageType: pageContext.pageType,
      platformKey: pageTypeConfig?.platformKey,
      url: tab?.url || ""
    })
  ];
  // 打开外部程序（如资源管理器）不需要向页面注入脚本，允许在扩展页执行。
  if (!skipExecutableContextCheck) {
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      results.push(createPreflightBlocker(
        operationId,
        "page.executableContext",
        "PAGE_NOT_SCRIPTABLE",
        executableContextError,
        "切换到云枢或氚云业务页面后重试。"
      ));
    }
  }

  if (expectedPlatformKey && pageTypeConfig?.platformKey !== expectedPlatformKey) {
    results.push(createPreflightBlocker(
      operationId,
      "page.platform",
      "PLATFORM_MISMATCH",
      `expected=${expectedPlatformKey}, actual=${pageTypeConfig?.platformKey || "unknown"}`,
      "切换到匹配平台页面或弹窗标签后重试。"
    ));
  }

  return results;
}

async function runNativeHostPreflight(operationId) {
  const hostStatus = await probeNativeHost();
  if (hostStatus.available) {
    return {
      hostStatus,
      results: [
        createPreflightInfo(operationId, "nativeHost.ping", "native host available", hostStatus)
      ]
    };
  }

  return {
    hostStatus,
    results: [
      createPreflightBlocker(
        operationId,
        "nativeHost.ping",
        "NATIVE_HOST_UNAVAILABLE",
        hostStatus.error || "native host unavailable",
        "重新运行 scripts\\install-native-host.cmd 后重试。",
        hostStatus
      )
    ]
  };
}

function buildPreflightStatusMessage(operationId, results) {
  const blocked = hasBlockingPreflightResult(results);
  return [
    blocked ? "自动预检阻断操作。" : "自动预检完成。",
    `operationId=${operationId}`,
    ...formatPreflightStatusLines(results)
  ];
}

async function runOperationWithPreflight(operationId, task, options = {}) {
  const pageContext = await updatePageInfo({ syncPlatform: options.syncPlatform !== false });
  const results = [
    ...runPageContextPreflight(operationId, pageContext, options.expectedPlatformKey || "", options.skipExecutableContextCheck)
  ];
  let directorySelection = null;
  let hostStatus = null;

  if (options.requireNativeHost) {
    const nativePreflight = await runNativeHostPreflight(operationId);
    hostStatus = nativePreflight.hostStatus;
    results.push(...nativePreflight.results);
  }

  if (options.directoryMode) {
    const directoryPreflight = await runDirectoryPreflight(
      operationId,
      pageContext.pageType,
      pageContext.targetScope,
      options.directoryMode
    );
    directorySelection = directoryPreflight.directorySelection;
    results.push(...directoryPreflight.results);
  }

  if (typeof options.collectExtraResults === "function") {
    results.push(...await options.collectExtraResults({ pageContext, directorySelection, operationId }));
  }

  setStatus(buildPreflightStatusMessage(operationId, results), {
    level: hasBlockingPreflightResult(results) ? "error" : "info",
    suggestion: hasBlockingPreflightResult(results)
      ? "nextAction 字段已给出阻断原因和下一步处理。"
      : "预检未发现 blocker，继续执行操作。"
  });

  const directorySnapshot = await buildDirectorySnapshotForDiagnostics(
    directorySelection,
    pageContext.pageTypeConfig
  );
  await persistDiagnosticPackage({
    ...buildExtensionDiagnosticContext(),
    operationId,
    logs: runtimeLogs,
    pageProbe: buildPageProbeSnapshot(pageContext),
    directorySnapshot,
    preflightResults: results,
    nativeHost: hostStatus || {}
  });

  if (hasBlockingPreflightResult(results)) {
    return { ok: false, pageContext, directorySelection, preflightResults: results };
  }

  return task({
    pageContext,
    directorySelection,
    preflightResults: results
  });
}

async function appendWritebackRiskDiagnostic(operationId, pageContext, directorySelection, fileName, preflightResults = []) {
  const file = await statSingleDirectoryFile(directorySelection, fileName);
  const riskResult = createWritebackRiskResult({
    operationId,
    fileName: file.fileName || fileName,
    size: file.size,
    modifiedAt: file.modifiedAt
  });
  const nextResults = [...preflightResults, riskResult];
  setStatus([
    "回写风险提示。",
    `operationId=${operationId}`,
    formatPreflightStatusLines([riskResult]).join("\n")
  ]);
  await persistDiagnosticPackage({
    ...buildExtensionDiagnosticContext(),
    operationId,
    logs: runtimeLogs,
    pageProbe: buildPageProbeSnapshot(pageContext),
    directorySnapshot: await buildDirectorySnapshotForDiagnostics(directorySelection, pageContext.pageTypeConfig),
    preflightResults: nextResults
  });
  return nextResults;
}

/**
 * 云枢前端抓取写入。
 * @param {object} extraDocs - 文件选择器一次性额外生成的协作文件，不回写持久配置
 */
async function handleCaptureAndWrite(extraDocs = {}) {
  setBusy(true);
  setStatus("正在抓取并写入...");

  try {
    await runOperationWithPreflight(
      PREFLIGHT_OPERATION_IDS.cloudpivotFrontendCapture,
      async ({ pageContext, directorySelection }) => {
    const { tab, pageType, pageTypeConfig, targetScope } = pageContext;
    assertCloudpivotOperation(pageContext, "前端抓取写入");
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      throw new Error(executableContextError);
    }

    const originError = getOriginError(tab.url);
    if (originError) {
      throw new Error(originError);
    }

    const platformKey = PLATFORM_CONFIG.cloudpivot.platformKey;
    const generatedFiles = (currentConfig?.generatedFiles || {})[platformKey] || {};
    const workspaceDocumentState = await getWorkspaceDocumentState(directorySelection);

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: pageCaptureMain,
      args: [
        {
          candidateComponentNames: [pageTypeConfig.componentName],
          selectionStrategy: DEFAULT_SELECTION_STRATEGY
        }
      ]
    });

    if (!result?.ok) {
      setStatus(`抓取失败。
${result?.details || result?.errorCode || "未知错误"}`, {
        level: "error",
        suggestion: "处理建议：确认当前云枢页面已完全加载在线开发编辑器；若页面结构已变化，请导出日志联系作者适配插件。"
      });
      return;
    }

    const exportPlan = buildCodeExportPlan(result.data, pageTypeConfig);
    if (!exportPlan.ok) {
      setStatus(`写入失败。
${exportPlan.details || exportPlan.errorCode || "未知错误"}`, {
        level: "error",
        suggestion: "处理建议：页面未返回可导出的 HTML/CSS/JS 内容，请确认编辑器已加载；若确认页面正常，请导出日志联系作者。"
      });
      return;
    }

    await writeCodeFilesToDirectory(directorySelection, exportPlan.filesToWrite);
    const exportedHtml = exportPlan.filesToWrite.find((item) => item.key === "html")?.content || "";
    const readmeMetadata = extractReadmeMetadataFromHtml(exportedHtml, result.pageUrl || tab.url);
    await writeReadmeFile(directorySelection, readmeMetadata, pageTypeConfig, result.pageUrl || tab.url, {
      ...workspaceDocumentState,
      generatedFiles,
      extraDocs
    });
    await updateDirectoryInfo(pageType, targetScope);

    setStatus([
      "抓取并写入成功。",
      `页面类型：${pageTypeConfig.pageLabel}`,
      `目录访问：${describeDirectoryAccessMode(directorySelection)}`,
      `代码文件：${exportPlan.filesToWrite.map((item) => item.fileName).join("、")}`,
      workspaceDocumentState.hasReadme ? "README.md 已保留现有内容。" : "README.md 已新建。",
      workspaceDocumentState.hasAgents ? "AGENTS.md 已保留现有内容。" : "AGENTS.md 已新建。",
      workspaceDocumentState.hasDesign ? "DESIGN.md 已保留现有内容。" : "DESIGN.md 已新建。",
      "FromCode.md 已同步编码信息。",
    ]);
      },
      {
        expectedPlatformKey: PLATFORM_CONFIG.cloudpivot.platformKey,
        directoryMode: "readwrite"
      }
    );
  } catch (error) {
    setStatus(`抓取并写入失败。
${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

async function handleImportAndWriteBack() {
  setBusy(true);
  setStatus("正在从文件夹回写...");

  try {
    await runOperationWithPreflight(
      PREFLIGHT_OPERATION_IDS.cloudpivotFrontendWriteback,
      async ({ pageContext, directorySelection, preflightResults }) => {
    const { tab, pageType, pageTypeConfig, targetScope } = pageContext;
    assertCloudpivotOperation(pageContext, "前端回写");
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      throw new Error(executableContextError);
    }

    const originError = getOriginError(tab.url);
    if (originError) {
      throw new Error(originError);
    }

    const importPlan = await readCodeFilesFromDirectory(directorySelection, pageTypeConfig);
    if (!importPlan.ok) {
      setStatus(`回写失败。
${importPlan.details || importPlan.errorCode || "未知错误"}`, {
        level: "error",
        suggestion: "处理建议：确认当前路径中存在该页面类型对应的本地代码文件，再重新回写。"
      });
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: pageWritebackMain,
      args: [
        {
          candidateComponentNames: [pageTypeConfig.componentName],
          selectionStrategy: DEFAULT_SELECTION_STRATEGY,
          codeEntries: importPlan.filesToImport,
          skippedKeys: importPlan.skippedKeys
        }
      ]
    });

    if (!result?.ok) {
      setStatus(`回写失败。
${result?.details || result?.errorCode || "未知错误"}`, {
        level: "error",
        suggestion: "处理建议：确认在线编辑器可编辑且页面未刷新；若页面正常但仍失败，请导出日志联系作者适配回写逻辑。"
      });
      return;
    }

    await updateDirectoryInfo(pageType, targetScope);
    setStatus([
      "从文件夹回写成功。",
      `页面类型：${pageTypeConfig.pageLabel}`,
      `目录访问：${describeDirectoryAccessMode(directorySelection)}`,
      `回写字段：${result.updatedKeys.join("、") || "无"}`,
      result.compatibilityState?.shimmed
        ? `兼容处理：webIDEService.updateDataSource -> ${result.compatibilityState.fallbackMethod}`
        : "兼容处理：未注入 webIDEService 兜底",
    ]);
      },
      {
        expectedPlatformKey: PLATFORM_CONFIG.cloudpivot.platformKey,
        directoryMode: "read",
        collectExtraResults: collectCloudpivotImportFilePreflight
      }
    );
  } catch (error) {
    setStatus(`从文件夹回写失败。
${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

/**
 * 云枢业务规则抓取写入。
 * @param {object} extraDocs - 文件选择器一次性额外生成的协作文件
 */
async function handleBizruleCaptureAndWrite(extraDocs = {}) {
  setBusy(true);
  setStatus("正在抓取业务规则并写入...");

  try {
    await runOperationWithPreflight(
      PREFLIGHT_OPERATION_IDS.cloudpivotBizruleCapture,
      async ({ pageContext, directorySelection, preflightResults }) => {
    const { tab, pageType, targetScope } = pageContext;
    assertCloudpivotOperation(pageContext, "业务规则抓取写入");
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      throw new Error(executableContextError);
    }

    const originError = getOriginError(tab.url);
    if (originError) {
      throw new Error(originError);
    }

    const platformKey = PLATFORM_CONFIG.cloudpivot.platformKey;
    const generatedFiles = (currentConfig?.generatedFiles || {})[platformKey] || {};

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: bizRuleProbeMain,
      args: [{ multiModelHint: BIZ_RULE_USAGE_NOTICE }]
    });

    if (!result?.ok) {
      setStatus([
        "业务规则抓取失败。",
        `错误码：${result?.errorCode || "UNKNOWN_ERROR"}`,
        ...(Array.isArray(result?.details) ? result.details : [result?.details || "未返回更多诊断信息"])
      ]);
      return;
    }

    if (!result.sourceContent) {
      setStatus("业务规则抓取失败。\n页面已找到 Monaco model，但源代码内容为空。");
      return;
    }

    if (!result.fileName) {
      setStatus("业务规则抓取失败。\n已读取源代码，但未能解析输出文件名。");
      return;
    }

    const hadTargetFile = await fileExists(directorySelection, result.fileName);
    const workspaceDocumentState = await getWorkspaceDocumentState(directorySelection);
    await writeFilesToSelection(directorySelection, [
      {
        fileName: result.fileName,
        content: result.sourceContent
      }
    ]);
    const workspaceFiles = await writeMissingWorkspaceDocumentFiles(
      directorySelection,
      buildCloudpivotBizRuleWorkspaceDocumentInput(pageContext.pageTypeConfig, tab.url, result.fileName),
      workspaceDocumentState,
      { generatedFiles, extraDocs }
    );
    await updateDirectoryInfo(pageType, targetScope);

    setStatus([
      "业务规则抓取写入成功。",
      `目录访问：${describeDirectoryAccessMode(directorySelection)}`,
      `文件名：${result.fileName}`,
      `类名：${result.className || "未解析"}`,
      `语言：${result.language || "未知"}`,
      `URI：${result.uri || "空"}`,
      `源代码长度：${result.sourceLength}`,
      hadTargetFile ? "目标文件已更新。" : "目标文件已新建。",
      workspaceFiles.length ? `协作文件已补齐：${workspaceFiles.map((item) => item.fileName).join("、")}` : "协作文件已保留现有内容。",
      `诊断：${(result.details || []).join(" | ") || "无"}`
    ]);
      },
      {
        expectedPlatformKey: PLATFORM_CONFIG.cloudpivot.platformKey,
        directoryMode: "readwrite"
      }
    );
  } catch (error) {
    setStatus(`业务规则抓取写入失败。
${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

function handleBizruleWriteback() {
  return handleBizruleWritebackInternal();
}

async function handleBizruleWritebackInternal() {
  setBusy(true);
  setStatus("正在回写业务规则到页面编辑器...");

  try {
    await runOperationWithPreflight(
      PREFLIGHT_OPERATION_IDS.cloudpivotBizruleWriteback,
      async ({ pageContext, directorySelection, preflightResults }) => {
    const { tab, pageType, targetScope } = pageContext;
    assertCloudpivotOperation(pageContext, "业务规则回写");
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      throw new Error(executableContextError);
    }

    const originError = getOriginError(tab.url);
    if (originError) {
      throw new Error(originError);
    }

    const [{ result: probeResult }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: bizRuleProbeMain,
      args: [{ multiModelHint: BIZ_RULE_USAGE_NOTICE }]
    });

    if (!probeResult?.ok) {
      setStatus([
        "业务规则回写失败。",
        `错误码：${probeResult?.errorCode || "UNKNOWN_ERROR"}`,
        ...(Array.isArray(probeResult?.details) ? probeResult.details : [probeResult?.details || "未返回更多诊断信息"])
      ]);
      return;
    }

    if (!probeResult.fileName) {
      setStatus("业务规则回写失败。\n当前页面未解析到业务规则文件名。");
      return;
    }

    const importResult = await readBizRuleFileFromDirectory(directorySelection, probeResult.fileName);
    if (!importResult.ok) {
      setStatus([
        "业务规则回写失败。",
        ...(Array.isArray(importResult.details)
          ? importResult.details
          : [importResult.details || importResult.errorCode || "未知错误"])
      ]);
      return;
    }
    await appendWritebackRiskDiagnostic(
      PREFLIGHT_OPERATION_IDS.cloudpivotBizruleWriteback,
      pageContext,
      directorySelection,
      importResult.fileName,
      preflightResults
    );

    const [{ result: writebackResult }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: bizRuleWritebackMain,
      args: [
        {
          fileName: importResult.fileName,
          sourceContent: importResult.content,
          multiModelHint: BIZ_RULE_USAGE_NOTICE
        }
      ]
    });

    if (!writebackResult?.ok) {
      setStatus([
        "业务规则回写失败。",
        `错误码：${writebackResult?.errorCode || "UNKNOWN_ERROR"}`,
        ...(Array.isArray(writebackResult?.details)
          ? writebackResult.details
          : [writebackResult?.details || "未返回更多诊断信息"])
      ]);
      return;
    }

    await updateDirectoryInfo(pageType, targetScope);
    setStatus([
      "业务规则回写成功。",
      `目录访问：${describeDirectoryAccessMode(directorySelection)}`,
      `文件名：${writebackResult.fileName || importResult.fileName}`,
      `语言：${writebackResult.language || "未知"}`,
      `URI：${writebackResult.uri || "空"}`,
      `源代码长度：${writebackResult.sourceLength}`,
      `编辑器数量：${writebackResult.editorCount}`,
      `模型数量：${writebackResult.modelCount}`,
      `诊断：${(writebackResult.details || []).join(" | ") || "无"}`
    ]);
      },
      {
        expectedPlatformKey: PLATFORM_CONFIG.cloudpivot.platformKey,
        directoryMode: "read"
      }
    );
  } catch (error) {
    setStatus(`业务规则回写失败。\n${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

function resolveH3yunCodeFileName(codeKind, result, pageUrl) {
  return codeKind === "backend"
    ? resolveH3yunBackendFileName({ sourceContent: result?.sourceContent, pageUrl })
    : resolveH3yunFrontendFileName({ pageUrl });
}

// 氚云操作必须在 h3yun.com 页面执行；目录仍复用页面快照，保证和云枢目录状态隔离。
async function getH3yunOperationContext(actionLabel) {
  const pageContext = await updatePageInfo({ syncPlatform: false });
  const { tab, pageTypeConfig } = pageContext;
  if (pageTypeConfig.platformKey !== PLATFORM_CONFIG.h3yun.platformKey) {
    throw new Error(`${actionLabel}仅支持氚云页面。当前页面：${describeOrigin(tab?.url || "")}`);
  }
  const executableContextError = getExecutableContextError(tab);
  if (executableContextError) {
    throw new Error(executableContextError);
  }
  return pageContext;
}

async function probeH3yunCodeEditor(tab, codeKind) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: h3yunCodeEditorProbeMain,
    args: [H3YUN_CODE_EDITOR_CONFIG[codeKind]]
  });
  return result;
}

async function probeH3yunDesignerMetadata(tab) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: h3yunDesignerMetadataMain
  });
  return result;
}

// 回写前先探测当前编辑器，以当前页面 ID / 后端类名决定读取哪个本地文件。
async function handleH3yunCodeWriteback(codeKind) {
  const config = H3YUN_CODE_EDITOR_CONFIG[codeKind];
  setBusy(true);
  setStatus(`正在回写氚云${config.label}...`);
  try {
    await runOperationWithPreflight(
      codeKind === "backend"
        ? PREFLIGHT_OPERATION_IDS.h3yunBackendWriteback
        : PREFLIGHT_OPERATION_IDS.h3yunFrontendWriteback,
      async ({ pageContext, directorySelection, preflightResults }) => {
    const { tab, pageType, targetScope } = pageContext;
    if (pageContext.pageTypeConfig.platformKey !== PLATFORM_CONFIG.h3yun.platformKey) {
      throw new Error(`氚云${config.label}回写仅支持氚云页面。当前页面：${describeOrigin(tab?.url || "")}`);
    }
    const probeResult = await probeH3yunCodeEditor(tab, codeKind);
    if (!probeResult?.ok) {
      throw new Error(probeResult?.details || `${config.selector} 未找到可回写编辑器`);
    }
    const fileName = resolveH3yunCodeFileName(codeKind, probeResult, probeResult.pageUrl || tab.url);
    const importResult = await readCodeFileByName(directorySelection, fileName);
    await appendWritebackRiskDiagnostic(
      codeKind === "backend"
        ? PREFLIGHT_OPERATION_IDS.h3yunBackendWriteback
        : PREFLIGHT_OPERATION_IDS.h3yunFrontendWriteback,
      pageContext,
      directorySelection,
      importResult.fileName,
      preflightResults
    );
    const writebackResult = await writeH3yunCodeEditor(tab, codeKind, importResult.content);
    if (!writebackResult?.ok) {
      const logExtra = writebackResult?.debugLog ? `\n--- 调试日志 ---\n${writebackResult.debugLog}` : "";
      throw new Error(`${writebackResult?.details || "页面编辑器拒绝回写"}${logExtra}`);
    }
    await updateDirectoryInfo(pageType, targetScope);
    const modelNote = writebackResult.writableCount > 1 ? `（已写入 ${writebackResult.writableCount} 个 model）` : "";
    const logNote = writebackResult.debugLog ? `\n--- 调试日志 ---\n${writebackResult.debugLog}` : "";
    setStatus([`氚云${config.label}回写成功。${modelNote}`, `文件名：${fileName}`, `源码长度：${writebackResult.sourceLength} 字符${logNote}`]);
      },
      {
        expectedPlatformKey: PLATFORM_CONFIG.h3yun.platformKey,
        directoryMode: "read",
        syncPlatform: false
      }
    );
  } catch (error) {
    setStatus(`氚云${config.label}回写失败。\n${error?.message || String(error)}`, {
      level: "error",
      suggestion: "处理建议：确认氚云页面已切到对应前端/后端代码区域并完全加载；若仍失败，请导出日志发给作者排查 Monaco model 匹配。"
    });
    // 重新抛出错误，让上层调用者（如一键回写）能感知失败，避免误报成功。
    throw error;
  } finally {
    setBusy(false);
  }
}

async function readCodeFileByName(directorySelection, fileName) {
  const [fileResult] = await readFilesFromSelection(directorySelection, [fileName]);
  if (!fileResult?.exists) {
    throw new Error(`目标目录中未找到 ${fileName}`);
  }
  return { fileName, content: normalizeExcessBlankLines(fileResult.content) };
}

async function writeH3yunCodeEditor(tab, codeKind, sourceContent) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: h3yunCodeEditorWritebackMain,
    args: [{ ...H3YUN_CODE_EDITOR_CONFIG[codeKind], sourceContent }]
  });
  return result;
}

// 统计子表字段编码缺失数量，便于氚云 DOM 结构变化时快速判断本次抓取是否仍需补适配。
function countMissingH3yunChildCodes(metadata) {
  return (Array.isArray(metadata?.controls) ? metadata.controls : []).reduce((total, control) => {
    const children = Array.isArray(control?.children) ? control.children : [];
    return total + children.filter((child) => !String(child?.code || "").trim()).length;
  }, 0);
}

function buildH3yunWorkspaceDocumentInput(metadata, pageTypeConfig, pageUrl, codeFiles = []) {
  // 氚云协作文件必须突出 Ajax 前后端互通模型，便于 AI 同步生成 JS 与 C# 的参数契约。
  return {
    platformKey: PLATFORM_CONFIG.h3yun.platformKey,
    platformLabel: PLATFORM_CONFIG.h3yun.platformLabel,
    pageLabel: pageTypeConfig?.pageLabel,
    pageUrl,
    appCode: metadata?.appCode,
    formId: metadata?.formId,
    codeFiles
  };
}

/**
 * 氚云一键抓取写入。
 * 列表设计模式（designMode === "list"）无图形控件，跳过 FromCode 的图形控件依赖，不误报"没有图形控件"。
 * 按 generatedFiles 开关 + extraDocs 一次性覆写门控生成协作文件。
 */
async function handleH3yunCaptureAllAndWrite(extraDocs = {}) {
  setBusy(true);
  setStatus("正在一键抓取氚云页面...");
  try {
    await runOperationWithPreflight(
      PREFLIGHT_OPERATION_IDS.h3yunCaptureAll,
      async ({ pageContext, directorySelection }) => {
    const { tab, pageType, pageTypeConfig, targetScope } = pageContext;
    if (pageTypeConfig.platformKey !== PLATFORM_CONFIG.h3yun.platformKey) {
      throw new Error(`氚云一键抓取写入仅支持氚云页面。当前页面：${describeOrigin(tab?.url || "")}`);
    }
    const designMode = resolveH3yunDesignMode(pageTypeConfig);
    const workspaceDocumentState = await getWorkspaceDocumentState(directorySelection);
    const [metadata, frontendResult, backendResult] = await Promise.all([
      probeH3yunDesignerMetadata(tab),
      probeH3yunCodeEditor(tab, "frontend"),
      probeH3yunCodeEditor(tab, "backend")
    ]);
    const filesToWrite = [];
    const skipped = [];
    const codeFiles = [];
    let capturedFileCount = 0;

    // 列表设计模式跳过图形控件：该模式本身就没有图形设计区，不应误报"没有图形控件"。
    if (designMode === "list") {
      // 列表模式不要求图形控件，但仍尝试生成 FromCode.md 如果有数据
      if (metadata?.ok && metadata.controls?.length) {
        filesToWrite.push({ fileName: "FromCode.md", content: buildH3yunFromCodeContent(metadata) });
        capturedFileCount += 1;
      }
    } else {
      // 表单模式要求图形控件
      if (metadata?.ok && metadata.controls?.length) {
        filesToWrite.push({ fileName: "FromCode.md", content: buildH3yunFromCodeContent(metadata) });
        capturedFileCount += 1;
      } else {
        skipped.push("图形控件");
      }
    }
    if (frontendResult?.ok && frontendResult.sourceContent) {
      const frontendFileName = resolveH3yunFrontendFileName({ pageUrl: frontendResult.pageUrl || tab.url, designMode });
      codeFiles.push(frontendFileName);
      filesToWrite.push({ fileName: frontendFileName, content: frontendResult.sourceContent });
      capturedFileCount += 1;
    } else { skipped.push("前端 JS"); }
    if (backendResult?.ok && backendResult.sourceContent) {
      const backendFileName = resolveH3yunBackendFileName({ sourceContent: backendResult.sourceContent, pageUrl: backendResult.pageUrl || tab.url, designMode });
      codeFiles.push(backendFileName);
      filesToWrite.push({ fileName: backendFileName, content: backendResult.sourceContent });
      capturedFileCount += 1;
    } else { skipped.push("后端 C#"); }
    if (!capturedFileCount) {
      throw new Error("当前页面没有挂载图形控件、前端 JS 或后端 C# 编辑器。");
    }
    // 按 generatedFiles 开关 + extraDocs 一次性覆写门控生成协作文件
    const platformKey = PLATFORM_CONFIG.h3yun.platformKey;
    const generatedFiles = (currentConfig?.generatedFiles || {})[platformKey] || {};
    filesToWrite.unshift(...buildMissingWorkspaceDocumentFiles(
      buildH3yunWorkspaceDocumentInput(metadata, pageTypeConfig, tab.url, codeFiles),
      workspaceDocumentState,
      { generatedFiles, extraDocs }
    ));
    await writeFilesToSelection(directorySelection, filesToWrite);
    await updateDirectoryInfo(pageType, targetScope);
    const missingChildCodeCount = countMissingH3yunChildCodes(metadata);
    setStatus([
      "氚云一键抓取写入完成。",
      `已写入：${filesToWrite.map((f) => f.fileName).join("、")}`,
      `未挂载：${skipped.join("、") || "无"}`,
      missingChildCodeCount ? `子表控件编码缺失：${missingChildCodeCount} 个` : "子表控件编码缺失：无"
    ]);
    if (missingChildCodeCount && metadata?._diagnosticDomSnapshot) {
      if (lastDiagnosticPackage) {
        lastDiagnosticPackage.designerDomSnapshot = metadata._diagnosticDomSnapshot;
        await saveLastDiagnosticPackage(lastDiagnosticPackage);
      }
    }
      },
      {
        expectedPlatformKey: PLATFORM_CONFIG.h3yun.platformKey,
        directoryMode: "readwrite",
        syncPlatform: false,
        collectExtraResults: collectH3yunLazyLoadWarning
      }
    );
  } catch (error) {
    setStatus(`氚云一键抓取写入失败。\n${error?.message || String(error)}`, {
      level: "error",
      suggestion: "处理建议：确认图形设计区、前端 JS、后端 C# 至少有一个区域已加载；若页面已加载但抓不到内容，请导出日志和问题 DOM 发给作者。"
    });
  } finally {
    setBusy(false);
  }
}

function handlePlatformTabClick(event) {
  setActivePlatform(event.currentTarget?.dataset?.platformTab);
}

function h3yunCodeEditorProbeMain(input = {}) {
  const csPattern = /using\s+System|namespace\s+\w+|public\s+class\s+\w+|H3\.SmartForm/;
  const jsPattern = /\/\*|\$\..*extend|function\s*\(|控件接口/;

  function safeNumber(value, fallback = 0) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
  }

  function compareModelCandidates(left, right) {
    const priorityKeys = ["isContainerModel", "isAttached", "versionId", "alternativeVersionId", "index", "length"];
    for (const key of priorityKeys) {
      const fallback = key === "index" ? -1 : 0;
      const leftValue = safeNumber(left[key], fallback);
      const rightValue = safeNumber(right[key], fallback);
      if (leftValue !== rightValue) {
        return leftValue - rightValue;
      }
    }
    return 0;
  }

  // 氚云同页会残留模板 / 当前编辑等多个 JS model，候选评分优先"当前挂载和最近变更"，避免只按长度读到模板。
  function createModelCandidate(model, index, containerModel) {
    const sourceContent = String(model?.getValue?.() || "");
    const snippet = sourceContent.substring(0, 2000);
    const csHit = csPattern.test(snippet);
    const jsHit = !csHit && jsPattern.test(snippet);
    return {
      model,
      index,
      csHit,
      jsHit,
      length: sourceContent.length,
      isContainerModel: model === containerModel ? 1 : 0,
      isAttached: typeof model?.isAttachedToEditor === "function" && model.isAttachedToEditor() ? 1 : 0,
      versionId: safeNumber(model?.getVersionId?.()),
      alternativeVersionId: safeNumber(model?.getAlternativeVersionId?.())
    };
  }

  // DOM 兜底：从 .view-lines 读取代码行，按 linenumber 排序拼接。
  // 受 Monaco 虚拟滚动限制，仅能读取当前视口 + 缓冲区内的行，大文件可能不完整。
  function readFromViewLines(container) {
    const viewLinesContainer = container.querySelector(".view-lines");
    if (!viewLinesContainer) {
      return null;
    }
    // 先尝试强制滚动到底部再回到顶部，触发更多行渲染
    const scrollable = container.querySelector(".monaco-scrollable-element");
    if (scrollable) {
      scrollable.scrollTop = scrollable.scrollHeight;
      scrollable.scrollTop = 0;
    }
    const lineElements = viewLinesContainer.querySelectorAll(".view-line");
    if (!lineElements.length) {
      return null;
    }
    // 按 linenumber 属性排序确保行顺序正确（虚拟滚动时 DOM 顺序可能乱）
    const lines = Array.from(lineElements)
      .sort((a, b) => (parseInt(a.getAttribute("linenumber") || "0", 10)) - (parseInt(b.getAttribute("linenumber") || "0", 10)))
      .map((el) => el.textContent || "");
    return lines.join("\n");
  }

  // 查找 Monaco model：容器 editor 匹配 → 内容特征匹配 → 唯一 model 兜底。
  // 氚云 Monaco editor 的 model 语言 ID 全部为 undefined，不可依赖语言匹配。
  function findModel(log) {
    log.push(`[findModel] selector=${input.selector}, codeKind=${input.codeKind || "?"}`);
    const container = document.querySelector(input.selector);
    const monaco = window.monaco;

    if (!container) {
      log.push("[findModel] ❌ 容器未挂载");
      return { error: `页面未挂载 ${input.selector}`, diagnostic: "container-missing" };
    }
    log.push(`[findModel] 容器存在, 内有 .monaco-editor=${container.querySelectorAll(".monaco-editor").length}个, .view-lines=${container.querySelectorAll(".view-lines").length}个`);

    if (!monaco?.editor) {
      log.push("[findModel] ❌ window.monaco.editor 不存在");
      return { error: "window.monaco.editor 不存在", diagnostic: "monaco-missing" };
    }

    const editors = typeof monaco.editor.getEditors === "function" ? monaco.editor.getEditors().filter(Boolean) : [];
    const models = typeof monaco.editor.getModels === "function" ? monaco.editor.getModels().filter(Boolean) : [];
    log.push(`[findModel] editors=${editors.length}个, models=${models.length}个`);

    // 输出每个 model 的摘要
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      const lang = m?.getLanguageId?.() || "undefined";
      const len = m?.getValue?.()?.length || 0;
      const head = (m?.getValue?.() || "").substring(0, 60).replace(/\n/g, "\\n");
      log.push(`[findModel]   model[${i}]: lang=${lang}, len=${len}, head="${head}..."`);
    }

    let editor = null;
    let model = null;
    // 策略1：容器 DOM 内找 editor
    editor = editors.find((item) => container.contains(item?.getDomNode?.()));
    model = editor?.getModel?.();
    log.push(editor ? "[findModel] 策略1: 容器内找到 editor ✓" : "[findModel] 策略1: 容器内无 editor");

    // 策略2：内容特征匹配；多个 model 同时命中时按挂载状态、版本号和创建顺序评分。
    if (!model && models.length > 0) {
      if (models.length === 1) {
        model = models[0];
        log.push("[findModel] 策略2: 唯一 model 直接取用 ✓");
      } else {
        const isFrontend = input.codeKind === "frontend";
        log.push(`[findModel] 策略2: isFrontend=${isFrontend}, 内容正则匹配 + Monaco 状态评分中...`);
        const matchedModels = models
          .map((m, index) => createModelCandidate(m, index, model))
          .filter((candidate) => {
            if (isFrontend) {
              if (candidate.csHit) {
                log.push(`[findModel]   model[${candidate.index}]: 跳过(C#), len=${candidate.length}`);
                return false;
              }
              log.push(`[findModel]   model[${candidate.index}]: jsHit=${candidate.jsHit}, len=${candidate.length}, attached=${candidate.isAttached}, version=${candidate.versionId}, alt=${candidate.alternativeVersionId}`);
              return candidate.jsHit;
            }
            log.push(`[findModel]   model[${candidate.index}]: csHit=${candidate.csHit}, len=${candidate.length}, attached=${candidate.isAttached}, version=${candidate.versionId}, alt=${candidate.alternativeVersionId}`);
            return candidate.csHit;
          });
        log.push(`[findModel] 匹配到 ${matchedModels.length} 个 model`);
        // 多个命中时不再取最长：用户删除模板注释后，真实编辑内容可能比模板更短。
        if (matchedModels.length > 0) {
          const selected = matchedModels.reduce((best, current) => (compareModelCandidates(best, current) >= 0 ? best : current));
          model = selected.model;
          log.push(`[findModel] 策略2: 取评分最高 model[${selected.index}], len=${selected.length}, attached=${selected.isAttached}, version=${selected.versionId}, alt=${selected.alternativeVersionId} ✓`);
        }
      }
    }

    const diagnostic = model
      ? `found: editors=${editors.length}, models=${models.length}, codeKind=${input.codeKind || "?"}`
      : `no-model: editors=${editors.length}, models=${models.length}`;

    log.push(`[findModel] 结果: ${model ? "找到 model ✓" : "未找到 ✗"}`);

    return { container, editor, model, editors, models, diagnostic };
  }

  try {
    const log = [];
    log.push(`[h3yunProbe] 开始抓取, codeKind=${input.codeKind}, selector=${input.selector}`);
    const state = findModel(log);

    // Monaco API 路径失败时，尝试通过 .view-lines DOM 兜底读取
    if (state.error || !state.model || typeof state.model.getValue !== "function") {
      log.push("[h3yunProbe] Monaco API 路径失败，尝试 DOM 兜底...");
      const container = state.container || document.querySelector(input.selector);
      if (!container) {
        log.push("[h3yunProbe] ❌ 容器不存在");
        return { ok: false, errorCode: "H3YUN_CODE_EDITOR_NOT_FOUND", details: state.error || `页面未挂载 ${input.selector}`, debugLog: log.join("\n") };
      }
      const domContent = readFromViewLines(container);
      if (domContent === null) {
        log.push("[h3yunProbe] ❌ DOM 兜底也失败");
        const details = state.error || state.diagnostic || `${input.selector} 未找到 Monaco model 且 .view-lines DOM 也未挂载`;
        return { ok: false, errorCode: "H3YUN_CODE_EDITOR_NOT_FOUND", details, debugLog: log.join("\n") };
      }
      log.push(`[h3yunProbe] DOM 兜底成功, ${domContent.length} 字符`);
      return {
        ok: true, pageUrl: window.location.href, selector: input.selector,
        language: container.getAttribute("data-mode-id") || "", uri: "",
        sourceContent: domContent, sourceLength: domContent.length,
        editorCount: 0, modelCount: 0, readMethod: "view-lines-dom",
        diagnostic: state.diagnostic || "monaco-unavailable", debugLog: log.join("\n")
      };
    }

    // Monaco API 主路径
    const sourceContent = String(state.model.getValue() || "");
    log.push(`[h3yunProbe] Monaco API 成功, ${sourceContent.length} 字符`);
    log.push(`[h3yunProbe] 内容头部: "${sourceContent.substring(0, 100).replace(/\n/g, "\\n")}"`);
    log.push(`[h3yunProbe] 内容尾部: "${sourceContent.substring(sourceContent.length - 80).replace(/\n/g, "\\n")}"`);
    // 额外输出所有匹配 JS model 的模型诊断
    for (let i = 0; i < (state.models || []).length; i++) {
      const m = state.models[i];
      const val = m?.getValue?.() || "";
      const snippet = val.substring(0, 2000);
      const csHit = csPattern.test(snippet);
      const jsHit = !csHit && jsPattern.test(snippet);
      if (!csHit && jsHit) {
        log.push(`[h3yunProbe] JS model[${i}] head: "${val.substring(0, 80).replace(/\n/g, "\\n")}", tail: "${val.substring(val.length-40).replace(/\n/g, "\\n")}", total=${val.length}`);
      }
    }
    return {
      ok: true, pageUrl: window.location.href, selector: input.selector,
      language: state.model.getLanguageId?.() || state.container.getAttribute("data-mode-id") || "",
      uri: state.model.uri?.toString?.() || "",
      sourceContent, sourceLength: sourceContent.length,
      editorCount: state.editors.length, modelCount: state.models.length,
      readMethod: "monaco-api", diagnostic: state.diagnostic, debugLog: log.join("\n")
    };
  } catch (error) {
    return { ok: false, errorCode: "H3YUN_CODE_PROBE_FAILED", details: error?.message || String(error) };
  }
}

function h3yunCodeEditorWritebackMain(input = {}) {
  // C#: using System / H3.SmartForm / public class
  // JS: /* 控件接口说明 / $.extend($.JForm / OnLoad:function
  function findModel(log) {
    log.push(`[writeback] selector=${input.selector}, codeKind=${input.codeKind || "?"}`);
    const container = document.querySelector(input.selector);
    const monaco = window.monaco;
    if (!container || !monaco?.editor) {
      log.push(`[writeback] ❌ ${!container ? "容器未挂载" : "monaco.editor 不存在"}`);
      return { error: !container ? `页面未挂载 ${input.selector}` : "window.monaco.editor 不存在" };
    }
    const editors = typeof monaco.editor.getEditors === "function" ? monaco.editor.getEditors().filter(Boolean) : [];
    const models = typeof monaco.editor.getModels === "function" ? monaco.editor.getModels().filter(Boolean) : [];
    log.push(`[writeback] editors=${editors.length}, models=${models.length}`);
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      log.push(`[writeback]   model[${i}]: lang=${m?.getLanguageId?.() || "undefined"}, len=${m?.getValue?.()?.length || 0}`);
    }
    let editor = editors.find((item) => container.contains(item?.getDomNode?.()));
    let model = editor?.getModel?.();
    log.push(editor ? "[writeback] 容器内找到 editor" : "[writeback] 容器内无 editor");
    if (!model && models.length === 1) { model = models[0]; log.push("[writeback] 唯一 model 取用"); }
    return { container, model, editors, models };
  }

  try {
    const log = [];
    log.push(`[writeback] 开始, codeKind=${input.codeKind}, sourceLength=${(input.sourceContent || "").length}`);
    const state = findModel(log);
    if (state.error) {
      return { ok: false, errorCode: "H3YUN_CODE_EDITOR_NOT_FOUND", details: state.error, debugLog: log.join("\n") };
    }

    const csPattern = /using\s+System|namespace\s+\w+|public\s+class\s+\w+|H3\.SmartForm/;
    const isFrontend = input.codeKind === "frontend";
    log.push(`[writeback] 筛选可写 model: isFrontend=${isFrontend}`);
    const writableModels = (state.models || []).filter((m, i) => {
      if (typeof m?.setValue !== "function") { log.push(`[writeback]   model[${i}]: 跳过(无setValue)`); return false; }
      const snippet = (m.getValue?.() || "").substring(0, 500);
      if (isFrontend) {
        if (csPattern.test(snippet)) { log.push(`[writeback]   model[${i}]: 跳过(C#特征)`); return false; }
        const jsHit = /\/\*|\$\..*extend|function\s*\(/.test(snippet);
        log.push(`[writeback]   model[${i}]: jsHit=${jsHit}`);
        return jsHit;
      }
      const csHit = csPattern.test(snippet);
      log.push(`[writeback]   model[${i}]: csHit=${csHit}`);
      return csHit;
    });
    log.push(`[writeback] 匹配到 ${writableModels.length} 个可写 model`);

    if (!writableModels.length) {
      if (!state.model || typeof state.model.setValue !== "function") {
        log.push("[writeback] ❌ 无可写 model");
        return { ok: false, errorCode: "H3YUN_CODE_MODEL_NOT_WRITABLE", details: `${input.selector} 未找到可写 Monaco model`, debugLog: log.join("\n") };
      }
      log.push("[writeback] 回退到 findModel model");
      writableModels.push(state.model);
    }

    const sourceContent = String(input.sourceContent ?? "");
    for (const m of writableModels) {
      m.setValue(sourceContent);
    }
    log.push(`[writeback] 成功, 写入 ${writableModels.length} 个 model`);
    return {
      ok: true, pageUrl: window.location.href, selector: input.selector,
      language: writableModels[0]?.getLanguageId?.() || state.container?.getAttribute("data-mode-id") || "",
      sourceLength: sourceContent.length,
      editorCount: state.editors.length, modelCount: state.models.length,
      writableCount: writableModels.length, debugLog: log.join("\n")
    };
  } catch (error) {
    return { ok: false, errorCode: "H3YUN_CODE_WRITEBACK_FAILED", details: error?.message || String(error) };
  }
}

function h3yunDesignerMetadataMain() {
  function text(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  // 安全转为文本：对象类型（如 DisplayRule）转为 JSON 字符串，避免出现 [object Object]
  function safeText(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      try { return JSON.stringify(value); } catch (_) { return ""; }
    }
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  function pageParams() {
    const url = new URL(window.location.href);
    const hashQuery = url.hash.includes("?") ? url.hash.slice(url.hash.indexOf("?") + 1) : "";
    return Object.assign(Object.fromEntries(url.searchParams.entries()), Object.fromEntries(new URLSearchParams(hashQuery).entries()));
  }
  function readAttribute(element, names) {
    for (const name of names) {
      const value = text(element.getAttribute(name) || element.getAttribute(`data-${name}`));
      if (value) return value;
    }
    return "";
  }
  function readObjectValue(source, keyHints, excludeValue = "") {
    if (!source || typeof source !== "object") return "";
    for (const [key, rawValue] of Object.entries(source)) {
      const normalizedKey = String(key || "").toLowerCase();
      if (!keyHints.some((hint) => normalizedKey === hint || normalizedKey.includes(hint))) continue;
      const value = text(typeof rawValue === "object" ? rawValue?.zh || rawValue?.name || rawValue?.value : rawValue);
      if (value && value !== excludeValue) return value;
    }
    return "";
  }
  function readObjectValues(source, keyHints = []) {
    if (!source || typeof source !== "object") return [];
    const values = [];
    for (const [key, rawValue] of Object.entries(source)) {
      const normalizedKey = String(key || "").toLowerCase();
      if (keyHints.length && !keyHints.some((hint) => normalizedKey === hint || normalizedKey.includes(hint))) continue;
      if (["string", "number", "boolean"].includes(typeof rawValue)) {
        values.push({ key: normalizedKey, value: text(rawValue) });
      }
    }
    return values.filter((item) => item.value);
  }
  function vueSources(element) {
    const sources = [];
    for (let node = element; node && sources.length < 24; node = node.parentElement) {
      if (node.__vue__) sources.push(node.__vue__, node.__vue__.$props, node.__vue__._data);
      const component = node.__vueParentComponent;
      if (component) sources.push(component.proxy, component.ctx, component.props, component.vnode?.props);
    }
    return sources.filter(Boolean);
  }
  function collectObjects(root) {
    const objects = [];
    const queue = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    while (queue.length && objects.length < 800) {
      const { value, depth } = queue.shift();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      if (value instanceof Element || value instanceof Window) continue;
      objects.push(value);
      if (depth >= 5) continue;
      for (const key of Object.keys(value).slice(0, 80)) {
        try {
          const child = value[key];
          if (child && typeof child === "object") queue.push({ value: child, depth: depth + 1 });
        } catch (_error) {}
      }
    }
    return objects;
  }
  function vueControlMetadata(element, displayName, index) {
    const labelHints = ["displayname", "label", "title", "fieldname", "controlname", "name"];
    const codeHints = ["controlcode", "fieldcode", "propertycode", "schemacode", "datacode", "code"];
    const typeHints = ["controlkey", "controltype", "widgettype", "componentname", "component", "type"];
    const normalizedName = text(displayName);
    const normalizedIndex = text(index);
    for (const source of vueSources(element)) {
      for (const object of collectObjects(source)) {
        const objectName = readObjectValue(object, labelHints);
        const objectIndex = readObjectValue(object, ["index", "sort", "order"]);
        const nameMatched = objectName && (objectName === normalizedName || objectName.includes(normalizedName) || normalizedName.includes(objectName));
        const indexMatched = normalizedIndex && objectIndex === normalizedIndex;
        if (!nameMatched && !indexMatched) continue;
        const code = readObjectValue(object, codeHints, normalizedName);
        const controlKey = readObjectValue(object, typeHints, normalizedName);
        if (code || controlKey) return { code, controlKey, displayName: objectName };
      }
    }
    return {};
  }
  function inferSheetControlType(item) {
    if (item.querySelector("textarea")) return "FormTextArea";
    if (item.querySelector(".dropdown")) return "FormDropDown";
    if (item.querySelector("input")) return "FormTextBox";
    return "SheetControl";
  }
  function normalizeSheetFieldCode(value) {
    const match = text(value).match(/\b(D[A-Za-z0-9]+)\.(F[A-Za-z0-9]+)\b/);
    return match ? `${match[1]}.${match[2]}` : "";
  }
  function extractSheetFieldCodes(value) {
    const source = text(value);
    const codes = [];
    const pattern = /\b(D[A-Za-z0-9]+)\.(F[A-Za-z0-9]+)\b/g;
    let match = pattern.exec(source);
    while (match) {
      codes.push(`${match[1]}.${match[2]}`);
      match = pattern.exec(source);
    }
    return codes;
  }
  function sheetCodeFromFieldCode(value) {
    return normalizeSheetFieldCode(value).split(".")[0] || "";
  }
  function isFieldCode(value) {
    return /^F[A-Za-z0-9]+$/.test(text(value));
  }
  function isSheetCode(value) {
    return /^D[A-Za-z0-9]+$/.test(text(value));
  }
  function namesMatch(left, right) {
    const leftName = text(left);
    const rightName = text(right);
    return Boolean(leftName && rightName && (leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName)));
  }
  // 子表字段完整编码通常只出现在设计器全局状态中，格式为"子表编码.F字段编码"，不在具体 .sheet-control 节点上。
  function buildSheetFieldCodeCatalog(root) {
    const groups = new Map();
    const groupOrder = [];
    let sourceOrder = 0;

    function ensureGroup(sheetCode, sourceName = "") {
      const normalizedSheetCode = text(sheetCode);
      if (!normalizedSheetCode) return null;
      if (!groups.has(normalizedSheetCode)) {
        groups.set(normalizedSheetCode, { sheetCode: normalizedSheetCode, entries: [], names: [], order: groupOrder.length });
        groupOrder.push(normalizedSheetCode);
      }
      const group = groups.get(normalizedSheetCode);
      if (sourceName && !group.names.some((name) => namesMatch(name, sourceName))) {
        group.names.push(sourceName);
      }
      return group;
    }

    function register(fullCode, sourceName = "") {
      const normalizedFullCode = normalizeSheetFieldCode(fullCode);
      if (!normalizedFullCode) return;
      const group = ensureGroup(sheetCodeFromFieldCode(normalizedFullCode), sourceName);
      if (!group) return;
      const existing = group.entries.find((entry) => entry.code === normalizedFullCode);
      if (existing) {
        if (sourceName && !existing.displayName) existing.displayName = sourceName;
        return;
      }
      group.entries.push({ code: normalizedFullCode, displayName: sourceName, order: sourceOrder++ });
    }

    function uniqueVueSources(nodes) {
      const sources = [];
      const seen = new WeakSet();
      for (const node of nodes) {
        for (const source of vueSources(node)) {
          if (!source || typeof source !== "object" || seen.has(source)) continue;
          seen.add(source);
          sources.push(source);
        }
      }
      return sources;
    }

    const domElements = Array.from(root.querySelectorAll("*")).slice(0, 5000);
    for (const element of [root, ...domElements]) {
      const sourceName = text(element.getAttribute?.("title") || element.dataset?.displayname || "");
      for (const attribute of Array.from(element.attributes || [])) {
        for (const fullCode of extractSheetFieldCodes(attribute.value)) {
          register(fullCode, sourceName);
        }
      }
    }
    for (const fullCode of extractSheetFieldCodes(root.innerHTML)) {
      register(fullCode);
    }

    // 编码原始数据可能挂在任意子表/字段组件的 Vue 状态上，采集关键节点祖先链比只读根节点更稳。
    const vueSourceNodes = [
      root,
      ...domElements.filter((element) => (
        element.__vue__ ||
        element.__vueParentComponent ||
        element.matches?.("[data-code], .sheet-control, [data-sheet='true'], .grid-view-title")
      ))
    ].slice(0, 1200);

    for (const source of uniqueVueSources(vueSourceNodes)) {
      for (const object of collectObjects(source)) {
        const sourceName = readObjectValue(object, ["displayname", "label", "title", "fieldname", "controlname", "name"]);
        const primitiveValues = readObjectValues(object);
        for (const item of primitiveValues) {
          for (const fullCode of extractSheetFieldCodes(item.value)) {
            register(fullCode, sourceName);
          }
        }

        const sheetCodes = primitiveValues
          .filter((item) => isSheetCode(item.value) && /(sheet|table|grid|parent|schema|data|code)/.test(item.key))
          .map((item) => item.value);
        const fieldCodes = primitiveValues
          .filter((item) => isFieldCode(item.value) && /(field|control|property|schema|data|code)/.test(item.key))
          .map((item) => item.value);
        for (const sheetCode of sheetCodes) {
          ensureGroup(sheetCode, sourceName);
        }
        if (sheetCodes.length === 1 && fieldCodes.length) {
          for (const fieldCode of fieldCodes) {
            register(`${sheetCodes[0]}.${fieldCode}`, sourceName);
          }
        }
      }
    }

    return groupOrder.map((sheetCode) => {
      const group = groups.get(sheetCode);
      group.entries.sort((left, right) => left.order - right.order);
      return group;
    });
  }
  function resolveSheetFieldGroup(catalog, control) {
    const children = Array.isArray(control.children) ? control.children : [];
    const controlCode = text(control.code);
    if (controlCode) {
      const byControlCode = catalog.find((group) => group.sheetCode === controlCode);
      if (byControlCode) return byControlCode;
    }

    const directSheetCode = children.map((child) => sheetCodeFromFieldCode(child.code)).find(Boolean);
    if (directSheetCode) {
      return catalog.find((group) => group.sheetCode === directSheetCode) || null;
    }

    const byName = catalog.find((group) => group.names.some((name) => namesMatch(name, control.displayName)));
    if (byName) return byName;

    const childCount = children.length;
    const bySize = catalog.filter((group) => group.entries.length >= childCount);
    return bySize.length === 1 ? bySize[0] : null;
  }
  // 氚云子表内控件在当前 DOM 中常缺少 data-code；最终按"子表编码.F字段编码"的全局顺序回填。
  function childrenOf(container, sheetFieldGroup = null) {
    return Array.from(container.querySelectorAll("[data-sheet='true'] .sheet-control")).map((item, position) => {
      const displayName = text(readAttribute(item, ["title"]) || item.querySelector(".title")?.textContent);
      const index = text(item.getAttribute("index"));
      const vueMetadata = vueControlMetadata(item, displayName, index);
      const rawCode = text(readAttribute(item, ["code", "control-code", "field-code"]) || vueMetadata.code);
      const fieldIndex = Number(index);
      const orderedIndex = Number.isInteger(fieldIndex) && fieldIndex >= 0 ? fieldIndex : position;
      const orderedCode = sheetFieldGroup?.entries?.[orderedIndex]?.code || "";
      return {
        code: text(normalizeSheetFieldCode(rawCode) || orderedCode || rawCode),
        controlKey: text(readAttribute(item, ["controlkey", "control-key", "control-type"]) || vueMetadata.controlKey || inferSheetControlType(item)),
        displayName: text(displayName || vueMetadata.displayName),
        index
      };
    });
  }
  // 子表控件编码缺失时，捕获当前页面 DOM 和 Vue 状态快照，便于诊断编码匹配失败的根因。
  function buildMissingCodeDomSnapshot(root, sheetFieldCatalog) {
    var snap = {
      sheetFieldCatalog: [],
      sheetContainers: []
    };

    // 输出全局字段编码目录摘要
    for (var gi = 0; gi < sheetFieldCatalog.length; gi++) {
      var group = sheetFieldCatalog[gi];
      snap.sheetFieldCatalog.push({
        sheetCode: group.sheetCode,
        names: group.names,
        entryCount: group.entries.length,
        entries: group.entries.map(function (entry) {
          return { code: entry.code, displayName: entry.displayName || "" };
        })
      });
    }

    // 输出每个子表容器的 DOM 结构及 Vue 状态线索
    var sheetContainers = Array.from(root.querySelectorAll("[data-sheet='true']"));
    for (var ci = 0; ci < sheetContainers.length && ci < 20; ci++) {
      var container = sheetContainers[ci];
      var containerInfo = {
        tagName: String(container.tagName || ""),
        className: String(container.className || ""),
        attributeKeys: Array.from(container.attributes || []).slice(0, 30).map(function (attr) {
          return { name: attr.name, value: String(attr.value || "").substring(0, 300) };
        }),
        sheetControls: []
      };

      var sheetControls = Array.from(container.querySelectorAll(".sheet-control"));
      for (var si = 0; si < sheetControls.length && si < 50; si++) {
        var sc = sheetControls[si];
        var controlInfo = {
          outerHTML: String(sc.outerHTML || "").substring(0, 2000),
          attributeKeys: Array.from(sc.attributes || []).slice(0, 20).map(function (attr) {
            return { name: attr.name, value: String(attr.value || "").substring(0, 300) };
          }),
          textContent: String(sc.textContent || "").replace(/\s+/g, " ").trim().substring(0, 200),
          vueKeys: []
        };

        // 收集 .sheet-control 节点 Vue 状态中与编码匹配相关的 key
        var sources = vueSources(sc);
        var seenVueKeys = {};
        for (var vi = 0; vi < sources.length && Object.keys(seenVueKeys).length < 40; vi++) {
          var source = sources[vi];
          if (!source || typeof source !== "object") continue;
          var keys = Object.keys(source).filter(function (k) {
            return /(code|field|control|property|schema|data|type|name|label|title|index|display|sheet|sort|order|key)/i.test(k);
          });
          for (var ki = 0; ki < keys.length && Object.keys(seenVueKeys).length < 40; ki++) {
            var key = keys[ki];
            if (seenVueKeys[key]) continue;
            seenVueKeys[key] = true;
            var rawValue = source[key];
            var type = typeof rawValue;
            var displayValue = "";
            if (type === "string") displayValue = rawValue.substring(0, 150);
            else if (type === "number" || type === "boolean") displayValue = String(rawValue);
            else if (rawValue && type === "object") displayValue = "[object]";
            controlInfo.vueKeys.push({ key: key, value: displayValue, type: type });
          }
        }

        containerInfo.sheetControls.push(controlInfo);
      }

      snap.sheetContainers.push(containerInfo);
    }

    return snap;
  }
  // 检查 controls 中是否有子表控件编码缺失
  function hasMissingChildCodes(controls) {
    for (var ci = 0; ci < controls.length; ci++) {
      var children = Array.isArray(controls[ci].children) ? controls[ci].children : [];
      for (var si = 0; si < children.length; si++) {
        if (!String(children[si].code || "").trim()) return true;
      }
    }
    return false;
  }
  // 从氚云设计器全局 allControls（Vue 实例属性）中提取所有控件的完整信息，
  // 包括自定义编码、关联表单、默认值、选项、显示隐藏规则等。
  // 该方式直接读取设计器状态，不依赖 DOM 属性或 Vue 深度遍历，优先使用。
  function findDesignerAllControls() {
    // 辅助：在 Vue 实例及其 $children/$data/$options 中递归查找 allControls
    function searchVueForAllControls(vueInstance) {
      if (!vueInstance || typeof vueInstance !== "object") return null;
      // 1. 直接属性
      if (vueInstance.allControls && typeof vueInstance.allControls === "object" && Object.keys(vueInstance.allControls).length > 0) {
        return vueInstance.allControls;
      }
      // 2. $data
      if (vueInstance.$data?.allControls && typeof vueInstance.$data.allControls === "object" && Object.keys(vueInstance.$data.allControls).length > 0) {
        return vueInstance.$data.allControls;
      }
      // 3. $options
      if (vueInstance.$options?.allControls && typeof vueInstance.$options.allControls === "object" && Object.keys(vueInstance.$options.allControls).length > 0) {
        return vueInstance.$options.allControls;
      }
      // 4. 递归 $children
      var children = vueInstance.$children;
      if (Array.isArray(children)) {
        for (var i = 0; i < children.length; i++) {
          var found = searchVueForAllControls(children[i]);
          if (found) return found;
        }
      }
      return null;
    }

    // 5. 页面所有带 __vue__ 的 DOM 元素遍历查找
    function searchAllDomForAllControls() {
      var allElements = document.querySelectorAll("*");
      for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];
        if (el.__vue__) {
          var found = searchVueForAllControls(el.__vue__);
          if (found) return found;
        }
      }
      return null;
    }

    // 优先通过设计器根节点读取
    const designerRoot = document.querySelector(".designer.web");
    if (designerRoot?.__vue__) {
      var found = searchVueForAllControls(designerRoot.__vue__);
      if (found) return found;
    }

    // 回退：从子表控件沿祖先链查找
    const sheetControl = document.querySelector('[data-sheet="true"] .sheet-control');
    if (sheetControl) {
      for (let node = sheetControl; node; node = node.parentElement) {
        if (node.__vue__) {
          var foundInAncestor = searchVueForAllControls(node.__vue__);
          if (foundInAncestor) return foundInAncestor;
        }
      }
    }

    // 最终回退：遍历所有 DOM 元素的 __vue__ 查找
    return searchAllDomForAllControls();
  }
  // 从 allControls entry 中读取字段值，优先取 entry.options 内的属性（氚云实际数据存放在 options 子对象中），
  // 若 options 中不存在则回退到 entry 顶层属性，兼容不同的数据格式。
  function readAllControlField(entry, fieldName) {
    var opts = entry?.options;
    if (opts && typeof opts === "object" && opts[fieldName] !== undefined && opts[fieldName] !== null) {
      return opts[fieldName];
    }
    return entry[fieldName];
  }

  // 将 allControls 原始数据转换为与现有 DOM 扫描一致的 controls 数组格式
  function extractControlsFromAllControls(rawAllControls, params) {
    var entries = [];
    for (var key in rawAllControls) {
      if (!Object.prototype.hasOwnProperty.call(rawAllControls, key)) continue;
      var entry = rawAllControls[key];
      if (!entry || typeof entry !== "object") continue;
      entries.push({ key: key, entry: entry });
    }
    // 分类：不含点号的是容器控件（主表字段/子表容器），含点号的是子表内字段（sheetCode.fieldCode）
    var containerEntries = entries.filter(function (e) { return e.key.indexOf(".") < 0; });
    var childEntries = entries.filter(function (e) { return e.key.indexOf(".") >= 0; });

    // 将子表字段按 sheetCode（Dxxxxx 前缀）分组
    var childrenBySheetCode = {};
    for (var ci = 0; ci < childEntries.length; ci++) {
      var cKey = childEntries[ci].key;
      var cEntry = childEntries[ci].entry;
      var dotIndex = cKey.indexOf(".");
      var sheetCode = cKey.substring(0, dotIndex);
      var fieldCode = cKey.substring(dotIndex + 1);

      if (!childrenBySheetCode[sheetCode]) {
        childrenBySheetCode[sheetCode] = [];
      }
      var cDefaultItems = readAllControlField(cEntry, "DefaultItems");
      childrenBySheetCode[sheetCode].push({
        code: fieldCode,
        displayName: text(readAllControlField(cEntry, "DisplayName")),
        // ControlKey（options 内字符串，如 "FormTextBox"）优先于 type（顶层数字，如 301）
        controlKey: text(readAllControlField(cEntry, "ControlKey") || readAllControlField(cEntry, "type")),
        defaultValue: text(readAllControlField(cEntry, "DefaultValue")),
        boschemaCode: text(readAllControlField(cEntry, "BOSchemaCode")),
        displayRule: safeText(readAllControlField(cEntry, "DisplayRule")),
        defaultItems: Array.isArray(cDefaultItems) ? cDefaultItems : (cDefaultItems ? [cDefaultItems] : [])
      });
    }

    // 构建顶层 controls 数组，容器条目按子表类型（FormGridView）判断是否有子表子字段
    var controls = [];
    var formId = text(params.id);
    for (var ti = 0; ti < containerEntries.length; ti++) {
      var tKey = containerEntries[ti].key;
      var tEntry = containerEntries[ti].entry;
      // ControlKey（options 内字符串，如 "FormTextBox"）优先于 type（顶层数字，如 301）
      var controlKey = text(readAllControlField(tEntry, "ControlKey") || readAllControlField(tEntry, "type"));
      var children = childrenBySheetCode[tKey] || [];
      var tDefaultItems = readAllControlField(tEntry, "DefaultItems");

      controls.push({
        code: tKey,
        displayName: text(readAllControlField(tEntry, "DisplayName") || readAllControlField(tEntry, "name")),
        controlKey: controlKey,
        sheetCode: tKey,
        children: children,
        // 以下字段优先从 entry.options 读取（氚云实际数据位于 options 子对象），回退到 entry 顶层
        boschemaCode: text(readAllControlField(tEntry, "BOSchemaCode")),
        defaultValue: text(readAllControlField(tEntry, "DefaultValue")),
        displayRule: safeText(readAllControlField(tEntry, "DisplayRule")),
        defaultItems: Array.isArray(tDefaultItems) ? tDefaultItems : (tDefaultItems ? [tDefaultItems] : [])
      });
    }

    // 处理孤儿子表字段（sheetCode 在 containerEntries 中不存在的情况，比如主表单字段挂在 formId 或 appCode 下面）
    for (var sc in childrenBySheetCode) {
      if (!Object.prototype.hasOwnProperty.call(childrenBySheetCode, sc)) continue;
      var existing = containerEntries.some(function (e) { return e.key === sc; });
      if (!existing && childrenBySheetCode[sc].length > 0) {
        var orphanChildren = childrenBySheetCode[sc];
        for (var oi = 0; oi < orphanChildren.length; oi++) {
          controls.push({
            code: orphanChildren[oi].code,
            displayName: orphanChildren[oi].displayName,
            controlKey: orphanChildren[oi].controlKey,
            sheetCode: "",
            children: [],
            boschemaCode: orphanChildren[oi].boschemaCode,
            defaultValue: orphanChildren[oi].defaultValue,
            displayRule: orphanChildren[oi].displayRule,
            defaultItems: orphanChildren[oi].defaultItems || []
          });
        }
      }
    }

    return controls;
  }

  try {
    const params = pageParams();

    // 优先使用 Vue allControls 全局状态读取完整控件编码（含自定义编码），
    // 该方式直接读取设计器状态，不受 DOM 懒加载影响，编码最完整。
    const designerAllControls = findDesignerAllControls();
    if (designerAllControls && Object.keys(designerAllControls).length > 0) {
      const controls = extractControlsFromAllControls(designerAllControls, params);
      if (controls.length > 0) {
        return { ok: true, pageUrl: window.location.href, appCode: text(params.appcode), formId: text(params.id), controls, source: "allControls" };
      }
    }

    // 回退：通过 DOM 扫描 + Vue 状态遍历 + 编码目录回填获取控件编码（兜底逻辑）
    // 氚云设计器主表控件有两种常见结构：
    // 1. 早期版本：.control-container[data-code]
    // 2. 当前版本（如图）：.layout-control__item[data-code]
    // 为避免遗漏，使用 .designer.web [data-code] 并排除已知的非表单控件元素（如左侧工具栏）
    const designerRootForDom = document.querySelector(".designer.web");
    if (!designerRootForDom) {
      return { ok: true, pageUrl: window.location.href, appCode: text(params.appcode), formId: text(params.id), controls: [] };
    }
    const allDataCodeElements = Array.from(designerRootForDom.querySelectorAll("[data-code]"));
    // 只取主表控件元素（排除左侧工具栏、拖拽面板等非画布控件）：
    // - control-container：早期氚云版本
    // - layout-control__item：当前氚云版本
    // 子表控件 .sheet-control 不要在此处获取，由 childrenOf() 按子表容器递归获取，避免重复
    const controlElements = allDataCodeElements.filter((el) => {
      const className = String(el.className || "");
      return className.includes("control-container") ||
             className.includes("layout-control__item");
    });
    const sheetFieldCatalog = buildSheetFieldCodeCatalog(designerRootForDom);
    const controls = controlElements.map((item) => {
      const control = {
        code: text(item.dataset.code),
        controlKey: text(item.dataset.controlkey),
        displayName: text(item.dataset.displayname || item.getAttribute("title")),
        children: []
      };
      const rawChildren = childrenOf(item);
      const sheetFieldGroup = resolveSheetFieldGroup(sheetFieldCatalog, { ...control, children: rawChildren });
      control.sheetCode = sheetFieldGroup?.sheetCode || rawChildren.map((child) => sheetCodeFromFieldCode(child.code)).find(Boolean) || "";
      control.children = childrenOf(item, sheetFieldGroup);
      return control;
    });
    var diagnosticDomSnapshot = hasMissingChildCodes(controls) ? buildMissingCodeDomSnapshot(designerRootForDom, sheetFieldCatalog) : null;
    return { ok: true, pageUrl: window.location.href, appCode: text(params.appcode), formId: text(params.id), controls, _diagnosticDomSnapshot: diagnosticDomSnapshot };
  } catch (error) {
    return { ok: false, errorCode: "H3YUN_DESIGNER_METADATA_FAILED", details: error?.message || String(error), controls: [] };
  }
}
function getReadableAttribute(element, names) {
  for (const name of names) {
    const value = cleanInlineText(element.getAttribute?.(name));
    if (value) {
      return value;
    }
  }
  return "";
}

function pageCaptureMain(input) {
  const candidateNames = Array.isArray(input?.candidateComponentNames)
    ? input.candidateComponentNames.filter(Boolean)
    : ["editor"];

  function safePageUrl() {
    try {
      return window.location.href;
    } catch (_error) {
      return "";
    }
  }

  function createBaseResult(overrides) {
    return {
      ok: false,
      pageUrl: safePageUrl(),
      candidateCount: 0,
      discoveredComponentNames: [],
      ...overrides
    };
  }

  function nodeVisibleScore(element) {
    if (!(element instanceof Element)) {
      return { visible: false, area: 0, distance: Number.MAX_SAFE_INTEGER };
    }

    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const overlapWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const overlapHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    const area = overlapWidth * overlapHeight;
    const visible = area > 0;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(centerX - viewportWidth / 2) + Math.abs(centerY - viewportHeight / 2);
    return { visible, area, distance };
  }

  function sanitizeValue(value, seen = new WeakMap(), depth = 0) {
    if (depth > 12) {
      return "[MaxDepthExceeded]";
    }

    if (value === null) {
      return null;
    }

    const valueType = typeof value;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") {
      return value;
    }
    if (valueType === "undefined") {
      return "[undefined]";
    }
    if (valueType === "bigint") {
      return `${value.toString()}n`;
    }
    if (valueType === "function") {
      return `[Function ${value.name || "anonymous"}]`;
    }
    if (valueType === "symbol") {
      return value.toString();
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? "[Invalid Date]" : value.toISOString();
    }
    if (value instanceof RegExp) {
      return value.toString();
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack || ""
      };
    }
    if (value instanceof Node) {
      return `[DOMNode ${value.nodeName}]`;
    }
    if (seen.has(value)) {
      return `[Circular -> ${seen.get(value)}]`;
    }
    if (Array.isArray(value)) {
      seen.set(value, `array@${depth}`);
      return value.map((item) => sanitizeValue(item, seen, depth + 1));
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const name = value?.constructor?.name || "Object";
      seen.set(value, `${name}@${depth}`);
      const plainCopy = {};
      for (const key of Object.keys(value)) {
        plainCopy[key] = sanitizeValue(value[key], seen, depth + 1);
      }
      plainCopy.__type = name;
      return plainCopy;
    }

    seen.set(value, `object@${depth}`);
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = sanitizeValue(value[key], seen, depth + 1);
    }
    return result;
  }

  function getVue2Name(vm) {
    return (
      vm?.$options?.name ||
      vm?.$options?._componentTag ||
      vm?.$vnode?.componentOptions?.Ctor?.options?.name ||
      ""
    );
  }

  function getVue3Name(instance) {
    return instance?.type?.name || instance?.type?.__name || instance?.proxy?.$options?.name || "";
  }

  function getVue2Data(vm) {
    return vm?.$data;
  }

  function getVue3Data(instance) {
    return instance?.proxy?.$data;
  }

  const discoveredComponentNames = new Set();
  const candidateEntries = [];
  const visitedInstances = new WeakSet();
  let vueMajor;

  function addCandidate(entry) {
    if (!entry.instance || visitedInstances.has(entry.instance)) {
      return;
    }

    visitedInstances.add(entry.instance);
    if (entry.componentName) {
      discoveredComponentNames.add(entry.componentName);
    }

    if (!candidateNames.includes(entry.componentName)) {
      return;
    }

    candidateEntries.push({
      ...entry,
      score: nodeVisibleScore(entry.element)
    });
  }

  function scanElements() {
    const walker = document.createTreeWalker(
      document.documentElement || document.body,
      NodeFilter.SHOW_ELEMENT
    );
    let currentNode = walker.currentNode;

    while (currentNode) {
      if (currentNode.__vue__) {
        vueMajor = vueMajor || 2;
        addCandidate({
          vueMajor: 2,
          instance: currentNode.__vue__,
          componentName: getVue2Name(currentNode.__vue__),
          data: getVue2Data(currentNode.__vue__),
          element: currentNode
        });
      }

      if (currentNode.__vueParentComponent) {
        vueMajor = vueMajor || 3;
        addCandidate({
          vueMajor: 3,
          instance: currentNode.__vueParentComponent,
          componentName: getVue3Name(currentNode.__vueParentComponent),
          data: getVue3Data(currentNode.__vueParentComponent),
          element: currentNode
        });
      }

      currentNode = walker.nextNode();
    }
  }

  function walkVue3Tree(instance, hostElement, nestedVisited) {
    if (!instance || nestedVisited.has(instance)) {
      return;
    }

    nestedVisited.add(instance);
    vueMajor = vueMajor || 3;

    const element = instance.vnode?.el instanceof Element ? instance.vnode.el : hostElement;
    addCandidate({
      vueMajor: 3,
      instance,
      componentName: getVue3Name(instance),
      data: getVue3Data(instance),
      element
    });

    const subTreeChildren = [];
    if (instance.subTree?.component) {
      subTreeChildren.push(instance.subTree.component);
    }
    if (Array.isArray(instance.subTree?.children)) {
      for (const child of instance.subTree.children) {
        if (child?.component) {
          subTreeChildren.push(child.component);
        }
      }
    }
    if (instance.component) {
      subTreeChildren.push(instance.component);
    }

    for (const childInstance of subTreeChildren) {
      walkVue3Tree(childInstance, element, nestedVisited);
    }
  }

  function walkVue2Tree(vm, nestedVisited) {
    if (!vm || nestedVisited.has(vm)) {
      return;
    }

    nestedVisited.add(vm);
    vueMajor = vueMajor || 2;

    addCandidate({
      vueMajor: 2,
      instance: vm,
      componentName: getVue2Name(vm),
      data: getVue2Data(vm),
      element: vm.$el instanceof Element ? vm.$el : null
    });

    if (Array.isArray(vm.$children)) {
      for (const child of vm.$children) {
        walkVue2Tree(child, nestedVisited);
      }
    }
  }

  function scanVueRoots() {
    const vue3Visited = new WeakSet();
    const vue2Visited = new WeakSet();

    const allElements = document.querySelectorAll("*");
    for (const element of allElements) {
      if (element.__vue_app__?._instance) {
        walkVue3Tree(element.__vue_app__._instance, element, vue3Visited);
      }
      if (element.__vue__) {
        walkVue2Tree(element.__vue__, vue2Visited);
      }
    }
  }

  function firstReadableText(values) {
    for (const value of values) {
      const cleaned = String(value || "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned) {
        return cleaned;
      }
    }
    return "";
  }

  function splitChineseNames(rawText) {
    const text = firstReadableText([rawText]);
    if (!text) {
      return { applicationName: "", formName: "" };
    }

    const normalized = text
      .replace(/[>：]/g, "/")
      .replace(/[|~]/g, "/")
      .replace(/\s+-\s+/g, "/");
    const parts = normalized
      .split("/")
      .map((item) => item.trim())
      .filter(Boolean);

    if (parts.length >= 2) {
      return {
        applicationName: parts[0],
        formName: parts[1]
      };
    }

    return {
      applicationName: parts[0] || "",
      formName: parts[0] || ""
    };
  }

  function extractModelCodes(href) {
    const fallback = { applicationCode: "", formCode: "" };
    if (!href) {
      return fallback;
    }

    const decodedHref = decodeURIComponent(href);
    try {
      const url = new URL(decodedHref, window.location.href);
      const modelParam = url.searchParams.get("model");
      if (modelParam) {
        const parts = modelParam
          .split(/[/?#&=]/)
          .map((item) => item.trim())
          .filter(Boolean);
        if (parts.length >= 2) {
          return {
            applicationCode: parts[0],
            formCode: parts[1]
          };
        }
      }
    } catch (_error) {
      // Continue with token scan.
    }

    const tokens = decodedHref
      .split(/[/?#&=]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const modelIndex = tokens.findIndex((token) => token.toLowerCase() === "model");
    if (modelIndex >= 0) {
      return {
        applicationCode: tokens[modelIndex + 1] || "",
        formCode: tokens[modelIndex + 2] || ""
      };
    }

    return fallback;
  }

  function extractLinkMetadata() {
    const seenLinks = new Set();
    const linkRecords = [];
    for (const anchor of document.querySelectorAll("a[href]")) {
      const href = firstReadableText([anchor.href, anchor.getAttribute("href")]);
      if (!href || seenLinks.has(href)) {
        continue;
      }
      seenLinks.add(href);

      const labelText = firstReadableText([
        anchor.textContent,
        anchor.title,
        anchor.getAttribute("aria-label")
      ]);
      const names = splitChineseNames(labelText);
      const codes = extractModelCodes(href);
      linkRecords.push({
        href,
        linkText: labelText,
        applicationCode: codes.applicationCode,
        formCode: codes.formCode,
        applicationName: names.applicationName,
        formName: names.formName
      });
    }
    return linkRecords;
  }

  function findFormName() {
    const selectorCandidates = [
      "[data-form-name]",
      ".form-title",
      ".sheet-title",
      ".header-title",
      ".title",
      "h1"
    ];

    for (const selector of selectorCandidates) {
      const element = document.querySelector(selector);
      const text = firstReadableText([
        element?.getAttribute?.("data-form-name"),
        element?.textContent,
        element?.title
      ]);
      if (text) {
        return text;
      }
    }

    return firstReadableText([document.title]);
  }

  function findCodeFromElement(element) {
    const codeAttributeNames = [
      "data-code",
      "code",
      "data-control-code",
      "data-field-code",
      "field-code",
      "data-schema-code",
      "schema-code",
      "data-bizpropertycode",
      "bizpropertycode"
    ];

    const code = firstReadableText(
      codeAttributeNames.map((name) => element.getAttribute?.(name))
    );
    if (!code) {
      return "";
    }
    return /^[A-Za-z0-9_-]{2,}$/.test(code) ? code : "";
  }

  function findNameFromElement(element) {
    return firstReadableText([
      element.getAttribute?.("data-name"),
      element.getAttribute?.("label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("placeholder"),
      element.textContent
    ]);
  }

  function looksLikeSubtableContainer(element) {
    const source = [
      element.id,
      element.className,
      element.getAttribute?.("data-name"),
      element.getAttribute?.("data-code"),
      element.getAttribute?.("title")
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");

    return /subtable|sub-table|detail|child|sheet|鏄庣粏|瀛愯〃/.test(source);
  }

  function extractControlsFromDom() {
    const mainControls = [];
    const subtablesMap = new Map();
    const seenControls = new Set();
    const elements = document.querySelectorAll("*");

    for (const element of elements) {
      const code = findCodeFromElement(element);
      if (!code) {
        continue;
      }

      const name = findNameFromElement(element);
      const subtableContainer = element.closest("*");
      let ownerTable = null;

      let currentParent = element.parentElement;
      while (currentParent) {
        if (looksLikeSubtableContainer(currentParent)) {
          ownerTable = currentParent;
          break;
        }
        currentParent = currentParent.parentElement;
      }

      if (ownerTable) {
        const tableCode = findCodeFromElement(ownerTable) || firstReadableText([ownerTable.id]);
        const tableName = findNameFromElement(ownerTable) || tableCode;
        if (!tableCode) {
          continue;
        }
        const tableKey = `${tableCode}|${tableName}`;
        if (!subtablesMap.has(tableKey)) {
          subtablesMap.set(tableKey, {
            code: tableCode,
            name: tableName,
            controls: []
          });
        }
        const controlKey = `sub:${tableCode}:${code}:${name}`;
        if (!seenControls.has(controlKey)) {
          seenControls.add(controlKey);
          subtablesMap.get(tableKey).controls.push({ code, name });
        }
        continue;
      }

      const controlKey = `main:${code}:${name}`;
      if (seenControls.has(controlKey)) {
        continue;
      }
      seenControls.add(controlKey);
      mainControls.push({ code, name });
      void subtableContainer;
    }

    return {
      mainControls,
      subtables: Array.from(subtablesMap.values())
    };
  }

  function extractControlsFromData(rawData) {
    const mainControls = [];
    const subtablesMap = new Map();
    const seen = new WeakSet();
    const controlKeys = new Set();

    function getCode(candidate) {
      if (!candidate || typeof candidate !== "object") {
        return "";
      }
      return firstReadableText([
        candidate.code,
        candidate.schemaCode,
        candidate.fieldCode,
        candidate.bizPropertyCode,
        candidate.propertyCode
      ]);
    }

    function getName(candidate) {
      if (!candidate || typeof candidate !== "object") {
        return "";
      }
      return firstReadableText([
        candidate.name,
        candidate.label,
        candidate.title,
        candidate.text,
        candidate.displayName,
        candidate.chName
      ]);
    }

    function looksLikeSubtable(candidate) {
      const marker = firstReadableText([
        candidate?.type,
        candidate?.componentType,
        candidate?.widgetType,
        candidate?.controlType,
        candidate?.name,
        candidate?.label
      ]).toLowerCase();
      return /subtable|detail|child|sheet|鏄庣粏|瀛愯〃/.test(marker);
    }

    function walk(node, currentSubtable = null, depth = 0) {
      if (!node || typeof node !== "object" || depth > 10) {
        return;
      }
      if (seen.has(node)) {
        return;
      }
      seen.add(node);

      const nextSubtable =
        looksLikeSubtable(node) && getCode(node)
          ? {
              code: getCode(node),
              name: getName(node) || getCode(node)
            }
          : currentSubtable;

      const code = getCode(node);
      const name = getName(node);
      if (code && name) {
        if (nextSubtable && nextSubtable.code === code) {
          // Skip the container itself.
        } else if (nextSubtable) {
          if (!subtablesMap.has(nextSubtable.code)) {
            subtablesMap.set(nextSubtable.code, {
              code: nextSubtable.code,
              name: nextSubtable.name,
              controls: []
            });
          }
          const key = `sub:${nextSubtable.code}:${code}:${name}`;
          if (!controlKeys.has(key)) {
            controlKeys.add(key);
            subtablesMap.get(nextSubtable.code).controls.push({ code, name });
          }
        } else {
          const key = `main:${code}:${name}`;
          if (!controlKeys.has(key)) {
            controlKeys.add(key);
            mainControls.push({ code, name });
          }
        }
      }

      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            walk(item, nextSubtable, depth + 1);
          }
        } else if (value && typeof value === "object") {
          walk(value, nextSubtable, depth + 1);
        }
      }
    }

    walk(rawData);
    return {
      mainControls,
      subtables: Array.from(subtablesMap.values())
    };
  }

  function dedupeControls(controls) {
    const seen = new Set();
    return controls.filter((control) => {
      const code = firstReadableText([control?.code]);
      const name = firstReadableText([control?.name]);
      if (!code) {
        return false;
      }
      const key = `${code}|${name}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      control.code = code;
      control.name = name;
      return true;
    });
  }

  function mergeMetadata(selectedData) {
    const domMetadata = extractControlsFromDom();
    const dataMetadata = extractControlsFromData(selectedData);
    const subtablesMap = new Map();

    for (const table of [...domMetadata.subtables, ...dataMetadata.subtables]) {
      const code = firstReadableText([table?.code]);
      if (!code) {
        continue;
      }
      if (!subtablesMap.has(code)) {
        subtablesMap.set(code, {
          code,
          name: firstReadableText([table?.name]) || code,
          controls: []
        });
      }
      subtablesMap.get(code).controls.push(...(table.controls || []));
    }

    return {
      formName: findFormName(),
      links: extractLinkMetadata(),
      mainControls: dedupeControls([...domMetadata.mainControls, ...dataMetadata.mainControls]),
      subtables: Array.from(subtablesMap.values()).map((table) => ({
        code: table.code,
        name: table.name,
        controls: dedupeControls(table.controls || [])
      }))
    };
  }

  try {
    scanElements();
    scanVueRoots();
  } catch (error) {
    return createBaseResult({
      errorCode: "NO_VUE_ROOT",
      details: error?.message || String(error),
      vueMajor,
      discoveredComponentNames: Array.from(discoveredComponentNames).sort()
    });
  }

  if (!discoveredComponentNames.size && !candidateEntries.length) {
    return createBaseResult({
      errorCode: "NO_VUE_ROOT",
      details: "页面上未发现可访问的 Vue 组件入口。"
    });
  }

  candidateEntries.sort((left, right) => {
    if (left.score.visible !== right.score.visible) {
      return left.score.visible ? -1 : 1;
    }
    if (left.score.area !== right.score.area) {
      return right.score.area - left.score.area;
    }
    return left.score.distance - right.score.distance;
  });

  if (!candidateEntries.length) {
    return createBaseResult({
      errorCode: "NO_EDITOR_FOUND",
      vueMajor,
      discoveredComponentNames: Array.from(discoveredComponentNames).sort(),
      details: `未匹配到候选组件名：${candidateNames.join(", ")}`
    });
  }

  const selected = candidateEntries[0];
  if (typeof selected.data === "undefined") {
    return createBaseResult({
      errorCode: "NO_DATA",
      vueMajor: selected.vueMajor,
      candidateCount: candidateEntries.length,
      matchedComponentName: selected.componentName,
      discoveredComponentNames: Array.from(discoveredComponentNames).sort(),
      details: "目标组件存在，但未暴露公开的 $data。"
    });
  }

  try {
    const sanitizedData = sanitizeValue(selected.data);
    return {
      ok: true,
      pageUrl: safePageUrl(),
      vueMajor: selected.vueMajor,
      matchedComponentName: selected.componentName,
      candidateCount: candidateEntries.length,
      data: sanitizedData,
      metadata: mergeMetadata(sanitizedData),
      discoveredComponentNames: Array.from(discoveredComponentNames).sort()
    };
  } catch (error) {
    return createBaseResult({
      errorCode: "SERIALIZE_FAILED",
      vueMajor: selected.vueMajor,
      candidateCount: candidateEntries.length,
      matchedComponentName: selected.componentName,
      discoveredComponentNames: Array.from(discoveredComponentNames).sort(),
      details: error?.message || String(error)
    });
  }
}

function pageWritebackMain(input) {
  const candidateNames = Array.isArray(input?.candidateComponentNames)
    ? input.candidateComponentNames.filter(Boolean)
    : ["editor"];
  const codeEntries = Array.isArray(input?.codeEntries) ? input.codeEntries : [];
  const skippedKeys = Array.isArray(input?.skippedKeys) ? input.skippedKeys : [];

  function safePageUrl() {
    try {
      return window.location.href;
    } catch (_error) {
      return "";
    }
  }

  function createBaseResult(overrides) {
    return {
      ok: false,
      pageUrl: safePageUrl(),
      candidateCount: 0,
      updatedKeys: [],
      skippedKeys,
      discoveredComponentNames: [],
      ...overrides
    };
  }

  function nodeVisibleScore(element) {
    if (!(element instanceof Element)) {
      return { visible: false, area: 0, distance: Number.MAX_SAFE_INTEGER };
    }

    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const overlapWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const overlapHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    const area = overlapWidth * overlapHeight;
    const visible = area > 0;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(centerX - viewportWidth / 2) + Math.abs(centerY - viewportHeight / 2);
    return { visible, area, distance };
  }

  function getVue2Name(vm) {
    return (
      vm?.$options?.name ||
      vm?.$options?._componentTag ||
      vm?.$vnode?.componentOptions?.Ctor?.options?.name ||
      ""
    );
  }

  function getVue3Name(instance) {
    return instance?.type?.name || instance?.type?.__name || instance?.proxy?.$options?.name || "";
  }

  function getVue2Data(vm) {
    return vm?.$data;
  }

  function getVue3Data(instance) {
    return instance?.proxy?.$data;
  }

  const discoveredComponentNames = new Set();
  const candidateEntries = [];
  const visitedInstances = new WeakSet();
  let vueMajor;

  function addCandidate(entry) {
    if (!entry.instance || visitedInstances.has(entry.instance)) {
      return;
    }

    visitedInstances.add(entry.instance);
    if (entry.componentName) {
      discoveredComponentNames.add(entry.componentName);
    }

    if (!candidateNames.includes(entry.componentName)) {
      return;
    }

    candidateEntries.push({
      ...entry,
      score: nodeVisibleScore(entry.element)
    });
  }

  function scanElements() {
    const walker = document.createTreeWalker(
      document.documentElement || document.body,
      NodeFilter.SHOW_ELEMENT
    );
    let currentNode = walker.currentNode;

    while (currentNode) {
      if (currentNode.__vue__) {
        vueMajor = vueMajor || 2;
        addCandidate({
          vueMajor: 2,
          instance: currentNode.__vue__,
          componentName: getVue2Name(currentNode.__vue__),
          data: getVue2Data(currentNode.__vue__),
          element: currentNode
        });
      }

      if (currentNode.__vueParentComponent) {
        vueMajor = vueMajor || 3;
        addCandidate({
          vueMajor: 3,
          instance: currentNode.__vueParentComponent,
          componentName: getVue3Name(currentNode.__vueParentComponent),
          data: getVue3Data(currentNode.__vueParentComponent),
          element: currentNode
        });
      }

      currentNode = walker.nextNode();
    }
  }

  function walkVue3Tree(instance, hostElement, nestedVisited) {
    if (!instance || nestedVisited.has(instance)) {
      return;
    }

    nestedVisited.add(instance);
    vueMajor = vueMajor || 3;

    const element = instance.vnode?.el instanceof Element ? instance.vnode.el : hostElement;
    addCandidate({
      vueMajor: 3,
      instance,
      componentName: getVue3Name(instance),
      data: getVue3Data(instance),
      element
    });

    const subTreeChildren = [];
    if (instance.subTree?.component) {
      subTreeChildren.push(instance.subTree.component);
    }
    if (Array.isArray(instance.subTree?.children)) {
      for (const child of instance.subTree.children) {
        if (child?.component) {
          subTreeChildren.push(child.component);
        }
      }
    }
    if (instance.component) {
      subTreeChildren.push(instance.component);
    }

    for (const childInstance of subTreeChildren) {
      walkVue3Tree(childInstance, element, nestedVisited);
    }
  }

  function walkVue2Tree(vm, nestedVisited) {
    if (!vm || nestedVisited.has(vm)) {
      return;
    }

    nestedVisited.add(vm);
    vueMajor = vueMajor || 2;

    addCandidate({
      vueMajor: 2,
      instance: vm,
      componentName: getVue2Name(vm),
      data: getVue2Data(vm),
      element: vm.$el instanceof Element ? vm.$el : null
    });

    if (Array.isArray(vm.$children)) {
      for (const child of vm.$children) {
        walkVue2Tree(child, nestedVisited);
      }
    }
  }

  function scanVueRoots() {
    const vue3Visited = new WeakSet();
    const vue2Visited = new WeakSet();

    const allElements = document.querySelectorAll("*");
    for (const element of allElements) {
      if (element.__vue_app__?._instance) {
        walkVue3Tree(element.__vue_app__._instance, element, vue3Visited);
      }
      if (element.__vue__) {
        walkVue2Tree(element.__vue__, vue2Visited);
      }
    }
  }

  function ensureCodesTarget(selected) {
    if (selected.vueMajor === 2) {
      const vm = selected.instance;
      const data = vm?.$data;
      if (!data || typeof data !== "object") {
        return { ok: false, errorCode: "NO_DATA" };
      }

      if (!data.codes || typeof data.codes !== "object" || Array.isArray(data.codes)) {
        if (typeof vm?.$set === "function") {
          vm.$set(data, "codes", {});
        } else {
          data.codes = {};
        }
      }

      if (!data.codes || typeof data.codes !== "object" || Array.isArray(data.codes)) {
        return { ok: false, errorCode: "NO_DATA_CODES_TARGET" };
      }

      return { ok: true, target: data.codes };
    }

    const data = selected.instance?.proxy?.$data;
    if (!data || typeof data !== "object") {
      return { ok: false, errorCode: "NO_DATA" };
    }

    if (!data.codes || typeof data.codes !== "object" || Array.isArray(data.codes)) {
      data.codes = {};
    }

    if (!data.codes || typeof data.codes !== "object" || Array.isArray(data.codes)) {
      return { ok: false, errorCode: "NO_DATA_CODES_TARGET" };
    }

    return { ok: true, target: data.codes };
  }

  function ensureWebIDEServiceCompatibility(selected) {
    const vm = selected?.vueMajor === 2 ? selected?.instance : selected?.instance?.proxy;
    const serviceCandidates = [
      vm?.webIDEService,
      selected?.instance?.webIDEService,
      selected?.instance?.proxy?.webIDEService,
      vm?.$data?.webIDEService
    ].filter(Boolean);

    for (const service of serviceCandidates) {
      if (typeof service.updateDataSource === "function") {
        return { shimmed: false, fallbackMethod: "" };
      }

      const fallbackMethod = [
        "updateDatasource",
        "setDataSource",
        "syncDataSource",
        "refreshDataSource"
      ].find((name) => typeof service[name] === "function");

      if (fallbackMethod) {
        service.updateDataSource = (...args) => service[fallbackMethod](...args);
        return { shimmed: true, fallbackMethod };
      }

      service.updateDataSource = () => undefined;
      return { shimmed: true, fallbackMethod: "noop" };
    }

    return { shimmed: false, fallbackMethod: "" };
  }

  try {
    scanElements();
    scanVueRoots();
  } catch (error) {
    return createBaseResult({
      errorCode: "NO_VUE_ROOT",
      details: error?.message || String(error),
      vueMajor,
      discoveredComponentNames: Array.from(discoveredComponentNames).sort()
    });
  }

  if (!discoveredComponentNames.size && !candidateEntries.length) {
    return createBaseResult({
      errorCode: "NO_VUE_ROOT",
      details: "页面上未发现可访问的 Vue 组件入口。"
    });
  }

  candidateEntries.sort((left, right) => {
    if (left.score.visible !== right.score.visible) {
      return left.score.visible ? -1 : 1;
    }
    if (left.score.area !== right.score.area) {
      return right.score.area - left.score.area;
    }
    return left.score.distance - right.score.distance;
  });

  if (!candidateEntries.length) {
    return createBaseResult({
      errorCode: "NO_EDITOR_FOUND",
      vueMajor,
      discoveredComponentNames: Array.from(discoveredComponentNames).sort(),
      details: `未匹配到候选组件名：${candidateNames.join(", ")}`
    });
  }

  if (!codeEntries.length) {
    return createBaseResult({
      errorCode: "NO_IMPORTABLE_CODE_FILES",
      vueMajor,
      candidateCount: candidateEntries.length,
      matchedComponentName: candidateEntries[0].componentName,
      discoveredComponentNames: Array.from(discoveredComponentNames).sort(),
      details: "没有可回写的代码文件内容。"
    });
  }

  const selected = candidateEntries[0];
  const codesTargetResult = ensureCodesTarget(selected);
  if (!codesTargetResult.ok) {
    return createBaseResult({
      errorCode: codesTargetResult.errorCode,
      vueMajor: selected.vueMajor,
      candidateCount: candidateEntries.length,
      matchedComponentName: selected.componentName,
      discoveredComponentNames: Array.from(discoveredComponentNames).sort(),
      details:
        codesTargetResult.errorCode === "NO_DATA"
          ? "目标组件存在，但未暴露公开的 $data。"
          : "目标组件的 $data.codes 无法建立为可写对象。"
    });
  }

  const compatibilityState = ensureWebIDEServiceCompatibility(selected);

  try {
    const updatedKeys = [];
    for (const entry of codeEntries) {
      if (selected.vueMajor === 2 && typeof selected.instance?.$set === "function") {
        selected.instance.$set(codesTargetResult.target, entry.key, entry.content);
      } else {
        codesTargetResult.target[entry.key] = entry.content;
      }
      updatedKeys.push(entry.key);
    }

    return {
      ok: true,
      pageUrl: safePageUrl(),
      vueMajor: selected.vueMajor,
      matchedComponentName: selected.componentName,
      candidateCount: candidateEntries.length,
      updatedKeys,
      skippedKeys,
      compatibilityState,
      discoveredComponentNames: Array.from(discoveredComponentNames).sort()
    };
  } catch (error) {
    return createBaseResult({
      errorCode: "WRITEBACK_FAILED",
      vueMajor: selected.vueMajor,
      candidateCount: candidateEntries.length,
      matchedComponentName: selected.componentName,
      discoveredComponentNames: Array.from(discoveredComponentNames).sort(),
      details: error?.message || String(error)
    });
  }
}

function bizRuleProbeMain(input = {}) {
  function safePageUrl() {
    try {
      return window.location.href;
    } catch (_error) {
      return "";
    }
  }

  function createBaseResult(overrides) {
    return {
      ok: false,
      pageUrl: safePageUrl(),
      hasMonacoGlobal: false,
      editorCount: 0,
      modelCount: 0,
      language: "",
      uri: "",
      sourceLength: 0,
      sourceContent: "",
      className: "",
      fileName: "",
      sampleText: "",
      details: [],
      ...overrides
    };
  }

  function extractFileNameFromUri(uri) {
    const normalized = String(uri || "").trim();
    if (!normalized) {
      return "";
    }

    const match = normalized.match(/\/([^/?#]+\.java)(?:[?#].*)?$/i);
    return match ? match[1] : "";
  }

  function extractJavaClassName(source) {
    const text = String(source || "");
    const publicMatch = text.match(/\bpublic\s+class\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (publicMatch) {
      return publicMatch[1];
    }

    const classMatch = text.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    return classMatch ? classMatch[1] : "";
  }

  function collectCandidateModels(editors, models) {
    const candidateModels = [];
    const seenModels = new Set();

    for (const editor of editors) {
      const model = typeof editor?.getModel === "function" ? editor.getModel() : null;
      if (model && !seenModels.has(model)) {
        candidateModels.push(model);
        seenModels.add(model);
      }
    }

    for (const model of models) {
      if (model && !seenModels.has(model)) {
        candidateModels.push(model);
        seenModels.add(model);
      }
    }

    return candidateModels;
  }

  function collectBizRuleFileNames(candidateModels) {
    const fileNames = [];
    const seenFileNames = new Set();

    for (const model of candidateModels) {
      const uriFileName = extractFileNameFromUri(model?.uri?.toString?.() || "");
      const language = typeof model?.getLanguageId === "function" ? model.getLanguageId() : "";
      if (!uriFileName && language !== "java") {
        continue;
      }

      const source = typeof model?.getValue === "function" ? String(model.getValue() || "") : "";
      const className = extractJavaClassName(source);
      const fileName = uriFileName || (className ? `${className}.java` : "");
      if (fileName && !seenFileNames.has(fileName)) {
        fileNames.push(fileName);
        seenFileNames.add(fileName);
      }
    }

    return fileNames;
  }

  try {
    const multiModelHint = String(input?.multiModelHint || "").trim()
      || "业务规则限制：同一页面同时只支持一个业务规则编辑器，请先关闭多余业务规则后再重试。";
    const monaco = window.monaco;
    if (!monaco?.editor) {
      return createBaseResult({
        errorCode: "NO_MONACO_GLOBAL",
        details: ["window.monaco.editor 不存在"]
      });
    }

    const editors = typeof monaco.editor.getEditors === "function"
      ? monaco.editor.getEditors().filter(Boolean)
      : [];
    const models = typeof monaco.editor.getModels === "function"
      ? monaco.editor.getModels().filter(Boolean)
      : [];
    const candidateModels = collectCandidateModels(editors, models);
    const details = [];
    const bizRuleFileNames = collectBizRuleFileNames(candidateModels);
    const model = candidateModels.find((candidateModel) => {
      const uriFileName = extractFileNameFromUri(candidateModel?.uri?.toString?.() || "");
      const language = typeof candidateModel?.getLanguageId === "function"
        ? candidateModel.getLanguageId()
        : "";
      return Boolean(uriFileName) || language === "java";
    }) || candidateModels[0] || null;

    // 业务规则回写依赖页面内只存在一个有效 Java model，多开时必须先阻止继续抓取。
    if (bizRuleFileNames.length > 1) {
      return createBaseResult({
        errorCode: "MULTIPLE_BIZRULE_MODELS",
        hasMonacoGlobal: true,
        editorCount: editors.length,
        modelCount: models.length,
        details: [
          `当前页面检测到多个业务规则文件：${bizRuleFileNames.join("、")}`,
          multiModelHint
        ]
      });
    }

    if (!model) {
      return createBaseResult({
        errorCode: "NO_MONACO_MODEL",
        hasMonacoGlobal: true,
        editorCount: editors.length,
        modelCount: models.length,
        details: details.concat("未找到可用的 Monaco model")
      });
    }

    details.push("已收集到当前页面候选 Monaco model");

    if (typeof model.getValue !== "function") {
      return createBaseResult({
        errorCode: "MODEL_NOT_READABLE",
        hasMonacoGlobal: true,
        editorCount: editors.length,
        modelCount: models.length,
        details: details.concat("Monaco model 不支持getValue()")
      });
    }

    const source = String(model.getValue() || "");
    const sampleText = source.slice(0, 300);
    const language = typeof model.getLanguageId === "function" ? model.getLanguageId() : "";
    const uri = model.uri?.toString?.() || "";
    const className = extractJavaClassName(source);
    const uriFileName = extractFileNameFromUri(uri);
    const fileName = uriFileName || (className ? `${className}.java` : "");
    details.push(source ? "已读取到源代码文本" : "源代码文本为空");
    if (uriFileName) {
      details.push("已从 model URI 解析文件名");
    } else if (className) {
      details.push("已从源代码类名回退解析文件名");
    } else {
      details.push("未解析到业务规则文件名");
    }

    return {
      ok: true,
      pageUrl: safePageUrl(),
      hasMonacoGlobal: true,
      editorCount: editors.length,
      modelCount: models.length,
      language,
      uri,
      sourceLength: source.length,
      sourceContent: source,
      className,
      fileName,
      sampleText,
      details
    };
  } catch (error) {
    return createBaseResult({
      errorCode: "MONACO_PROBE_FAILED",
      details: [error?.message || String(error)]
    });
  }
}

function bizRuleWritebackMain(input) {
  function safePageUrl() {
    try {
      return window.location.href;
    } catch (_error) {
      return "";
    }
  }

  function createBaseResult(overrides) {
    return {
      ok: false,
      pageUrl: safePageUrl(),
      hasMonacoGlobal: false,
      editorCount: 0,
      modelCount: 0,
      language: "",
      uri: "",
      sourceLength: 0,
      fileName: "",
      details: [],
      ...overrides
    };
  }

  function extractFileNameFromUri(uri) {
    const normalized = String(uri || "").trim();
    if (!normalized) {
      return "";
    }

    const match = normalized.match(/\/([^/?#]+\.java)(?:[?#].*)?$/i);
    return match ? match[1] : "";
  }

  function extractJavaClassName(source) {
    const text = String(source || "");
    const publicMatch = text.match(/\bpublic\s+class\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (publicMatch) {
      return publicMatch[1];
    }

    const classMatch = text.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    return classMatch ? classMatch[1] : "";
  }

  function collectBizRuleFileNames(candidateModels) {
    const fileNames = [];
    const seenFileNames = new Set();

    for (const model of candidateModels) {
      const uriFileName = extractFileNameFromUri(model?.uri?.toString?.() || "");
      const language = typeof model?.getLanguageId === "function" ? model.getLanguageId() : "";
      if (!uriFileName && language !== "java") {
        continue;
      }

      const source = typeof model?.getValue === "function" ? String(model.getValue() || "") : "";
      const className = extractJavaClassName(source);
      const fileName = uriFileName || (className ? `${className}.java` : "");
      if (fileName && !seenFileNames.has(fileName)) {
        fileNames.push(fileName);
        seenFileNames.add(fileName);
      }
    }

    return fileNames;
  }

  try {
    const fileName = String(input?.fileName || "").trim();
    const sourceContent = String(input?.sourceContent ?? "");
    const multiModelHint = String(input?.multiModelHint || "").trim()
      || "业务规则限制：同一页面同时只支持一个业务规则编辑器，请先关闭多余业务规则后再重试。";
    if (!fileName) {
      return createBaseResult({
        errorCode: "MISSING_FILE_NAME",
        details: ["未提供待回写的业务规则文件名"]
      });
    }

    const monaco = window.monaco;
    if (!monaco?.editor) {
      return createBaseResult({
        errorCode: "NO_MONACO_GLOBAL",
        details: ["window.monaco.editor 不存在"]
      });
    }

    const editors = typeof monaco.editor.getEditors === "function"
      ? monaco.editor.getEditors().filter(Boolean)
      : [];
    const models = typeof monaco.editor.getModels === "function"
      ? monaco.editor.getModels().filter(Boolean)
      : [];
    const details = [];
    const candidateModels = [];
    const seenModels = new Set();

    for (const editor of editors) {
      const model = typeof editor?.getModel === "function" ? editor.getModel() : null;
      if (model && !seenModels.has(model)) {
        candidateModels.push(model);
        seenModels.add(model);
      }
    }

    for (const model of models) {
      if (model && !seenModels.has(model)) {
        candidateModels.push(model);
        seenModels.add(model);
      }
    }

    const bizRuleFileNames = collectBizRuleFileNames(candidateModels);

    if (!candidateModels.length) {
      return createBaseResult({
        errorCode: "NO_MONACO_MODEL",
        hasMonacoGlobal: true,
        editorCount: editors.length,
        modelCount: models.length,
        details: ["未找到可写入的 Monaco model"]
      });
    }

    // 同页存在多个业务规则时，按文件名回写会命中错误 model，这里直接中断并提示用户排查。
    if (bizRuleFileNames.length > 1) {
      return createBaseResult({
        errorCode: "MULTIPLE_BIZRULE_MODELS",
        hasMonacoGlobal: true,
        editorCount: editors.length,
        modelCount: models.length,
        fileName,
        details: [
          `当前页面检测到多个业务规则文件：${bizRuleFileNames.join("、")}`,
          multiModelHint
        ]
      });
    }

    const matchedModel = candidateModels.find((model) => {
      const uri = model?.uri?.toString?.() || "";
      return extractFileNameFromUri(uri) === fileName;
    });

    if (!matchedModel) {
      return createBaseResult({
        errorCode: "TARGET_MODEL_NOT_FOUND",
        hasMonacoGlobal: true,
        editorCount: editors.length,
        modelCount: models.length,
        fileName,
        details: [`未找到文件名匹配 ${fileName} 的 Monaco model`]
      });
    }

    if (typeof matchedModel.setValue !== "function") {
      return createBaseResult({
        errorCode: "MODEL_NOT_WRITABLE",
        hasMonacoGlobal: true,
        editorCount: editors.length,
        modelCount: models.length,
        fileName,
        uri: matchedModel?.uri?.toString?.() || "",
        details: ["目标 Monaco model 不支持 setValue()"]
      });
    }

    matchedModel.setValue(sourceContent);
    details.push("已通过 model.setValue() 完整替换业务规则源码");

    return {
      ok: true,
      pageUrl: safePageUrl(),
      hasMonacoGlobal: true,
      editorCount: editors.length,
      modelCount: models.length,
      language: typeof matchedModel.getLanguageId === "function" ? matchedModel.getLanguageId() : "",
      uri: matchedModel?.uri?.toString?.() || "",
      sourceLength: sourceContent.length,
      fileName,
      details
    };
  } catch (error) {
    return createBaseResult({
      errorCode: "WRITEBACK_FAILED",
      fileName: String(input?.fileName || "").trim(),
      details: [error?.message || String(error)]
    });
  }
}

// ========== 文件选择器弹层 ==========

/**
 * 收集文件选择器弹层中用户勾选的一次性额外生成文件。
 * 仅本次写入生效，不回写持久配置。
 */
function collectExtraDocs() {
  return {
    readme: extraReadmeCheck.checked,
    agents: extraAgentsCheck.checked,
    design: extraDesignCheck.checked
  };
}

/**
 * 根据当前配置重置文件选择器复选框到默认状态（按持久开关）。
 */
function resetFilePickerChecks() {
  const platformKey = currentPageContext?.pageTypeConfig?.platformKey;
  const generatedFiles = (currentConfig?.generatedFiles || {})[platformKey] || {};
  extraReadmeCheck.checked = generatedFiles.readme === true;
  extraAgentsCheck.checked = generatedFiles.agents === true;
  extraDesignCheck.checked = generatedFiles.design === true;
}

/**
 * 显示文件选择器弹层，返回 Promise 在用户确认/跳过时 resolve。
 * @returns {Promise<{extraDocs: object, confirmed: boolean}>}
 */
function showFilePicker(platformKey) {
  return new Promise((resolve) => {
    // 重置复选框到持久开关默认值
    const generatedFiles = (currentConfig?.generatedFiles || {})[platformKey] || {};
    extraReadmeCheck.checked = generatedFiles.readme === true;
    extraAgentsCheck.checked = generatedFiles.agents === true;
    extraDesignCheck.checked = generatedFiles.design === true;
    filePickerOverlay.hidden = false;

    // 确认按钮：以勾选值作为 extraDocs
    const onConfirm = () => {
      cleanup();
      resolve({ extraDocs: collectExtraDocs(), confirmed: true });
    };

    // 跳过按钮：直接写入，不带额外文件
    const onSkip = () => {
      cleanup();
      resolve({ extraDocs: {}, confirmed: false });
    };

    const cleanup = () => {
      filePickerOverlay.hidden = true;
      filePickerConfirmButton.removeEventListener("click", onConfirm);
      filePickerSkipButton.removeEventListener("click", onSkip);
    };

    filePickerConfirmButton.addEventListener("click", onConfirm);
    filePickerSkipButton.addEventListener("click", onSkip);
  });
}

/**
 * 有文件选择器的云枢抓取写入入口。
 * 先弹出文件选择器，用户确认后再执行抓取。
 */
async function handleCloudpivotCaptureWithFilePicker() {
  const platformKey = PLATFORM_CONFIG.cloudpivot.platformKey;
  const { extraDocs } = await showFilePicker(platformKey);
  await runWithButtonBusy(frontendCaptureWriteButton, () => handleCaptureAndWrite(extraDocs));
}

/**
 * 有文件选择器的云枢业务规则抓取写入入口。
 */
async function handleCloudpivotBizRuleCaptureWithFilePicker() {
  const platformKey = PLATFORM_CONFIG.cloudpivot.platformKey;
  const { extraDocs } = await showFilePicker(platformKey);
  await runWithButtonBusy(bizruleCaptureWriteButton, () => handleBizruleCaptureAndWrite(extraDocs));
}

/**
 * 有文件选择器的氚云抓取写入入口。
 */
async function handleH3yunCaptureWithFilePicker() {
  const platformKey = PLATFORM_CONFIG.h3yun.platformKey;
  const { extraDocs } = await showFilePicker(platformKey);
  await runWithButtonBusy(h3yunCaptureAllButton, () => handleH3yunCaptureAllAndWrite(extraDocs));
}

// ========== 氚云一键回写 ==========

/**
 * 氚云一键回写：顺序执行前端回写 + 后端回写，复用已有 handleH3yunCodeWriteback。
 * 任何一个回写失败均报告但继续执行另一个，最终汇总结果。
 */
/**
 * 氚云一键回写：顺序执行前端 + 后端回写。
 * handleH3yunCodeWriteback 已管理 busy 状态，此处仅做结果汇总。
 */
async function handleH3yunOneClickWriteback() {
  setStatus("正在一键回写氚云前后端...");
  const results = [];
  for (const codeKind of ["frontend", "backend"]) {
    try {
      await handleH3yunCodeWriteback(codeKind);
      results.push({ codeKind, ok: true });
    } catch (_error) {
      // handleH3yunCodeWriteback 已在内部设置了具体错误状态，此处仅记录失败
      results.push({ codeKind, ok: false });
    }
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    setStatus(`氚云一键回写部分失败：${failed.map((r) => r.codeKind).join("、")}`, {
      level: "error",
      suggestion: "处理建议：请确认前后端编辑器区域已加载；可尝试分别回写。"
    });
  }
}

// ========== 导出下拉 & 跨页监听 ==========

// tabs.onActivated 监听器引用，用于弹窗关闭时移除避免泄漏
let tabsActivatedListener = null;

/**
 * 活动标签切换时重新拉取 recentTargetDirectories 并渲染，实现跨网页历史目录同步。
 */
function setupCrossPageSync() {
  if (tabsActivatedListener) return;
  tabsActivatedListener = async () => {
    // 弹窗关闭时不再做任何操作
    if (!currentPageContext) return;
    const pageContext = await updatePageInfo({ syncPlatform: true });
    currentPageContext = pageContext;
    renderCurrentPageUrl(pageContext.tab);
    await updateDirectoryInfo(pageContext.pageType, pageContext.targetScope);
  };
  chrome.tabs.onActivated.addListener(tabsActivatedListener);
}

/**
 * 弹窗关闭时移除监听器避免泄漏。
 */
function teardownCrossPageSync() {
  if (tabsActivatedListener) {
    chrome.tabs.onActivated.removeListener(tabsActivatedListener);
    tabsActivatedListener = null;
  }
}
window.addEventListener("pagehide", teardownCrossPageSync);
window.addEventListener("unload", teardownCrossPageSync);

// ========== 事件监听 ==========

refreshHandleButton.addEventListener("click", () => runWithButtonBusy(refreshHandleButton, handleRefreshDirectoryHandle));
copyPathButton.addEventListener("click", () => runWithButtonBusy(copyPathButton, handleCopyTargetPath));

// 云枢抓取/回写：先弹出文件选择器
frontendCaptureWriteButton.addEventListener("click", handleCloudpivotCaptureWithFilePicker);
frontendWritebackButton.addEventListener("click", () => runWithButtonBusy(frontendWritebackButton, handleImportAndWriteBack));
bizruleCaptureWriteButton.addEventListener("click", handleCloudpivotBizRuleCaptureWithFilePicker);
bizruleWritebackButton.addEventListener("click", () => runWithButtonBusy(bizruleWritebackButton, handleBizruleWriteback));

launcherMainButton.addEventListener("click", () => runWithButtonBusy(launcherMainButton, () => handleOpenCustomLauncher()));
launcherMenuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setLauncherMenuOpen(!isLauncherMenuOpen);
});
launcherMenu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-launcher-id]");
  if (!button) { return; }
  event.preventDefault();
  runWithButtonBusy(button, () => handleOpenCustomLauncher(button.dataset.launcherId));
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("#launcher-control")) {
    setLauncherMenuOpen(false);
  }
  // 点击导出下拉外部关闭
  if (!event.target.closest("#export-dropdown")) {
    setExportDropdownOpen(false);
  }
});

openOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

// 导出下拉
exportDropdownButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleExportDropdown();
});
exportLogButton.addEventListener("click", handleExportRuntimeLog);
exportDiagnosticButton.addEventListener("click", handleExportDiagnosticPackage);

// 氚云操作
h3yunCaptureAllButton.addEventListener("click", handleH3yunCaptureWithFilePicker);
h3yunOneClickWritebackButton.addEventListener("click", () => runWithButtonBusy(h3yunOneClickWritebackButton, handleH3yunOneClickWriteback));
h3yunFrontendWritebackButton.addEventListener("click", () => runWithButtonBusy(h3yunFrontendWritebackButton, () => handleH3yunCodeWriteback("frontend")));
h3yunBackendWritebackButton.addEventListener("click", () => runWithButtonBusy(h3yunBackendWritebackButton, () => handleH3yunCodeWriteback("backend")));

// 文件选择器弹层
filePickerConfirmButton.addEventListener("click", () => {}); // 实际事件在 showFilePicker 中绑定
filePickerSkipButton.addEventListener("click", () => {});

for (const button of platformTabButtons) {
  button.addEventListener("click", handlePlatformTabClick);
}
pageOriginEl.addEventListener("click", handleCopyValue);

// 历史目录平铺列表
historyFlatItems.addEventListener("click", handleHistoryFlatListClick);
historyMoreButton.addEventListener("click", handleHistoryMoreClick);

copyLogButton.addEventListener("click", handleCopyRuntimeLog);

// ========== 初始化 ==========

async function init() {
  currentConfig = await loadConfig();
  renderLauncherControls(currentConfig);

  const pageContext = await updatePageInfo();
  currentPageContext = pageContext;
  renderCurrentPageUrl(pageContext.tab);
  const isDirectoryInfoReady = await updateDirectoryInfo(pageContext.pageType, pageContext.targetScope);

  // 跨网页历史目录同步：每次选择/更新目录即时落库
  setupCrossPageSync();

  // 按设置控制一键回写与独立前后端回写按钮显隐
  if (h3yunOneClickWritebackButton && h3yunSeparateWritebackRow) {
    const oneClickEnabled = currentConfig?.h3yunOneClickWriteback !== false;
    h3yunOneClickWritebackButton.hidden = !oneClickEnabled;
    h3yunSeparateWritebackRow.hidden = oneClickEnabled;
  }

  if (isDirectoryInfoReady) {
    setStatus("等待操作。", { level: "idle" });
  }
}

init().catch((error) => {
  setStatus(`初始化失败。
${error?.message || String(error)}`, { level: "error" });
});
