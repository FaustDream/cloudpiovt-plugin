import {
  CLOUDPIVOT_READONLY_SETTINGS,
  DEFAULT_CONFIG,
  DEFAULT_GENERATED_FILES,
  H3YUN_READONLY_SETTINGS,
  loadConfig,
  saveConfig
} from "../../lib/config.js";
import {
  applyDiscoveredLaunchers,
  createCustomLauncherDraft,
  getAvailableLaunchers,
  getDefaultArgumentsTemplate,
  getLauncherIconPath,
  normalizeCustomLaunchers,
  pinLauncher
} from "../../lib/services/custom-launchers.js";
import {
  CONTROL_TYPE_REFERENCE,
  H3YUN_CONTROL_TYPE_REFERENCE
} from "../../lib/platform/control-metadata.js";
import {
  deleteLauncherIcon,
  discoverNativeLaunchers,
  extractExecutableIcon,
  pickNativeDirectory,
  pickNativeEditor,
  probeNativeHost,
  saveLauncherIcon
} from "../../lib/services/native-host.js";
import { CURRENT_EXTENSION_VERSION, RELEASE_NOTES } from "../../lib/release-notes.js";
import { checkForUpdate, syncFromGit } from "../../lib/services/update-check.js";
import {
  PREFLIGHT_OPERATION_IDS,
  PREFLIGHT_SEVERITY,
  buildDiagnosticPackage,
  createPreflightResult,
  formatPreflightStatusLines,
  hasBlockingPreflightResult,
  loadLastDiagnosticPackage,
  saveLastDiagnosticPackage,
  summarizeDiagnosticPackage
} from "../../lib/services/preflight-diagnostics.js";

const saveButton = document.querySelector("#save-btn");
const resetButton = document.querySelector("#reset-btn");
const toolbarActions = document.querySelector("#toolbar-actions");
const mainTabButtons = Array.from(document.querySelectorAll("[data-main-tab]"));
const mainPanels = Array.from(document.querySelectorAll("[data-main-panel]"));
const autoCheckUpdatesField = document.querySelector("#auto-check-updates");
const h3yunOneClickWritebackField = document.querySelector("#h3yun-oneclick-writeback");
const checkUpdateButton = document.querySelector("#check-update-btn");
const syncUpdateButton = document.querySelector("#sync-update-btn");
const updateStatusOutput = document.querySelector("#update-status");
const discoverLaunchersButton = document.querySelector("#discover-launchers-btn");
const addLauncherButton = document.querySelector("#add-launcher-btn");
const launcherListEl = document.querySelector("#launcher-list");
const copyDiagnosticSummaryButton = document.querySelector("#copy-diagnostic-summary-btn");
const exportLastDiagnosticButton = document.querySelector("#export-last-diagnostic-btn");
const lastDiagnosticSummaryEl = document.querySelector("#last-diagnostic-summary");
const currentVersionEl = document.querySelector("#current-version");
const pathSummaryEl = document.querySelector("#path-summary");
const releaseNotesList = document.querySelector("#release-notes-list");
const cloudpivotReadonlyList = document.querySelector("#cloudpivot-readonly-settings-list");
const h3yunReadonlyList = document.querySelector("#h3yun-readonly-settings-list");
const cloudpivotControlTypeReferenceBody = document.querySelector("#cloudpivot-control-type-reference-body");
const h3yunControlTypeReferenceBody = document.querySelector("#h3yun-control-type-reference-body");
const nativeHostStatus = document.querySelector("#native-host-status");
const statusOutput = document.querySelector("#settings-status");
const docsTabButtons = Array.from(document.querySelectorAll("[data-docs-tab]"));
const docsPanels = Array.from(document.querySelectorAll("[data-docs-panel]"));
const platformTabButtons = Array.from(document.querySelectorAll("[data-platform-tab][data-platform-group]"));
const platformPanels = Array.from(document.querySelectorAll("[data-platform-panel][data-platform-group]"));
const defaultDirPlatformTabButtons = Array.from(document.querySelectorAll("[data-platform-tab][data-platform-group=\"default-dir\"]"));
const fallbackPathCloudpivotInput = document.querySelector("#fallback-path-cloudpivot");
const fallbackPathH3yunInput = document.querySelector("#fallback-path-h3yun");
const pickFallbackDirCloudpivotButton = document.querySelector("#pick-fallback-dir-cloudpivot");
const pickFallbackDirH3yunButton = document.querySelector("#pick-fallback-dir-h3yun");
// 帮助抽屉
const helpButton = document.querySelector("#help-btn");
const helpOverlay = document.querySelector("#help-overlay");
const helpCloseButton = document.querySelector("#help-close-btn");
// 文件生成配置
const genfilesCloudpivotTab = document.querySelector("#genfiles-cloudpivot-tab");
const genfilesH3yunTab = document.querySelector("#genfiles-h3yun-tab");
const genfilesCloudpivotGrid = document.querySelector("#genfiles-cloudpivot-grid");
const genfilesH3yunGrid = document.querySelector("#genfiles-h3yun-grid");
const genfilesPlatformTabButtons = Array.from(document.querySelectorAll("[data-platform-tab][data-platform-group=\"genfiles\"]"));
const genfilesPlatformPanels = Array.from(document.querySelectorAll("[data-platform-panel][data-platform-group=\"genfiles\"]"));

let activeDocsTabKey = "reference";
let activeDefaultDirTabKey = "cloudpivot";
let activeGenfilesTabKey = "cloudpivot";
let currentLaunchers = [];
let selectedLauncherId = "";
// 当前设置页的生成文件开关快照
let currentGeneratedFiles = DEFAULT_GENERATED_FILES;

function setStatus(message) {
  statusOutput.textContent = message;
}

function setUpdateStatus(message) {
  updateStatusOutput.textContent = message;
}

