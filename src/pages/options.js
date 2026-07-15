import {
  DEFAULT_CONFIG,
  DEFAULT_GENERATED_FILES,
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

// ========== DOM 引用 ==========
const topBarStatus = document.querySelector("#top-bar-status");
const saveBtn = document.querySelector("#save-btn");
const resetBtn = document.querySelector("#reset-btn");
const expandAllBtn = document.querySelector("#expand-all-btn");
const toastEl = document.querySelector("#toast");
const sections = Array.from(document.querySelectorAll("[data-section]"));

// 应用路径
const launcherTbody = document.querySelector("#launcher-tbody");
const launcherEmpty = document.querySelector("#launcher-empty");
const addLauncherBtn = document.querySelector("#add-launcher-btn");
const discoverLaunchersBtn = document.querySelector("#discover-launchers-btn");
const launcherMenu = document.querySelector("#launcher-menu");
let menuTargetLauncherId = "";

// 编辑弹窗
const editPopover = document.querySelector("#launcher-edit-popover");
const editPopoverTitle = document.querySelector("#edit-popover-title");
const editLauncherName = document.querySelector("#edit-launcher-name");
const editLauncherPath = document.querySelector("#edit-launcher-path");
const editLauncherArgs = document.querySelector("#edit-launcher-args");
const editPickExeBtn = document.querySelector("#edit-pick-exe-btn");
const editLauncherIconInput = document.querySelector("#edit-launcher-icon-input");
const editLauncherSaveBtn = document.querySelector("#edit-launcher-save-btn");
const editLauncherCancelBtn = document.querySelector("#edit-launcher-cancel-btn");
let editingLauncherId = "";

// 默认目录
const defaultDirPlatform = document.querySelector("#default-dir-platform");
const defaultDirPath = document.querySelector("#default-dir-path");
const pickDefaultDirBtn = document.querySelector("#pick-default-dir-btn");

// 更新
const updateBanner = document.querySelector("#update-banner");
const updateBannerText = document.querySelector("#update-banner-text");
const updateStatusText = document.querySelector("#update-status-text");
const updateLastCheck = document.querySelector("#update-last-check");
const autoCheckUpdatesField = document.querySelector("#auto-check-updates");
const checkUpdateBtn = document.querySelector("#check-update-btn");
const syncUpdateBtn = document.querySelector("#sync-update-btn");

// 文件生成
const genfilesPlatform = document.querySelector("#genfiles-platform");
const genfilesToggles = document.querySelector("#genfiles-toggles");
const h3yunOneClickWritebackField = document.querySelector("#h3yun-oneclick-writeback");

// 诊断
const statusOutput = document.querySelector("#status-output");
const copyDiagnosticSummaryBtn = document.querySelector("#copy-diagnostic-summary-btn");
const exportLastDiagnosticBtn = document.querySelector("#export-last-diagnostic-btn");
const lastDiagnosticSummaryEl = document.querySelector("#last-diagnostic-summary");

// 帮助
const releasePills = document.querySelector("#release-pills");
const releaseCompact = document.querySelector("#release-compact");
const releaseMoreBtn = document.querySelector("#release-more-btn");
const releaseFull = document.querySelector("#release-full");

// ========== 状态 ==========
let currentLaunchers = [];
let currentGeneratedFiles = DEFAULT_GENERATED_FILES;
let currentConfig = null;
let hostAvailable = false;
let hostStatus = null;
let releaseExpanded = false;
const RECENT_RELEASE_COUNT = 3;

// 折叠状态持久化
const COLLAPSE_KEY = "options_collapse_state";
function loadCollapseState() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveCollapseState(state) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
}

// ========== Toast ==========
let toastTimer = 0;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2500);
}

function setStatusOutput(message) {
  statusOutput.textContent = message;
}

