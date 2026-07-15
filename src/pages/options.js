import {
  CLOUDPIVOT_READONLY_SETTINGS,
  DEFAULT_CONFIG,
  DEFAULT_GENERATED_FILES,
  H3YUN_READONLY_SETTINGS,
  loadConfig,
  saveConfig
} from "../../lib/config.js";
import {
  pickNativeDirectory,
  probeNativeHost
} from "../../lib/services/native-host.js";
import { CURRENT_EXTENSION_VERSION, RELEASE_NOTES } from "../../lib/release-notes.js";
import { checkForUpdate, syncFromGit } from "../../lib/services/update-check.js";
import {
  CONTROL_TYPE_REFERENCE,
  H3YUN_CONTROL_TYPE_REFERENCE
} from "../../lib/platform/control-metadata.js";
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

// 使用说明
const helpPlatformTabs = Array.from(document.querySelectorAll("[data-help-platform]"));
const helpPlatformPanels = Array.from(document.querySelectorAll("[data-help-panel]"));
const cloudpivotControlRefBody = document.querySelector("#cloudpivot-control-ref-body");
const h3yunControlRefBody = document.querySelector("#h3yun-control-ref-body");
const cloudpivotRulesList = document.querySelector("#cloudpivot-rules-list");
const h3yunRulesList = document.querySelector("#h3yun-rules-list");
let activeHelpPlatform = "cloudpivot";

// 版本记录
const releaseCompact = document.querySelector("#release-compact");
const releaseMoreBtn = document.querySelector("#release-more-btn");
const releaseFull = document.querySelector("#release-full");

// ========== 状态 ==========
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
function updateTopBarStatus() {
  const parts = [`v${CURRENT_EXTENSION_VERSION}`];
  if (hostAvailable) {
    parts.push(`已连接 (${hostStatus?.hostName || "native-host"})`);
  } else {
    parts.push("未安装");
  }
  topBarStatus.textContent = parts.join(" · ");
}

// ========== 默认目录 ==========
let fallbackPaths = { cloudpivot: "", h3yun: "" };
let activeDefaultDirPlatform = "cloudpivot";

function setDefaultDirPlatform(platform) {
  activeDefaultDirPlatform = platform;
  defaultDirPlatform.value = platform;
  defaultDirPath.value = fallbackPaths[platform] || "";
}

defaultDirPlatform.addEventListener("change", () => setDefaultDirPlatform(defaultDirPlatform.value));

pickDefaultDirBtn.addEventListener("click", async () => {
  await runWithButtonBusy(pickDefaultDirBtn, () => handlePickFallbackDirectory(activeDefaultDirPlatform));
});

async function handlePickFallbackDirectory(platformKey) {
  const hs = await probeNativeHost();
  if (!hs.available) { showToast("原生助手未安装，请手动输入路径"); return; }
  const currentPath = defaultDirPath.value.trim();
  const response = await pickNativeDirectory(currentPath);
  if (!response?.ok) {
    if (!response?.cancelled) showToast(response?.error || "选择目录失败");
    return;
  }
  defaultDirPath.value = response.directoryPath || "";
  showToast(`${platformKey === "h3yun" ? "氚云" : "云枢"}默认目录已更新`);
}

function syncFallbackPaths() {
  if (activeDefaultDirPlatform === "cloudpivot") {
    fallbackPaths.cloudpivot = defaultDirPath.value.trim();
  } else {
    fallbackPaths.h3yun = defaultDirPath.value.trim();
  }
}

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
  if (currentConfig) currentConfig.lastUpdateCheckResult = result;
}

async function handleSyncUpdate() {
  const hs = await probeNativeHost();
  const preflightResults = [
    createNativeHostPreflightResult(hs),
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
      preflightResults, nativeHost: hs
    }));
    await renderLastDiagnosticSummary();
    return;
  }

  const result = await syncFromGit();
  await saveLastDiagnosticPackage(buildDiagnosticPackage({
    ...buildExtensionDiagnosticContext(),
    operationId: PREFLIGHT_OPERATION_IDS.updateSync,
    logs: [], pageProbe: {}, directorySnapshot: {},
    preflightResults, nativeHost: hs, updateSync: result
  }));
  await renderLastDiagnosticSummary();
  renderUpdateResult(result);
}