function setNativeHostStatus(message) {
  nativeHostStatus.textContent = message;
}

function buildDownloadTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function downloadJsonFile(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildExtensionDiagnosticContext() {
  return {
    extension: {
      name: chrome.runtime.getManifest().name,
      version: chrome.runtime.getManifest().version
    },
    browser: {
      userAgent: navigator.userAgent
    }
  };
}

function createNativeHostPreflightResult(hostStatus) {
  if (hostStatus.available) {
    return createPreflightResult({
      operationId: PREFLIGHT_OPERATION_IDS.updateSync,
      checkId: "nativeHost.ping",
      severity: PREFLIGHT_SEVERITY.info,
      ok: true,
      evidence: "native host available",
      data: hostStatus
    });
  }

  return createPreflightResult({
    operationId: PREFLIGHT_OPERATION_IDS.updateSync,
    checkId: "nativeHost.ping",
    severity: PREFLIGHT_SEVERITY.blocker,
    ok: false,
    errorCode: "NATIVE_HOST_UNAVAILABLE",
    evidence: hostStatus.error || "native host unavailable",
    nextAction: "重新运行 scripts\\install-native-host.cmd 后重试。",
    data: hostStatus
  });
}

function createUpdateOverwriteRiskResult() {
  return createPreflightResult({
    operationId: PREFLIGHT_OPERATION_IDS.updateSync,
    checkId: "update.gitResetRisk",
    severity: PREFLIGHT_SEVERITY.warning,
    ok: true,
    errorCode: "",
    evidence: "syncFromGit uses git reset --hard origin/master through Native Host",
    nextAction: "",
    data: {
      command: "git reset --hard origin/master"
    }
  });
}

async function renderLastDiagnosticSummary() {
  const packageData = await loadLastDiagnosticPackage();
  if (!packageData) {
    lastDiagnosticSummaryEl.textContent = "最近诊断：未生成";
    return null;
  }

  lastDiagnosticSummaryEl.textContent = [
    `最近诊断：${packageData.createdAt || "未知时间"}`,
    `operationId=${packageData.operationId || "unknown"}`
  ].join("；");
  return packageData;
}

// 版本号显示在顶部标题栏右侧指标中
function setVersionLabels() {
  currentVersionEl.textContent = CURRENT_EXTENSION_VERSION;
}

function renderPathSummary(config) {
  const availableCount = getAvailableLaunchers(config.customLaunchers).length;
  pathSummaryEl.textContent = availableCount ? `可用 ${availableCount} 个` : "未配置";
}

function formatUpdateCheckTime(value) {
  if (!value) {
    return "未检查";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function renderUpdateResult(result) {
  if (syncUpdateButton) {
    syncUpdateButton.hidden = true;
  }

  if (!result) {
    setUpdateStatus("尚未检查更新。");
    return;
  }

  if (!result.ok) {
    setUpdateStatus(
      [
        "检查更新失败。",
        `时间：${formatUpdateCheckTime(result.checkedAt)}`,
        `原因：${result.error || "未知错误"}`
      ].join("\n")
    );
    return;
  }

  // 同步完成提示：扩展文件已更新，需要重新加载才能生效
  if (result.synced) {
    setUpdateStatus(
      [
        "已从 Git 远程同步到最新版本。",
        `当前版本：${result.currentVersion || CURRENT_EXTENSION_VERSION}`,
        `同步时间：${formatUpdateCheckTime(result.checkedAt)}`,
        "请在 chrome://extensions 重新加载扩展以生效。"
      ].join("\n")
    );
    return;
  }

  const lines = [
    result.updateAvailable ? "发现新版本，可点击按钮同步更新。" : "当前已是最新版本。",
    `当前版本：${result.currentVersion || CURRENT_EXTENSION_VERSION}`,
    `远程版本：${result.latestVersion || "未知"}`,
    `检查时间：${formatUpdateCheckTime(result.checkedAt)}`
  ];

  if (result.updateAvailable && syncUpdateButton) {
    syncUpdateButton.hidden = false;
  }

  setUpdateStatus(lines.join("\n"));
}

// 设置页涉及保存配置和原生助手选择应用，按钮运行态用于提示用户当前动作仍在处理。
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

// 主标签切换：应用路径 / 默认目录 / 更新设置
function setActiveMainTab(tabKey) {
  for (const button of mainTabButtons) {
    const isActive = button.dataset.mainTab === tabKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }

  for (const panel of mainPanels) {
    const isActive = panel.dataset.mainPanel === tabKey;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  }

  // 所有标签均可编辑，始终显示工具栏
  toolbarActions.hidden = false;
}

function setActiveDocsTab(tabKey) {
  const normalizedTabKey = ["flow", "release"].includes(tabKey) ? tabKey : "reference";
  activeDocsTabKey = normalizedTabKey;

  // 说明中心用标签页承载说明内容，避免控件表格、流程和版本记录同时拉长设置页。
  for (const button of docsTabButtons) {
    const isActive = button.dataset.docsTab === normalizedTabKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }

  for (const panel of docsPanels) {
    const isActive = panel.dataset.docsPanel === normalizedTabKey;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  }
}

function setActivePlatform(groupKey, platformKey) {
  const normalizedGroupKey = groupKey === "flow" ? "flow" : "reference";
  const normalizedPlatformKey = platformKey === "h3yun" ? "h3yun" : "cloudpivot";

  // 平台标签按说明分组独立切换，控件参考和推荐流程可以各自保留用户最近查看的平台。
  for (const button of platformTabButtons) {
    if (button.dataset.platformGroup !== normalizedGroupKey) {
      continue;
    }
    const isActive = button.dataset.platformTab === normalizedPlatformKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }

  for (const panel of platformPanels) {
    if (panel.dataset.platformGroup !== normalizedGroupKey) {
      continue;
    }
    const isActive = panel.dataset.platformPanel === normalizedPlatformKey;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  }
}

/**
 * 默认目录区块用独立的平台标签切换云枢/氚云，不与说明中心的控件参考、推荐流程标签联动。
 */
function setActiveDefaultDirTab(platformKey) {
  const normalizedPlatformKey = platformKey === "h3yun" ? "h3yun" : "cloudpivot";
  activeDefaultDirTabKey = normalizedPlatformKey;

  for (const button of defaultDirPlatformTabButtons) {
    const isActive = button.dataset.platformTab === normalizedPlatformKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }

  const panels = document.querySelectorAll("[data-platform-group=\"default-dir\"][data-platform-panel]");
  for (const panel of panels) {
    const isActive = panel.dataset.platformPanel === normalizedPlatformKey;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  }
}

/**
 * 将配置中的兜底目录路径填入设置页输入框。
 */
function renderFallbackDirectoryPaths(fallbackDirectoryPaths) {
  fallbackPathCloudpivotInput.value = String(fallbackDirectoryPaths?.cloudpivot || "");
  fallbackPathH3yunInput.value = String(fallbackDirectoryPaths?.h3yun || "");
}

/**
 * 通过原生助手打开系统目录选择框，将用户选中的目录路径填入对应平台的输入框。
 * 原生助手不可用时提示用户手动粘贴路径。
 */
async function handlePickFallbackDirectory(platformKey) {
  const hostStatus = await probeNativeHost();
  if (!hostStatus.available) {
    setStatus("当前未安装原生助手，请先双击 scripts\\install-native-host.cmd；也可以临时手动粘贴目录路径后保存。");
    return;
  }

  const platformLabel = platformKey === "h3yun" ? "氚云" : "云枢";
  const inputEl = platformKey === "h3yun" ? fallbackPathH3yunInput : fallbackPathCloudpivotInput;
  const currentPath = String(inputEl?.value || "").trim();

  const response = await pickNativeDirectory(currentPath);
  if (!response?.ok) {
    if (response?.cancelled) {
      setStatus(`已取消选择${platformLabel}默认目录。`);
      return;
    }
    throw new Error(response?.error || `选择${platformLabel}默认目录失败。`);
  }

  const directoryPath = String(response.directoryPath || "").trim();
  if (!directoryPath) {
    throw new Error("原生助手未返回目录路径。");
  }

  inputEl.value = directoryPath;
  setStatus(`${platformLabel}默认目录已选择：${directoryPath}；点击保存设置后生效。`);
}

function renderReadonlyList(listElement, settings) {
  // 内置规则按平台分别渲染，后续调整某个平台说明时不会影响另一侧的维护语境。
  listElement.replaceChildren(
    ...settings.map((text) => {
      const item = document.createElement("li");
      item.className = "readonly-list-item";
      item.textContent = text;
      return item;
    })
  );
}

function renderReadonlySettings() {
  renderReadonlyList(cloudpivotReadonlyList, CLOUDPIVOT_READONLY_SETTINGS);
  renderReadonlyList(h3yunReadonlyList, H3YUN_READONLY_SETTINGS);
}

function renderReleaseNotes() {
  // 版本更新记录前置展示，用户无需翻提交历史就能判断当前版本是否包含目标修复。
  releaseNotesList.replaceChildren(
    ...RELEASE_NOTES.map((release) => {
      const article = document.createElement("article");
      article.className = "release-card";
      article.innerHTML = `
        <div class="release-card-head">
          <span class="release-version">v${release.version}</span>
          <h3>${release.title}</h3>
        </div>
        <ul>${release.items.map((item) => `<li>${item}</li>`).join("")}</ul>
      `;
      return article;
    })
  );
}

function renderCloudpivotControlTypeReference() {
  // 云枢字段控件说明来自在线开发 HTML 标签映射，服务云枢 FromCode.md 的字段控件核对。
  cloudpivotControlTypeReferenceBody.replaceChildren(
    ...CONTROL_TYPE_REFERENCE.map((controlType) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><code>${controlType.tagName}</code></td>
        <td>${controlType.typeName}</td>
        <td>${controlType.exampleName || "-"}</td>
        <td>${controlType.notes || "-"}</td>
      `;
      return row;
    })
  );
}

function renderH3yunControlTypeReference() {
  // 氚云控件参考来自 FromCode.md 的控件类型字段，用于核对抓取后的控件编码和类型是否一致。
  h3yunControlTypeReferenceBody.replaceChildren(
    ...H3YUN_CONTROL_TYPE_REFERENCE.map((controlType) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><code>${controlType.typeCode}</code></td>
        <td>${controlType.typeName}</td>
        <td>${controlType.exampleName || "-"}</td>
        <td>${controlType.notes || "-"}</td>
      `;
      return row;
    })
  );
}

function createTextInput({ label, value, placeholder, launcherId, fieldName, wide = false }) {
  const wrapper = document.createElement("label");
  wrapper.className = wide ? "field launcher-wide-field" : "field";
  const labelEl = document.createElement("span");
  labelEl.className = "field-label";
  labelEl.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.placeholder = placeholder || "";
  input.dataset.launcherId = launcherId;
  input.dataset.launcherField = fieldName;
  wrapper.append(labelEl, input);
  return wrapper;
}

function createLauncherButton(label, launcherId, action, options = {}) {
  const button = document.createElement("button");
  button.className = "ghost-btn";
  button.type = "button";
  button.textContent = label;
  button.dataset.launcherId = launcherId;
  button.dataset.launcherAction = action;
  if (options.disabled) {
    button.disabled = true;
  }
  return button;
}

function createLauncherIconUpload(launcher) {
  const label = document.createElement("label");
  label.className = "launcher-icon-upload";
  label.textContent = "上传图标";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/webp";
  input.dataset.launcherId = launcher.launcherId;
  input.dataset.launcherAction = "upload-icon";
  label.append(input);
  return label;
}

function createLauncherIcon(launcher, size = 48) {
  const icon = document.createElement("img");
  icon.className = "launcher-settings-icon";
  icon.src = getLauncherIconPath(launcher, size);
  icon.alt = "";
  return icon;
}

function renderLauncherNavButton(launcher) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "launcher-nav-button";
  button.dataset.launcherId = launcher.launcherId;
  button.dataset.launcherAction = "select";
  button.setAttribute("aria-pressed", launcher.launcherId === selectedLauncherId ? "true" : "false");
  if (launcher.pinned === true) {
    button.classList.add("is-pinned");
  }
  if (launcher.enabled !== true) {
    button.classList.add("is-disabled");
  }

  const icon = createLauncherIcon(launcher, 48);
  const copy = document.createElement("span");
  copy.className = "launcher-nav-copy";
  const name = document.createElement("strong");
  name.textContent = launcher.name;
  const meta = document.createElement("small");
  meta.textContent = launcher.pinned === true
    ? "置顶"
    : launcher.enabled === true
      ? "已启用"
      : "未启用";
  copy.append(name, meta);
  button.append(icon, copy);
  return button;
}

function renderLauncherDetail(launcher) {
  const item = document.createElement("article");
  item.className = "launcher-settings-item";
  item.dataset.launcherId = launcher.launcherId;

  const head = document.createElement("div");
  head.className = "launcher-settings-head";

  const icon = createLauncherIcon(launcher, 48);

  const title = document.createElement("div");
  title.className = "launcher-settings-title";
  const nameEl = document.createElement("strong");
  nameEl.textContent = launcher.name;
  const hintEl = document.createElement("small");
  hintEl.textContent = launcher.pinned === true
    ? "当前置顶，弹窗主按钮默认打开"
    : launcher.builtin
      ? "内置启动器，可禁用"
      : "自定义启动器，可删除";
  title.append(nameEl, hintEl);

  const actions = document.createElement("div");
  actions.className = "launcher-actions";
  const enabledLabel = document.createElement("label");
  enabledLabel.className = "toggle-field";
  const enabledInput = document.createElement("input");
  enabledInput.type = "checkbox";
  enabledInput.checked = launcher.enabled === true;
  enabledInput.dataset.launcherId = launcher.launcherId;
  enabledInput.dataset.launcherField = "enabled";
  const enabledTrack = document.createElement("span");
  enabledTrack.className = "toggle-track";
  enabledTrack.setAttribute("aria-hidden", "true");
  const enabledCopy = document.createElement("span");
  enabledCopy.className = "toggle-copy";
  const enabledStrong = document.createElement("strong");
  enabledStrong.textContent = "启用";
  enabledCopy.append(enabledStrong);
  enabledLabel.append(enabledInput, enabledTrack, enabledCopy);

  actions.append(
    enabledLabel,
    createLauncherButton(launcher.pinned === true ? "已置顶" : "设为置顶", launcher.launcherId, "pin", { disabled: launcher.pinned === true }),
    createLauncherButton("选择应用", launcher.launcherId, "pick-exe"),
    createLauncherButton("恢复默认参数", launcher.launcherId, "restore-args"),
    createLauncherIconUpload(launcher)
  );
  if (!launcher.builtin) {
    actions.append(createLauncherButton("删除", launcher.launcherId, "delete"));
  }

  head.append(icon, title, actions);

  const meta = document.createElement("div");
  meta.className = "launcher-meta-row";
  const launcherIdMeta = document.createElement("span");
  launcherIdMeta.textContent = "launcherId=";
  const launcherIdCode = document.createElement("code");
  launcherIdCode.textContent = launcher.launcherId;
  launcherIdMeta.append(launcherIdCode);
  const iconKeyMeta = document.createElement("span");
  iconKeyMeta.textContent = "iconKey=";
  const iconKeyCode = document.createElement("code");
  iconKeyCode.textContent = launcher.iconKey;
  iconKeyMeta.append(iconKeyCode);
  meta.append(launcherIdMeta, iconKeyMeta);

  const fields = document.createElement("div");
  fields.className = "launcher-form-grid";
  fields.append(
    createTextInput({
      label: "显示名称",
      value: launcher.name,
      placeholder: "例如：Cursor",
      launcherId: launcher.launcherId,
      fieldName: "name"
    }),
    createTextInput({
      label: "应用路径",
      value: launcher.executablePath,
      placeholder: "例如：C:\\Tools\\App\\app.exe",
      launcherId: launcher.launcherId,
      fieldName: "executablePath"
    }),
    createTextInput({
      label: "参数模板",
      value: launcher.argumentsTemplate,
      placeholder: '"{rawPath}"',
      launcherId: launcher.launcherId,
      fieldName: "argumentsTemplate",
      wide: true
    })
  );

  item.append(head, meta, fields);
  return item;
}

function renderLauncherList() {
  currentLaunchers = normalizeCustomLaunchers(currentLaunchers);
  const firstLauncher = currentLaunchers[0] || null;
  const hasSelectedLauncher = currentLaunchers.some((launcher) => launcher.launcherId === selectedLauncherId);
  selectedLauncherId = hasSelectedLauncher ? selectedLauncherId : firstLauncher?.launcherId || "";

  const nav = document.createElement("div");
  nav.className = "launcher-nav";
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", "打开方式导航");
  nav.append(...currentLaunchers.map(renderLauncherNavButton));

  const selectedLauncher = findCurrentLauncher(selectedLauncherId) || firstLauncher;
  const detail = document.createElement("div");
  detail.className = "launcher-detail-panel";
  if (selectedLauncher) {
    detail.append(renderLauncherDetail(selectedLauncher));
  }

  launcherListEl.replaceChildren(nav, detail);
}

function updateLauncher(launcherId, patch) {
  currentLaunchers = normalizeCustomLaunchers(currentLaunchers.map((launcher) => (
    launcher.launcherId === launcherId
      ? { ...launcher, ...patch }
      : launcher
  )));
  renderLauncherList();
  renderPathSummary({ customLaunchers: currentLaunchers });
}

/**
 * 切换生成文件配置的平台标签（云枢/氚云）。
 */
function setActiveGenfilesTab(platformKey) {
  activeGenfilesTabKey = platformKey === "h3yun" ? "h3yun" : "cloudpivot";
  for (const button of genfilesPlatformTabButtons) {
    const isActive = button.dataset.platformTab === activeGenfilesTabKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }
  for (const panel of genfilesPlatformPanels) {
    const isActive = panel.dataset.platformPanel === activeGenfilesTabKey;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  }
}

/**
 * 渲染单个平台的生成文件开关列表。
 * @param {HTMLElement} gridEl - 容器元素
 * @param {object} platformGenFiles - 平台开关对象
 * @param {string} platformKey - "cloudpivot" | "h3yun"
 */
function renderGenfilesGrid(gridEl, platformGenFiles, platformKey) {
  gridEl.replaceChildren();
  const labels = {
    fromCode: "FromCode.md — 编码上下文（始终生成）",
    css: "CSS 样式文件",
    js: "JS 脚本文件",
    html: "HTML 模板文件",
    cs: "C# 后端代码文件",
    readme: "README.md — 用户需求文档",
    agents: "AGENTS.md — AI 协作规则",
    design: "DESIGN.md — 技术实现设计"
  };
  const fromCodeKeys = platformKey === "h3yun"
    ? ["fromCode", "js", "cs", "readme", "agents", "design"]
    : ["fromCode", "css", "js", "html", "readme", "agents", "design"];

  for (const key of fromCodeKeys) {
    const isFromCode = key === "fromCode";
    const checked = platformGenFiles[key] === true;
    const label = labels[key] || key;

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle-field";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.disabled = isFromCode;
    input.dataset.genfilesPlatform = platformKey;
    input.dataset.genfilesKey = key;

    const track = document.createElement("span");
    track.className = "toggle-track";
    track.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "toggle-copy";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const small = document.createElement("small");
    small.textContent = isFromCode ? "必需文件，不可关闭" : (checked ? "当前开启" : "当前关闭");

    copy.append(strong, small);
    toggleLabel.append(input, track, copy);
    gridEl.appendChild(toggleLabel);
  }
}

/**
 * 根据当前 currentGeneratedFiles 渲染两个平台的生成文件开关。
 */
function renderAllGenfilesGrids() {
  renderGenfilesGrid(genfilesCloudpivotGrid, currentGeneratedFiles.cloudpivot || DEFAULT_GENERATED_FILES.cloudpivot, "cloudpivot");
  renderGenfilesGrid(genfilesH3yunGrid, currentGeneratedFiles.h3yun || DEFAULT_GENERATED_FILES.h3yun, "h3yun");
}

/**
 * 从 DOM 同步生成文件开关到 currentGeneratedFiles。
 */
function syncGenfilesFromDom() {
  const inputs = document.querySelectorAll("[data-genfiles-platform][data-genfiles-key]");
  for (const input of inputs) {
    const platformKey = input.dataset.genfilesPlatform;
    const key = input.dataset.genfilesKey;
    if (!currentGeneratedFiles[platformKey]) {
      currentGeneratedFiles[platformKey] = {};
    }
    currentGeneratedFiles[platformKey][key] = input.checked === true;
  }
}

// 帮助抽屉开关
function setHelpOpen(isOpen) {
  helpOverlay.hidden = !isOpen;
  document.body.classList.toggle("help-open", isOpen);
}

function renderConfig(config) {
  currentLaunchers = normalizeCustomLaunchers(config.customLaunchers);
  currentGeneratedFiles = config.generatedFiles || DEFAULT_GENERATED_FILES;
  renderLauncherList();
  autoCheckUpdatesField.checked = config.autoCheckUpdates === true;
  h3yunOneClickWritebackField.checked = config.h3yunOneClickWriteback !== false;
  renderPathSummary(config);
  renderFallbackDirectoryPaths(config.fallbackDirectoryPaths);
  renderUpdateResult(config.lastUpdateCheckResult);
  renderAllGenfilesGrids();
  setStatus(
    [
      "配置已加载",
      `打开方式可用数量: ${getAvailableLaunchers(currentLaunchers).length}`,
      `自动检查更新: ${config.autoCheckUpdates ? "开启" : "关闭"}`
    ].join("\n")
  );
}

async function pickLauncherExecutablePath(launcher) {
  // “选择应用”依赖原生助手；未安装时保留手动粘贴路径，避免用户被单个按钮卡住。
  const hostStatus = await probeNativeHost();
  if (!hostStatus.available) {
    setStatus("当前未安装原生助手，请先双击 scripts\\install-native-host.cmd；也可以临时手动粘贴应用路径后保存。");
    return;
  }

  const response = await pickNativeEditor(launcher.executablePath || launcher.name);
  if (!response?.ok) {
    if (response?.cancelled) {
      setStatus("已取消选择应用。");
      return;
    }
    throw new Error(response?.error || "选择应用失败");
  }
  const executablePath = response.executablePath || "";
  const displayName = response.displayName || launcher.name;
  let iconMessage = "已选择应用；请确认图标。";

  const iconResponse = await extractExecutableIcon({
    executablePath,
    iconKey: launcher.iconKey
  });
  if (iconResponse?.ok) {
    iconMessage = "已选择应用，并已从 exe 提取图标。";
  } else if (!launcher.builtin) {
    iconMessage = "已选择应用；未能从 exe 提取图标，请上传 png/webp 图标后保存。";
  }

  updateLauncher(launcher.launcherId, {
    executablePath,
    name: launcher.builtin ? launcher.name : displayName,
    enabled: true
  });
  setStatus(iconMessage);
}

// 保存设置：从各面板控件收集值，同步写入 chrome.storage.local
async function handleSubmit() {
  saveButton.disabled = true;

  try {
    syncLaunchersFromForm();
    syncGenfilesFromDom();
    const nextConfig = await saveConfig({
      customLaunchers: currentLaunchers,
      fallbackDirectoryPaths: {
        cloudpivot: String(fallbackPathCloudpivotInput.value || "").trim(),
        h3yun: String(fallbackPathH3yunInput.value || "").trim()
      },
      autoCheckUpdates: autoCheckUpdatesField.checked,
      generatedFiles: currentGeneratedFiles,
      h3yunOneClickWriteback: h3yunOneClickWritebackField.checked
    });
    renderConfig(nextConfig);
    setStatus("保存成功。");

    // 保存成功动画：按钮短暂变绿并显示勾号
    saveButton.classList.add("is-saved");
    setTimeout(() => saveButton.classList.remove("is-saved"), 1200);
  } catch (error) {
    setStatus(`保存失败。\n${error?.message || String(error)}`);
  } finally {
    saveButton.disabled = false;
  }
}

// 恢复默认配置：所有设置回到出厂值
async function handleReset() {
  resetButton.disabled = true;
  try {
    const nextConfig = await saveConfig({
      customLaunchers: DEFAULT_CONFIG.customLaunchers,
      fallbackDirectoryPaths: DEFAULT_CONFIG.fallbackDirectoryPaths,
      autoCheckUpdates: DEFAULT_CONFIG.autoCheckUpdates,
      lastUpdateCheckResult: DEFAULT_CONFIG.lastUpdateCheckResult,
      generatedFiles: DEFAULT_GENERATED_FILES,
      h3yunOneClickWriteback: true
    });
    renderConfig(nextConfig);
    setStatus("已恢复默认配置。");

    // 恢复成功动画
    resetButton.classList.add("is-reset");
    setTimeout(() => resetButton.classList.remove("is-reset"), 1200);
  } catch (error) {
    setStatus(`恢复默认失败。\n${error?.message || String(error)}`);
  } finally {
    resetButton.disabled = false;
  }
}

async function handleDiscoverLaunchers() {
  discoverLaunchersButton.disabled = true;
  try {
    const hostStatus = await probeNativeHost();
    if (!hostStatus.available) {
      setStatus("当前未安装原生助手，无法自动检测内置软件；可手动填写应用路径。");
      return;
    }

    const response = await discoverNativeLaunchers();
    if (!response?.ok) {
      throw new Error(response?.error || "检测内置软件失败");
    }

    currentLaunchers = applyDiscoveredLaunchers(currentLaunchers, response.launchers || []);
    renderLauncherList();
    renderPathSummary({ customLaunchers: currentLaunchers });
    const found = (response.launchers || []).filter((launcher) => launcher.executablePath).map((launcher) => launcher.name);
    setStatus([
      "内置软件检测完成。",
      `找到：${found.length ? found.join("、") : "无"}`,
      "点击保存设置后生效。"
    ].join("\n"));
  } catch (error) {
    setStatus(`检测内置软件失败。\n${error?.message || String(error)}`);
  } finally {
    discoverLaunchersButton.disabled = false;
  }
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取图标文件失败"));
    reader.readAsDataURL(file);
  });
}