// ========== 按钮忙状态 ==========
async function runWithButtonBusy(button, task) {
  button?.classList.add("is-running");
  button?.setAttribute("aria-busy", "true");
  try { return await task(); }
  finally {
    button?.classList.remove("is-running");
    button?.removeAttribute("aria-busy");
  }
}

// ========== 分区折叠 ==========
function applyCollapseState(state) {
  for (const section of sections) {
    const key = section.dataset.section;
    if (state[key] === true) {
      section.classList.add("is-collapsed");
      section.querySelector(".section-head").setAttribute("aria-expanded", "false");
    } else {
      section.classList.remove("is-collapsed");
      section.querySelector(".section-head").setAttribute("aria-expanded", "true");
    }
  }
}

for (const section of sections) {
  const head = section.querySelector(".section-head");
  head.addEventListener("click", () => {
    const key = section.dataset.section;
    const isCollapsed = !section.classList.contains("is-collapsed");
    section.classList.toggle("is-collapsed", isCollapsed);
    head.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    const state = loadCollapseState();
    if (isCollapsed) state[key] = true;
    else delete state[key];
    saveCollapseState(state);
  });
}

expandAllBtn.addEventListener("click", () => {
  const allCollapsed = sections.every((s) => s.classList.contains("is-collapsed"));
  for (const section of sections) {
    const key = section.dataset.section;
    section.classList.toggle("is-collapsed", !allCollapsed);
    section.querySelector(".section-head").setAttribute("aria-expanded", allCollapsed ? "true" : "false");
  }
  saveCollapseState(allCollapsed ? {} : Object.fromEntries(sections.map((s) => [s.dataset.section, true])));
});

// ========== 顶栏状态 ==========
function updateTopBarStatus(config) {
  const parts = [`v${CURRENT_EXTENSION_VERSION}`];
  if (hostAvailable) {
    parts.push(`已连接 (${hostStatus?.hostName || "native-host"})`);
  } else {
    parts.push("未安装");
  }
  const count = getAvailableLaunchers(config?.customLaunchers || currentLaunchers).length;
  parts.push(`${count} 个可用`);
  topBarStatus.textContent = parts.join(" · ");
}

// ========== 启动器表格渲染 ==========
function renderLauncherTable() {
  currentLaunchers = normalizeCustomLaunchers(currentLaunchers);
  launcherTbody.replaceChildren();

  if (currentLaunchers.length === 0) {
    launcherEmpty.hidden = false;
    document.querySelector(".launcher-table-wrap").hidden = true;
    return;
  }

  launcherEmpty.hidden = true;
  document.querySelector(".launcher-table-wrap").hidden = false;

  for (const launcher of currentLaunchers) {
    const tr = document.createElement("tr");
    tr.dataset.launcherId = launcher.launcherId;

    // 图标
    const tdIcon = document.createElement("td");
    tdIcon.className = "col-icon";
    const img = document.createElement("img");
    img.className = "launcher-icon-cell";
    img.src = getLauncherIconPath(launcher, 48);
    img.alt = "";
    img.onerror = () => { img.style.display = "none"; };
    tdIcon.appendChild(img);

    // 名称
    const tdName = document.createElement("td");
    tdName.className = "col-name";
    const nameSpan = document.createElement("span");
    nameSpan.className = "launcher-name-cell";
    nameSpan.textContent = launcher.name;
    nameSpan.title = "点击编辑";
    nameSpan.addEventListener("click", () => openLauncherEditor(launcher));
    tdName.appendChild(nameSpan);

    // 路径
    const tdPath = document.createElement("td");
    tdPath.className = "col-path";
    const pathSpan = document.createElement("span");
    pathSpan.className = "launcher-path-cell";
    pathSpan.textContent = launcher.executablePath || "—";
    pathSpan.title = launcher.executablePath || "未配置路径";
    tdPath.appendChild(pathSpan);

    // 状态
    const tdStatus = document.createElement("td");
    tdStatus.className = "col-status";
    const badge = document.createElement("span");
    badge.className = "launcher-status-badge";
    if (launcher.pinned) {
      badge.classList.add("is-pinned");
      badge.textContent = "置顶";
    } else if (launcher.enabled && launcher.executablePath) {
      badge.classList.add("is-enabled");
      badge.textContent = "已启用";
    } else {
      badge.classList.add("is-disabled");
      badge.textContent = "未启用";
    }
    tdStatus.appendChild(badge);

    // 操作
    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    const menuBtn = document.createElement("button");
    menuBtn.className = "launcher-menu-btn";
    menuBtn.textContent = "⋮";
    menuBtn.title = "操作";
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openLauncherMenu(launcher.launcherId, e);
    });
    tdActions.appendChild(menuBtn);

    tr.append(tdIcon, tdName, tdPath, tdStatus, tdActions);
    launcherTbody.appendChild(tr);
  }
}