function createNativeHostPreflightResult(hs) {
  if (hs.available) {
    return createPreflightResult({
      operationId: PREFLIGHT_OPERATION_IDS.updateSync,
      checkId: "nativeHost.ping",
      severity: PREFLIGHT_SEVERITY.info,
      ok: true,
      evidence: "native host available",
      data: hs
    });
  }
  return createPreflightResult({
    operationId: PREFLIGHT_OPERATION_IDS.updateSync,
    checkId: "nativeHost.ping",
    severity: PREFLIGHT_SEVERITY.blocker,
    ok: false,
    errorCode: "NATIVE_HOST_UNAVAILABLE",
    evidence: hs.error || "native host unavailable",
    nextAction: "重新运行 scripts\\install-native-host.cmd 后重试。",
    data: hs
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

    const tag = document.createElement("label");
    tag.className = `genfile-tag ${checked ? "is-checked" : ""} ${isFromCode ? "is-required" : ""}`;

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

// ========== 使用说明渲染 ==========
function setActiveHelpPlatform(platformKey) {
  activeHelpPlatform = platformKey === "h3yun" ? "h3yun" : "cloudpivot";
  for (const button of helpPlatformTabs) {
    const isActive = button.dataset.helpPlatform === activeHelpPlatform;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }
  for (const panel of helpPlatformPanels) {
    const isActive = panel.dataset.helpPanel === activeHelpPlatform;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  }
}

for (const button of helpPlatformTabs) {
  button.addEventListener("click", () => setActiveHelpPlatform(button.dataset.helpPlatform));
}

function renderCloudpivotControlRef() {
  cloudpivotControlRefBody.replaceChildren(
    ...CONTROL_TYPE_REFERENCE.map((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><code>${item.tagName}</code></td><td>${item.typeName}</td><td>${item.notes || "-"}</td>`;
      return tr;
    })
  );
}

function renderH3yunControlRef() {
  h3yunControlRefBody.replaceChildren(
    ...H3YUN_CONTROL_TYPE_REFERENCE.map((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><code>${item.typeCode}</code></td><td>${item.typeName}</td><td>${item.notes || "-"}</td>`;
      return tr;
    })
  );
}

function renderRulesList(listElement, settings) {
  listElement.replaceChildren(
    ...settings.map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    })
  );
}

function renderHelpSection() {
  renderCloudpivotControlRef();
  renderH3yunControlRef();
  renderRulesList(cloudpivotRulesList, CLOUDPIVOT_READONLY_SETTINGS);
  renderRulesList(h3yunRulesList, H3YUN_READONLY_SETTINGS);
  setActiveHelpPlatform("cloudpivot");
}

// ========== 版本记录 ==========
function renderReleaseNotes() {
  const recentNotes = RELEASE_NOTES.slice(0, RECENT_RELEASE_COUNT);
  releaseCompact.replaceChildren(
    ...recentNotes.map((release) => {
      const div = document.createElement("div");
      div.className = "release-compact-item";
      div.innerHTML = `<strong>v${release.version}</strong> ${release.items.slice(0, 2).join(" | ")}`;
      return div;
    })
  );

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
  releaseCompact.style.display = releaseExpanded ? "none" : "";
});

// ========== 保存与恢复 ==========
async function handleSubmit() {
  syncFallbackPaths();

  const nextConfig = await saveConfig({
    fallbackDirectoryPaths: { ...fallbackPaths },
    autoCheckUpdates: autoCheckUpdatesField.checked,
    generatedFiles: currentGeneratedFiles,
    h3yunOneClickWriteback: h3yunOneClickWritebackField.checked
  });

  currentConfig = nextConfig;
  updateTopBarStatus();
  showToast("已保存");

  saveBtn.classList.add("is-saved");
  setTimeout(() => saveBtn.classList.remove("is-saved"), 1200);
}

async function handleReset() {
  const nextConfig = await saveConfig({
    fallbackDirectoryPaths: DEFAULT_CONFIG.fallbackDirectoryPaths,
    autoCheckUpdates: DEFAULT_CONFIG.autoCheckUpdates,
    lastUpdateCheckResult: DEFAULT_CONFIG.lastUpdateCheckResult,
    generatedFiles: DEFAULT_GENERATED_FILES,
    h3yunOneClickWriteback: true
  });

  currentConfig = nextConfig;
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
  currentGeneratedFiles = config.generatedFiles || DEFAULT_GENERATED_FILES;

  fallbackPaths = {
    cloudpivot: config.fallbackDirectoryPaths?.cloudpivot || "",
    h3yun: config.fallbackDirectoryPaths?.h3yun || ""
  };
  setDefaultDirPlatform(activeDefaultDirPlatform);

  autoCheckUpdatesField.checked = config.autoCheckUpdates === true;
  h3yunOneClickWritebackField.checked = config.h3yunOneClickWriteback !== false;

  renderGenfilesToggles(genfilesPlatform.value);
  renderUpdateResult(config.lastUpdateCheckResult);
  updateTopBarStatus();
  setStatusOutput("配置已加载。");
}

// ========== 初始化 ==========
async function init() {
  const collapseState = loadCollapseState();
  applyCollapseState(collapseState);

  renderHelpSection();
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