async function handleLauncherIconUpload(launcher, file) {
  if (!file) {
    return;
  }
  if (!["image/png", "image/webp"].includes(file.type)) {
    setStatus("图标格式仅支持 png/webp。");
    return;
  }
  if (file.size > 512 * 1024) {
    setStatus("图标文件不能超过 512KB。");
    return;
  }

  const hostStatus = await probeNativeHost();
  if (!hostStatus.available) {
    setStatus("上传图标需要原生助手生成 16/48/128 PNG，请先安装原生助手。");
    return;
  }

  const response = await saveLauncherIcon({
    iconKey: launcher.iconKey,
    fileName: file.name,
    content: await fileToDataUrl(file)
  });
  if (!response?.ok) {
    throw new Error(response?.error || "保存图标失败");
  }

  renderLauncherList();
  setStatus(`图标已保存：${launcher.name}\n已生成 16/48/128 PNG。`);
}

// 删除自定义启动器，同时清理对应的图标文件；图标清理失败不阻断删除流程。
async function handleDeleteLauncher(launcher) {
  if (launcher.builtin) {
    setStatus("内置启动器不可删除，只能禁用。");
    return;
  }

  // 尝试清理图标文件；新创建的或从未上传图标的启动器可能没有图标，忽略失败继续删除
  const hostStatus = await probeNativeHost();
  if (hostStatus.available) {
    try {
      const response = await deleteLauncherIcon({ iconKey: launcher.iconKey });
      if (!response?.ok) {
        // 图标删除失败不阻断启动器删除
      }
    } catch (_error) {
      // 忽略图标删除失败
    }
  }

  currentLaunchers = normalizeCustomLaunchers(currentLaunchers.filter((item) => item.launcherId !== launcher.launcherId));
  selectedLauncherId = currentLaunchers[0]?.launcherId || "";
  renderLauncherList();
  renderPathSummary({ customLaunchers: currentLaunchers });
  setStatus("自定义打开方式已删除；点击保存设置后生效。");
}