// ========== 启动器操作菜单 ==========
function openLauncherMenu(launcherId, event) {
  menuTargetLauncherId = launcherId;
  const launcher = findCurrentLauncher(launcherId);
  if (!launcher) return;

  // 更新菜单项文本
  const items = launcherMenu.querySelectorAll(".context-item");
  for (const item of items) {
    const action = item.dataset.menuAction;
    if (action === "pin") {
      item.textContent = launcher.pinned ? "取消置顶" : "设为置顶";
    } else if (action === "delete") {
      item.hidden = launcher.builtin;
    }
  }

  const rect = event.target.getBoundingClientRect();
  launcherMenu.style.left = `${Math.min(rect.left, window.innerWidth - 160)}px`;
  launcherMenu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 180)}px`;
  launcherMenu.hidden = false;
}

function closeLauncherMenu() {
  launcherMenu.hidden = true;
  menuTargetLauncherId = "";
}

launcherMenu.addEventListener("click", async (e) => {
  const item = e.target.closest(".context-item");
  if (!item) return;
  closeLauncherMenu();
  const action = item.dataset.menuAction;
  const launcher = findCurrentLauncher(menuTargetLauncherId);
  if (!launcher) return;

  if (action === "pin") {
    if (launcher.pinned) {
      currentLaunchers = normalizeCustomLaunchers(currentLaunchers.map((l) => l.launcherId === launcher.launcherId ? { ...l, pinned: false } : l));
    } else {
      currentLaunchers = pinLauncher(currentLaunchers, launcher.launcherId);
    }
    renderLauncherTable();
    showToast("置顶状态已更新");
  } else if (action === "enable") {
    currentLaunchers = normalizeCustomLaunchers(currentLaunchers.map((l) => l.launcherId === launcher.launcherId ? { ...l, enabled: !l.enabled } : l));
    renderLauncherTable();
    showToast(`已${launcher.enabled ? "禁用" : "启用"}`);
  } else if (action === "edit") {
    openLauncherEditor(launcher);
  } else if (action === "delete") {
    await handleDeleteLauncher(launcher);
  }
});

document.addEventListener("click", (e) => {
  if (!launcherMenu.hidden && !launcherMenu.contains(e.target) && !e.target.classList.contains("launcher-menu-btn")) {
    closeLauncherMenu();
  }
});

// ========== 启动器编辑弹窗 ==========
function openLauncherEditor(launcher) {
  editingLauncherId = launcher.launcherId;
  // 内置启动器只允许编辑名称和路径，不允许删除
  editPopoverTitle.textContent = launcher.builtin ? `编辑 ${launcher.name}` : `编辑 ${launcher.name || "自定义软件"}`;
  editLauncherName.value = launcher.name;
  editLauncherPath.value = launcher.executablePath || "";
  editLauncherArgs.value = launcher.argumentsTemplate || getDefaultArgumentsTemplate(launcher);
  editPopover.hidden = false;
  document.body.classList.add("edit-open");
}

function closeLauncherEditor() {
  editPopover.hidden = true;
  document.body.classList.remove("edit-open");
  editingLauncherId = "";
}

editLauncherCancelBtn.addEventListener("click", closeLauncherEditor);
editPopover.querySelector(".popover-mask")?.addEventListener("click", closeLauncherEditor);

editLauncherSaveBtn.addEventListener("click", () => {
  const launcher = findCurrentLauncher(editingLauncherId);
  if (!launcher) return;

  currentLaunchers = normalizeCustomLaunchers(currentLaunchers.map((l) => {
    if (l.launcherId !== editingLauncherId) return l;
    return {
      ...l,
      name: editLauncherName.value.trim() || l.name,
      executablePath: editLauncherPath.value.trim(),
      argumentsTemplate: editLauncherArgs.value.trim() || getDefaultArgumentsTemplate(l)
    };
  }));
  renderLauncherTable();
  closeLauncherEditor();
  showToast("启动器已更新");
});

editPickExeBtn.addEventListener("click", async () => {
  const launcher = findCurrentLauncher(editingLauncherId);
  if (!launcher) return;
  await runWithButtonBusy(editPickExeBtn, async () => {
    await pickLauncherExecutablePathForEdit(launcher);
  });
});

async function pickLauncherExecutablePathForEdit(launcher) {
  const hostStatus = await probeNativeHost();
  if (!hostStatus.available) {
    showToast("原生助手未安装");
    return;
  }
  const response = await pickNativeEditor(launcher.executablePath || launcher.name);
  if (!response?.ok) {
    if (!response?.cancelled) showToast(response?.error || "选择应用失败");
    return;
  }
  editLauncherPath.value = response.executablePath || "";
  editLauncherName.value = launcher.builtin ? launcher.name : (response.displayName || editLauncherName.value);
}

editLauncherIconInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const launcher = findCurrentLauncher(editingLauncherId);
  if (!launcher) return;
  try {
    await handleLauncherIconUpload(launcher, file);
    renderLauncherTable();
    showToast("图标已更新");
  } catch (err) {
    showToast(`图标上传失败：${err.message}`);
  } finally {
    e.target.value = "";
  }
});

// ========== 启动器操作 ==========
function findCurrentLauncher(launcherId) {
  return currentLaunchers.find((l) => l.launcherId === launcherId) || null;
}

async function handleDeleteLauncher(launcher) {
  if (launcher.builtin) { showToast("内置启动器不可删除"); return; }
  const hostStatus = await probeNativeHost();
  if (hostStatus.available) {
    try { await deleteLauncherIcon({ iconKey: launcher.iconKey }); } catch {}
  }
  currentLaunchers = normalizeCustomLaunchers(currentLaunchers.filter((l) => l.launcherId !== launcher.launcherId));
  renderLauncherTable();
  showToast("启动器已删除");
}

async function handleAddLauncher() {
  const draft = createCustomLauncherDraft({ seed: Date.now().toString(36) }, currentLaunchers);
  currentLaunchers = normalizeCustomLaunchers([...currentLaunchers, draft]);
  renderLauncherTable();
  showToast("已新增打开方式");
}

async function handleDiscoverLaunchers() {
  const hostStatus = await probeNativeHost();
  if (!hostStatus.available) { showToast("原生助手未安装"); return; }
  const response = await discoverNativeLaunchers();
  if (!response?.ok) throw new Error(response?.error || "检测失败");
  currentLaunchers = applyDiscoveredLaunchers(currentLaunchers, response.launchers || []);
  renderLauncherTable();
  const found = (response.launchers || []).filter((l) => l.executablePath).map((l) => l.name);
  showToast(`检测完成：${found.length ? found.join("、") : "无新发现"}`);
}

async function handleLauncherIconUpload(launcher, file) {
  if (!file) return;
  if (!["image/png", "image/webp"].includes(file.type)) throw new Error("仅支持 png/webp");
  if (file.size > 512 * 1024) throw new Error("图标不能超过 512KB");
  const hostStatus = await probeNativeHost();
  if (!hostStatus.available) throw new Error("原生助手未安装");
  const reader = new FileReader();
  const dataUrl = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
  const response = await saveLauncherIcon({ iconKey: launcher.iconKey, fileName: file.name, content: dataUrl });
  if (!response?.ok) throw new Error(response?.error || "保存图标失败");
}

addLauncherBtn.addEventListener("click", () => runWithButtonBusy(addLauncherBtn, handleAddLauncher));
discoverLaunchersBtn.addEventListener("click", () => runWithButtonBusy(discoverLaunchersBtn, handleDiscoverLaunchers));

// ========== 默认目录 ==========
let fallbackPaths = { cloudpivot: "", h3yun: "" };
let activeDefaultDirPlatform = "cloudpivot";

function setDefaultDirPlatform(platform) {
  activeDefaultDirPlatform = platform;
  defaultDirPlatform.value = platform;
  defaultDirPath.value = fallbackPaths[platform] || "";
  // 同步更新选择按钮的数据属性
  pickDefaultDirBtn.dataset.platform = platform;
}

defaultDirPlatform.addEventListener("change", () => setDefaultDirPlatform(defaultDirPlatform.value));

pickDefaultDirBtn.addEventListener("click", async () => {
  await runWithButtonBusy(pickDefaultDirBtn, () => handlePickFallbackDirectory(activeDefaultDirPlatform));
});

async function handlePickFallbackDirectory(platformKey) {
  const hostStatus = await probeNativeHost();
  if (!hostStatus.available) { showToast("原生助手未安装，请手动输入路径"); return; }
  const currentPath = defaultDirPath.value.trim();
  const response = await pickNativeDirectory(currentPath);
  if (!response?.ok) {
    if (!response?.cancelled) showToast(response?.error || "选择目录失败");
    return;
  }
  defaultDirPath.value = response.directoryPath || "";
  const label = platformKey === "h3yun" ? "氚云" : "云枢";
  showToast(`${label}默认目录已更新`);
}

// 同步 fallbackPaths 从输入框到内存
function syncFallbackPaths() {
  if (activeDefaultDirPlatform === "cloudpivot") {
    fallbackPaths.cloudpivot = defaultDirPath.value.trim();
  } else {
    fallbackPaths.h3yun = defaultDirPath.value.trim();
  }
}

// 切换平台前先保存当前输入
defaultDirPlatform.addEventListener("focus", () => syncFallbackPaths());
defaultDirPath.addEventListener("change", () => syncFallbackPaths());

// ========== 更新模块 ==========
function formatUpdateCheckTime(value) {
  if (!value) return "未检查";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function renderUpdateResult(result) {
  syncUpdateBtn.hidden = true;

  if (!result) {
    updateBanner.hidden = true;
    updateStatusText.hidden = false;
    updateStatusText.textContent = "尚未检查更新。";
    return;
  }

  if (!result.ok) {
    updateBanner.hidden = true;
    updateStatusText.hidden = false;
    updateStatusText.textContent = `检查更新失败：${result.error || "未知错误"}`;
    return;
  }

  if (result.synced) {
    updateBanner.hidden = false;
    updateStatusText.hidden = true;
    updateBannerText.textContent = `已同步到最新版本 (v${result.currentVersion || CURRENT_EXTENSION_VERSION})。请在 chrome://extensions 重新加载。`;
    updateBanner.style.background = "rgba(45, 138, 86, 0.08)";
    updateBanner.style.border = "1px solid rgba(45, 138, 86, 0.2)";
    updateBannerText.style.color = "var(--success)";
    return;
  }

  if (result.updateAvailable) {
    updateBanner.hidden = false;
    updateStatusText.hidden = true;
    updateBannerText.textContent = `发现新版本：v${result.currentVersion || CURRENT_EXTENSION_VERSION} → v${result.latestVersion || "?"}`;
    updateBanner.style.background = "rgba(183, 121, 31, 0.07)";
    updateBanner.style.border = "1px solid rgba(183, 121, 31, 0.18)";
    updateBannerText.style.color = "var(--warn)";
    syncUpdateBtn.hidden = false;
  } else {
    updateBanner.hidden = true;
    updateStatusText.hidden = false;
    updateStatusText.textContent = `已是最新版本 (v${CURRENT_EXTENSION_VERSION})。`;
  }

  updateLastCheck.textContent = `上次检查：${formatUpdateCheckTime(result.checkedAt)}`;
}