function findCurrentLauncher(launcherId) {
  return currentLaunchers.find((launcher) => launcher.launcherId === launcherId) || null;
}

async function handleLauncherListClick(event) {
  const actionButton = event.target.closest("[data-launcher-action]");
  if (!actionButton || actionButton.tagName === "INPUT") {
    return;
  }

  const launcher = findCurrentLauncher(actionButton.dataset.launcherId);
  if (!launcher) {
    return;
  }

  const action = actionButton.dataset.launcherAction;
  try {
    if (action === "select") {
      syncLaunchersFromForm();
      selectedLauncherId = launcher.launcherId;
      renderLauncherList();
      return;
    }
    if (action === "pin") {
      currentLaunchers = pinLauncher(currentLaunchers, launcher.launcherId);
      selectedLauncherId = launcher.launcherId;
      renderLauncherList();
      renderPathSummary({ customLaunchers: currentLaunchers });
      setStatus("已设为置顶打开方式；点击保存设置后生效。");
      return;
    }
    if (action === "pick-exe") {
      await pickLauncherExecutablePath(launcher);
      return;
    }
    if (action === "restore-args") {
      updateLauncher(launcher.launcherId, {
        argumentsTemplate: getDefaultArgumentsTemplate(launcher)
      });
      setStatus("参数模板已恢复默认；点击保存设置后生效。");
      return;
    }
    if (action === "delete") {
      await handleDeleteLauncher(launcher);
    }
  } catch (error) {
    setStatus(`打开方式操作失败。\n${error?.message || String(error)}`);
  }
}

async function handleLauncherListChange(event) {
  const target = event.target;
  if (target?.dataset?.launcherAction === "upload-icon") {
    return;
  }
  const launcherId = target?.dataset?.launcherId || "";
  const fieldName = target?.dataset?.launcherField || "";
  const launcher = findCurrentLauncher(launcherId);
  if (!launcher || !fieldName) {
    return;
  }

  if (fieldName !== "enabled") {
    return;
  }

  if (target.checked === true && !launcher.executablePath) {
    updateLauncher(launcherId, { enabled: false });
    setStatus("启用前需要先配置应用路径，或点击“检测内置软件”。");
    return;
  }

  updateLauncher(launcherId, { enabled: target.checked === true });
  setStatus("启用状态已更新；点击保存设置后生效。");
}

function handleLauncherListFocusOut(event) {
  const target = event.target;
  const launcherId = target?.dataset?.launcherId || "";
  const fieldName = target?.dataset?.launcherField || "";
  if (!launcherId || !fieldName || target.type === "checkbox") {
    return;
  }

  currentLaunchers = normalizeCustomLaunchers(currentLaunchers.map((launcher) => (
    launcher.launcherId === launcherId
      ? { ...launcher, [fieldName]: target.value }
      : launcher
  )));
  renderPathSummary({ customLaunchers: currentLaunchers });
  setStatus("打开方式已更新；点击保存设置后生效。");
}