async function handleCheckUpdate() {
  const result = await checkForUpdate();
  renderUpdateResult(result);
  // 保存结果到 config
  if (currentConfig) {
    currentConfig.lastUpdateCheckResult = result;
  }
}

async function handleSyncUpdate() {
  const hostStatus = await probeNativeHost();
  const preflightResults = [
    createNativeHostPreflightResult(hostStatus),
    createUpdateOverwriteRiskResult()
  ];
  setStatusOutput([
    "自动预检完成。",
    `operationId=${PREFLIGHT_OPERATION_IDS.updateSync}`,
    ...formatPreflightStatusLines(preflightResults)
  ].join("\n"));

  if (hasBlockingPreflightResult(preflightResults)) {
    await saveLastDiagnosticPackage(buildDiagnosticPackage({
      ...buildExtensionDiagnosticContext(),
      operationId: PREFLIGHT_OPERATION_IDS.updateSync,
      logs: [], pageProbe: {}, directorySnapshot: {},
      preflightResults, nativeHost: hostStatus
    }));
    await renderLastDiagnosticSummary();
    return;
  }

  const result = await syncFromGit();
  await saveLastDiagnosticPackage(buildDiagnosticPackage({
    ...buildExtensionDiagnosticContext(),
    operationId: PREFLIGHT_OPERATION_IDS.updateSync,
    logs: [], pageProbe: {}, directorySnapshot: {},
    preflightResults, nativeHost: hostStatus, updateSync: result
  }));
  await renderLastDiagnosticSummary();
  renderUpdateResult(result);
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
    evidence: "syncFromGit uses git reset --hard origin/master through Native Host",
    data: { command: "git reset --hard origin/master" }
  });
}