async function handleLauncherListFileChange(event) {
  const target = event.target;
  if (target?.dataset?.launcherAction !== "upload-icon") {
    return;
  }
  const launcher = findCurrentLauncher(target.dataset.launcherId);
  if (!launcher) {
    return;
  }

  try {
    await handleLauncherIconUpload(launcher, target.files?.[0] || null);
  } catch (error) {
    setStatus(`上传图标失败。\n${error?.message || String(error)}`);
  } finally {
    target.value = "";
  }
}

async function handleAddLauncher() {
  const draft = createCustomLauncherDraft({ seed: Date.now().toString(36) }, currentLaunchers);
  currentLaunchers = normalizeCustomLaunchers([...currentLaunchers, draft]);
  selectedLauncherId = draft.launcherId;
  renderLauncherList();
  renderPathSummary({ customLaunchers: currentLaunchers });
  setStatus("已新增自定义打开方式；请选择应用并上传 png/webp 图标后保存。");
}

function syncLaunchersFromForm() {
  const patchesById = new Map();
  for (const element of launcherListEl.querySelectorAll("[data-launcher-field]")) {
    const launcherId = element.dataset.launcherId;
    const fieldName = element.dataset.launcherField;
    const patch = patchesById.get(launcherId) || {};
    patch[fieldName] = element.type === "checkbox" ? element.checked === true : element.value;
    patchesById.set(launcherId, patch);
  }

  currentLaunchers = normalizeCustomLaunchers(currentLaunchers.map((launcher) => ({
    ...launcher,
    ...(patchesById.get(launcher.launcherId) || {})
  })));
}

async function handleCheckUpdate() {
  checkUpdateButton.disabled = true;
  setUpdateStatus("正在检查 Git 远程更新...");

  try {
    const result = await checkForUpdate();
    renderUpdateResult(result);
  } catch (error) {
    setUpdateStatus(`检查更新失败。\n${error?.message || String(error)}`);
  } finally {
    checkUpdateButton.disabled = false;
  }
}

async function handleSyncUpdate() {
  syncUpdateButton.disabled = true;
  setUpdateStatus("正在从 Git 远程同步更新...");

  try {
    const hostStatus = await probeNativeHost();
    const preflightResults = [
      createNativeHostPreflightResult(hostStatus),
      createUpdateOverwriteRiskResult()
    ];
    setUpdateStatus([
      "自动预检完成。",
      `operationId=${PREFLIGHT_OPERATION_IDS.updateSync}`,
      ...formatPreflightStatusLines(preflightResults)
    ].join("\n"));
    if (hasBlockingPreflightResult(preflightResults)) {
      await saveLastDiagnosticPackage(buildDiagnosticPackage({
        ...buildExtensionDiagnosticContext(),
        operationId: PREFLIGHT_OPERATION_IDS.updateSync,
        logs: [],
        pageProbe: {},
        directorySnapshot: {},
        preflightResults,
        nativeHost: hostStatus
      }));
      await renderLastDiagnosticSummary();
      return;
    }

    const result = await syncFromGit();
    await saveLastDiagnosticPackage(buildDiagnosticPackage({
      ...buildExtensionDiagnosticContext(),
      operationId: PREFLIGHT_OPERATION_IDS.updateSync,
      logs: [],
      pageProbe: {},
      directorySnapshot: {},
      preflightResults,
      nativeHost: hostStatus,
      updateSync: result
    }));
    await renderLastDiagnosticSummary();
    renderUpdateResult(result);
  } catch (error) {
    setUpdateStatus(`同步更新失败。\n${error?.message || String(error)}`);
  } finally {
    syncUpdateButton.disabled = false;
  }
}