checkUpdateBtn.addEventListener("click", () => runWithButtonBusy(checkUpdateBtn, handleCheckUpdate));
syncUpdateBtn.addEventListener("click", () => runWithButtonBusy(syncUpdateBtn, handleSyncUpdate));

// ========== 文件生成渲染 ==========
const GENFILE_LABELS = {
  fromCode: "FromCode.md",
  css: "CSS 样式",
  js: "JS 脚本",
  html: "HTML 模板",
  cs: "C# 后端",
  readme: "README.md",
  agents: "AGENTS.md",
  design: "DESIGN.md"
};

const GENFILE_DESC = {
  fromCode: "必需文件",
  css: "表单/列表样式",
  js: "表单/列表脚本",
  html: "表单/列表模板",
  cs: "后端代码",
  readme: "需求文档",
  agents: "AI 规则",
  design: "设计文档"
};

function getGenfileKeys(platform) {
  return platform === "h3yun"
    ? ["fromCode", "js", "cs", "readme", "agents", "design"]
    : ["fromCode", "css", "js", "html", "readme", "agents", "design"];
}

function renderGenfilesToggles(platform) {
  genfilesToggles.replaceChildren();
  const keys = getGenfileKeys(platform);
  const platformGenFiles = currentGeneratedFiles[platform] || DEFAULT_GENERATED_FILES[platform];

  for (const key of keys) {
    const isFromCode = key === "fromCode";
    const checked = platformGenFiles[key] === true;
    const label = GENFILE_LABELS[key] || key;
    const desc = GENFILE_DESC[key] || "";

    const tag = document.createElement("label");
    tag.className = `genfile-tag ${checked ? "is-checked" : ""} ${isFromCode ? "is-required" : ""}`;
    tag.title = desc;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.disabled = isFromCode;
    input.dataset.genfilesPlatform = platform;
    input.dataset.genfilesKey = key;
    input.addEventListener("change", () => {
      tag.classList.toggle("is-checked", input.checked);
      syncGenfilesFromDom();
    });

    const text = document.createElement("span");
    text.textContent = label;

    tag.append(input, text);
    genfilesToggles.appendChild(tag);
  }
}