async function handleExportLastDiagnostic() {
  exportLastDiagnosticButton.disabled = true;
  try {
    const packageData = await loadLastDiagnosticPackage();
    if (!packageData) {
      setStatus("暂无最近诊断 JSON；请先在弹窗或设置页执行一次失败操作。");
      return;
    }

    downloadJsonFile(
      `cloudpiovt-plugin-last-diagnostic-${buildDownloadTimestamp()}.json`,
      packageData
    );
    await renderLastDiagnosticSummary();
    setStatus(`最近诊断 JSON 已导出。\ncreatedAt=${packageData.createdAt || ""}`);
  } catch (error) {
    setStatus(`导出最近诊断失败。\n${error?.message || String(error)}`);
  } finally {
    exportLastDiagnosticButton.disabled = false;
  }
}

async function handleCopyDiagnosticSummary() {
  copyDiagnosticSummaryButton.disabled = true;
  try {
    const packageData = await renderLastDiagnosticSummary();
    if (!packageData) {
      setStatus("暂无最近诊断摘要；请先执行一次带预检的操作。");
      return;
    }

    await navigator.clipboard.writeText(summarizeDiagnosticPackage(packageData));
    setStatus("最近诊断摘要已复制。");
  } catch (error) {
    setStatus(`复制诊断摘要失败。\n${error?.message || String(error)}`);
  } finally {
    copyDiagnosticSummaryButton.disabled = false;
  }
}

async function init() {
  setVersionLabels();
  renderReadonlySettings();
  renderReleaseNotes();
  renderCloudpivotControlTypeReference();
  renderH3yunControlTypeReference();
  setActiveDocsTab("reference");
  setActivePlatform("reference", "cloudpivot");
  setActivePlatform("flow", "cloudpivot");
  setActiveDefaultDirTab("cloudpivot");
  setActiveGenfilesTab("cloudpivot");
  setActiveMainTab("launchers");
  renderConfig(await loadConfig());
  await renderLastDiagnosticSummary();
  const hostStatus = await probeNativeHost();
  setNativeHostStatus(
    hostStatus.available
      ? "已连接"
      : "未安装"
  );
  setStatus(
    hostStatus.available
      ? `配置已加载。\n原生助手已连接：${hostStatus.hostName} ${hostStatus.version}`
      : "配置已加载。\n原生助手未安装；绝对路径历史、选择应用和一键打开编辑器需要先双击 scripts\\install-native-host.cmd。"
  );
}

for (const button of mainTabButtons) {
  button.addEventListener("click", () => setActiveMainTab(button.dataset.mainTab));
}

for (const button of docsTabButtons) {
  button.addEventListener("click", () => setActiveDocsTab(button.dataset.docsTab));
}

for (const button of platformTabButtons) {
  button.addEventListener("click", () => setActivePlatform(button.dataset.platformGroup, button.dataset.platformTab));
}

saveButton.addEventListener("click", () => runWithButtonBusy(saveButton, handleSubmit));
resetButton.addEventListener("click", () => runWithButtonBusy(resetButton, handleReset));
checkUpdateButton.addEventListener("click", () => runWithButtonBusy(checkUpdateButton, handleCheckUpdate));
syncUpdateButton.addEventListener("click", () => runWithButtonBusy(syncUpdateButton, handleSyncUpdate));
discoverLaunchersButton.addEventListener("click", () => runWithButtonBusy(discoverLaunchersButton, handleDiscoverLaunchers));
addLauncherButton.addEventListener("click", () => runWithButtonBusy(addLauncherButton, handleAddLauncher));
launcherListEl.addEventListener("click", handleLauncherListClick);
launcherListEl.addEventListener("change", handleLauncherListChange);
launcherListEl.addEventListener("change", handleLauncherListFileChange);
launcherListEl.addEventListener("focusout", handleLauncherListFocusOut);
copyDiagnosticSummaryButton.addEventListener("click", () => runWithButtonBusy(copyDiagnosticSummaryButton, handleCopyDiagnosticSummary));
exportLastDiagnosticButton.addEventListener("click", () => runWithButtonBusy(exportLastDiagnosticButton, handleExportLastDiagnostic));

for (const button of defaultDirPlatformTabButtons) {
  button.addEventListener("click", () => setActiveDefaultDirTab(button.dataset.platformTab));
}

pickFallbackDirCloudpivotButton.addEventListener("click", () => runWithButtonBusy(pickFallbackDirCloudpivotButton, () => handlePickFallbackDirectory("cloudpivot")));
pickFallbackDirH3yunButton.addEventListener("click", () => runWithButtonBusy(pickFallbackDirH3yunButton, () => handlePickFallbackDirectory("h3yun")));

// 帮助抽屉
helpButton.addEventListener("click", () => setHelpOpen(true));
helpCloseButton.addEventListener("click", () => setHelpOpen(false));
helpOverlay.addEventListener("click", (event) => {
  if (event.target === helpOverlay) {
    setHelpOpen(false);
  }
});

// 生成文件平台标签
for (const button of genfilesPlatformTabButtons) {
  button.addEventListener("click", () => setActiveGenfilesTab(button.dataset.platformTab));
}

init().catch((error) => {
  setStatus(`配置加载失败。\n${error?.message || String(error)}`);
});