function syncGenfilesFromDom() {
  const inputs = document.querySelectorAll("[data-genfiles-platform][data-genfiles-key]");
  for (const input of inputs) {
    const pk = input.dataset.genfilesPlatform;
    const gk = input.dataset.genfilesKey;
    if (!currentGeneratedFiles[pk]) currentGeneratedFiles[pk] = {};
    currentGeneratedFiles[pk][gk] = input.checked === true;
  }
}

genfilesPlatform.addEventListener("change", () => {
  renderGenfilesToggles(genfilesPlatform.value);
});

// ========== 诊断 ==========
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

function buildExtensionDiagnosticContext() {
  return {
    extension: { name: chrome.runtime.getManifest().name, version: chrome.runtime.getManifest().version },
    browser: { userAgent: navigator.userAgent }
  };
}

function buildDownloadTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function downloadJsonFile(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function handleExportLastDiagnostic() {
  const packageData = await loadLastDiagnosticPackage();
  if (!packageData) { showToast("暂无诊断数据"); return; }
  downloadJsonFile(`cloudpiovt-plugin-diagnostic-${buildDownloadTimestamp()}.json`, packageData);
  await renderLastDiagnosticSummary();
  showToast("诊断 JSON 已导出");
}

async function handleCopyDiagnosticSummary() {
  const packageData = await renderLastDiagnosticSummary();
  if (!packageData) { showToast("暂无诊断数据"); return; }
  await navigator.clipboard.writeText(summarizeDiagnosticPackage(packageData));
  showToast("诊断摘要已复制");
}

copyDiagnosticSummaryBtn.addEventListener("click", () => runWithButtonBusy(copyDiagnosticSummaryBtn, handleCopyDiagnosticSummary));
exportLastDiagnosticBtn.addEventListener("click", () => runWithButtonBusy(exportLastDiagnosticBtn, handleExportLastDiagnostic));

// ========== 帮助 / 版本记录 ==========
function renderReleaseNotes() {
  // 版本标记
  releasePills.replaceChildren(
    ...RELEASE_NOTES.map((release) => {
      const pill = document.createElement("span");
      pill.className = "release-pill";
      pill.textContent = `v${release.version}`;
      pill.title = release.title;
      pill.addEventListener("click", () => {
        releaseMoreBtn.click();
        // 滚动到对应版本
        setTimeout(() => {
          const card = releaseFull.querySelector(`[data-release-version="${release.version}"]`);
          card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 100);
      });
      return pill;
    })
  );

  // 最近 3 条紧凑展示
  const recentNotes = RELEASE_NOTES.slice(0, RECENT_RELEASE_COUNT);
  releaseCompact.replaceChildren(
    ...recentNotes.map((release) => {
      const div = document.createElement("div");
      div.className = "release-compact-item";
      div.innerHTML = `<strong>v${release.version}</strong> ${release.items.slice(0, 2).join(" | ")}`;
      return div;
    })
  );

  // 完整列表
  releaseFull.replaceChildren(
    ...RELEASE_NOTES.map((release) => {
      const article = document.createElement("article");
      article.className = "release-card";
      article.dataset.releaseVersion = release.version;
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

  releaseMoreBtn.hidden = RELEASE_NOTES.length <= RECENT_RELEASE_COUNT;
}

releaseMoreBtn.addEventListener("click", () => {
  releaseExpanded = !releaseExpanded;
  releaseFull.hidden = !releaseExpanded;
  releaseMoreBtn.textContent = releaseExpanded ? "收起" : "查看全部";
  // 展开时隐藏紧凑视图
  releaseCompact.style.display = releaseExpanded ? "none" : "";
});

// ========== 保存与恢复 ==========
async function handleSubmit() {
  // 同步默认目录
  syncFallbackPaths();

  const nextConfig = await saveConfig({
    customLaunchers: currentLaunchers,
    fallbackDirectoryPaths: { ...fallbackPaths },
    autoCheckUpdates: autoCheckUpdatesField.checked,
    generatedFiles: currentGeneratedFiles,
    h3yunOneClickWriteback: h3yunOneClickWritebackField.checked
  });

  currentConfig = nextConfig;
  updateTopBarStatus(nextConfig);
  showToast("已保存");

  saveBtn.classList.add("is-saved");
  setTimeout(() => saveBtn.classList.remove("is-saved"), 1200);
}

async function handleReset() {
  const nextConfig = await saveConfig({
    customLaunchers: DEFAULT_CONFIG.customLaunchers,
    fallbackDirectoryPaths: DEFAULT_CONFIG.fallbackDirectoryPaths,
    autoCheckUpdates: DEFAULT_CONFIG.autoCheckUpdates,
    lastUpdateCheckResult: DEFAULT_CONFIG.lastUpdateCheckResult,
    generatedFiles: DEFAULT_GENERATED_FILES,
    h3yunOneClickWriteback: true
  });

  currentConfig = nextConfig;
  currentLaunchers = normalizeCustomLaunchers(nextConfig.customLaunchers);
  currentGeneratedFiles = nextConfig.generatedFiles || DEFAULT_GENERATED_FILES;
  renderAllConfigUI(nextConfig);
  showToast("已恢复默认");

  resetBtn.classList.add("is-reset");
  setTimeout(() => resetBtn.classList.remove("is-reset"), 1200);
}

saveBtn.addEventListener("click", () => runWithButtonBusy(saveBtn, handleSubmit));
resetBtn.addEventListener("click", () => runWithButtonBusy(resetBtn, handleReset));

// ========== 配置渲染 ==========
function renderAllConfigUI(config) {
  currentConfig = config;
  currentLaunchers = normalizeCustomLaunchers(config.customLaunchers);
  currentGeneratedFiles = config.generatedFiles || DEFAULT_GENERATED_FILES;

  fallbackPaths = {
    cloudpivot: config.fallbackDirectoryPaths?.cloudpivot || "",
    h3yun: config.fallbackDirectoryPaths?.h3yun || ""
  };
  setDefaultDirPlatform(activeDefaultDirPlatform);

  autoCheckUpdatesField.checked = config.autoCheckUpdates === true;
  h3yunOneClickWritebackField.checked = config.h3yunOneClickWriteback !== false;

  renderLauncherTable();
  renderGenfilesToggles(genfilesPlatform.value);
  renderUpdateResult(config.lastUpdateCheckResult);
  updateTopBarStatus(config);
  setStatusOutput("配置已加载。");
}

// ========== 初始化 ==========
async function init() {
  const collapseState = loadCollapseState();
  applyCollapseState(collapseState);

  renderReleaseNotes();
  setDefaultDirPlatform("cloudpivot");

  const config = await loadConfig();
  hostStatus = await probeNativeHost();
  hostAvailable = hostStatus.available;

  renderAllConfigUI(config);
  await renderLastDiagnosticSummary();

  setStatusOutput(
    hostAvailable
      ? `配置已加载。\n原生助手已连接：${hostStatus.hostName} ${hostStatus.version}`
      : "配置已加载。\n原生助手未安装。"
  );
}

init().catch((error) => {
  setStatusOutput(`配置加载失败。\n${error?.message || String(error)}`);
});
