import {
  CLOUDPIVOT_READONLY_SETTINGS,
  DEFAULT_CONFIG,
  H3YUN_READONLY_SETTINGS,
  loadConfig,
  saveConfig
} from "./lib/config.js";
import {
  CONTROL_TYPE_REFERENCE,
  H3YUN_CONTROL_TYPE_REFERENCE
} from "./lib/control-metadata.js";
import { pickNativeEditor, probeNativeHost } from "./lib/native-host.js";
import { CURRENT_EXTENSION_VERSION, RELEASE_NOTES } from "./lib/release-notes.js";
import { checkForUpdate } from "./lib/update-check.js";

const form = document.querySelector("#settings-form");
const saveButton = document.querySelector("#save-btn");
const resetButton = document.querySelector("#reset-btn");
const vscodePathField = document.querySelector("#vscode-executable-path");
const ideaPathField = document.querySelector("#idea-executable-path");
const autoCheckUpdatesField = document.querySelector("#auto-check-updates");
const updateManifestUrlField = document.querySelector("#update-manifest-url");
const checkUpdateButton = document.querySelector("#check-update-btn");
const updateStatusOutput = document.querySelector("#update-status");
const downloadUpdateLink = document.querySelector("#download-update-link");
const pickVscodeButton = document.querySelector("#pick-vscode-btn");
const pickIdeaButton = document.querySelector("#pick-idea-btn");
const currentVersionEl = document.querySelector("#current-version");
const overviewVersionEl = document.querySelector("#overview-version");
const pathSummaryEl = document.querySelector("#path-summary");
const releaseNotesList = document.querySelector("#release-notes-list");
const cloudpivotReadonlyList = document.querySelector("#cloudpivot-readonly-settings-list");
const h3yunReadonlyList = document.querySelector("#h3yun-readonly-settings-list");
const cloudpivotControlTypeReferenceBody = document.querySelector("#cloudpivot-control-type-reference-body");
const h3yunControlTypeReferenceBody = document.querySelector("#h3yun-control-type-reference-body");
const nativeHostStatus = document.querySelector("#native-host-status");
const statusOutput = document.querySelector("#settings-status");
const sectionNavLinks = Array.from(document.querySelectorAll("[data-nav-link]"));
const docsTabButtons = Array.from(document.querySelectorAll("[data-docs-tab]"));
const docsPanels = Array.from(document.querySelectorAll("[data-docs-panel]"));
const platformTabButtons = Array.from(document.querySelectorAll("[data-platform-tab][data-platform-group]"));
const platformPanels = Array.from(document.querySelectorAll("[data-platform-panel][data-platform-group]"));

let activeDocsTabKey = "reference";

function setStatus(message) {
  statusOutput.textContent = message;
}

function setUpdateStatus(message) {
  updateStatusOutput.textContent = message;
}

function setNativeHostStatus(message) {
  nativeHostStatus.textContent = message;
}

function setVersionLabels() {
  currentVersionEl.textContent = CURRENT_EXTENSION_VERSION;
  overviewVersionEl.textContent = CURRENT_EXTENSION_VERSION;
}

function renderPathSummary(config) {
  const configuredCount = [config.vscodeExecutablePath, config.ideaExecutablePath].filter(Boolean).length;
  pathSummaryEl.textContent = configuredCount ? `已配置 ${configuredCount} 个` : "未配置";
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
  downloadUpdateLink.hidden = true;
  downloadUpdateLink.removeAttribute("href");

  if (!result) {
    setUpdateStatus("尚未检查更新。");
    return;
  }

  if (!result.ok) {
    setUpdateStatus(
      [
        "检查更新失败。",
        `时间：${formatUpdateCheckTime(result.checkedAt)}`,
        `地址：${result.manifestUrl}`,
        `原因：${result.error || "未知错误"}`
      ].join("\n")
    );
    return;
  }

  if (result.updateAvailable && result.downloadUrl) {
    downloadUpdateLink.href = result.downloadUrl;
    downloadUpdateLink.hidden = false;
  }

  const lines = [
    result.updateAvailable ? "发现新版本。" : "当前已是最新版本。",
    `当前版本：${result.currentVersion || CURRENT_EXTENSION_VERSION}`,
    `仓库版本：${result.latestVersion || "未知"}`,
    `检查时间：${formatUpdateCheckTime(result.checkedAt)}`,
    `配置地址：${result.manifestUrl}`
  ];

  if (result.title) {
    lines.push(`版本标题：${result.title}`);
  }
  if (result.downloadUrl) {
    lines.push(`下载地址：${result.downloadUrl}`);
  }
  if (result.notes?.length) {
    lines.push("更新说明：");
    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }
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

function setActiveNavLink(sectionId) {
  for (const link of sectionNavLinks) {
    const docsTarget = link.dataset.docsTarget || "";
    const isSameSection = link.getAttribute("href") === `#${sectionId}`;
    const isSameDocsTarget = !docsTarget || docsTarget === activeDocsTabKey;
    const isActive = isSameSection && isSameDocsTarget;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "true");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

function bindSectionNavigation() {
  if (!sectionNavLinks.length) {
    return;
  }

  const sections = sectionNavLinks
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);
  const uniqueSections = Array.from(new Set(sections));

  if (!uniqueSections.length) {
    return;
  }

  for (const link of sectionNavLinks) {
    link.addEventListener("click", () => {
      if (link.dataset.docsTarget) {
        setActiveDocsTab(link.dataset.docsTarget);
      }
      const targetSectionId = link.getAttribute("href")?.slice(1);
      if (targetSectionId) {
        setActiveNavLink(targetSectionId);
      }
    });
  }

  setActiveNavLink(uniqueSections[0].id);

  // 使用可见区块驱动导航高亮，让用户在重点区块和说明中心之间切换时保留位置感。
  if (!("IntersectionObserver" in window)) {
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    const activeEntry = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];

    if (activeEntry?.target?.id) {
      setActiveNavLink(activeEntry.target.id);
    }
  }, {
    rootMargin: "-20% 0px -60% 0px",
    threshold: [0.15, 0.35, 0.6]
  });

  for (const section of uniqueSections) {
    observer.observe(section);
  }
}

function setActiveDocsTab(tabKey, shouldSyncNav = true) {
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

  if (shouldSyncNav) {
    setActiveNavLink("docs-center");
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

function renderConfig(config) {
  vscodePathField.value = config.vscodeExecutablePath;
  ideaPathField.value = config.ideaExecutablePath;
  autoCheckUpdatesField.checked = config.autoCheckUpdates === true;
  updateManifestUrlField.value = config.updateManifestUrl || DEFAULT_CONFIG.updateManifestUrl;
  renderPathSummary(config);
  renderUpdateResult(config.lastUpdateCheckResult);
  setStatus(
    [
      "配置已加载",
      `VS Code 路径: ${config.vscodeExecutablePath || "未配置"}`,
      `IDEA 路径: ${config.ideaExecutablePath || "未配置"}`,
      `自动检查更新: ${config.autoCheckUpdates ? "开启" : "关闭"}`
    ].join("\n")
  );
}

async function pickEditorPath(targetField, defaultHint) {
  // “选择应用”依赖原生助手；未安装时保留手动粘贴路径，避免用户被单个按钮卡住。
  const hostStatus = await probeNativeHost();
  if (!hostStatus.available) {
    setStatus("当前未安装原生助手，请先双击 scripts\\install-native-host.cmd；也可以临时手动粘贴应用路径后保存。");
    targetField.focus();
    return;
  }

  const response = await pickNativeEditor(targetField.value || defaultHint);
  if (!response?.ok) {
    if (response?.cancelled) {
      setStatus("已取消选择应用。");
      return;
    }
    throw new Error(response?.error || "选择应用失败");
  }
  targetField.value = response.executablePath || "";
}

async function handleSubmit(event) {
  event.preventDefault();
  saveButton.disabled = true;

  try {
    const nextConfig = await saveConfig({
      vscodeExecutablePath: vscodePathField.value,
      ideaExecutablePath: ideaPathField.value,
      autoCheckUpdates: autoCheckUpdatesField.checked,
      updateManifestUrl: updateManifestUrlField.value
    });
    renderConfig(nextConfig);
    setStatus("保存成功。");
  } catch (error) {
    setStatus(`保存失败。\n${error?.message || String(error)}`);
  } finally {
    saveButton.disabled = false;
  }
}

async function handleReset() {
  resetButton.disabled = true;
  try {
    const nextConfig = await saveConfig({
      vscodeExecutablePath: DEFAULT_CONFIG.vscodeExecutablePath,
      ideaExecutablePath: DEFAULT_CONFIG.ideaExecutablePath,
      autoCheckUpdates: DEFAULT_CONFIG.autoCheckUpdates,
      updateManifestUrl: DEFAULT_CONFIG.updateManifestUrl,
      lastUpdateCheckResult: DEFAULT_CONFIG.lastUpdateCheckResult
    });
    renderConfig(nextConfig);
    setStatus("已恢复默认配置。");
  } catch (error) {
    setStatus(`恢复默认失败。\n${error?.message || String(error)}`);
  } finally {
    resetButton.disabled = false;
  }
}

async function handleCheckUpdate() {
  checkUpdateButton.disabled = true;
  setUpdateStatus("正在检查 Git 仓库更新...");

  try {
    const nextConfig = await saveConfig({
      autoCheckUpdates: autoCheckUpdatesField.checked,
      updateManifestUrl: updateManifestUrlField.value
    });
    autoCheckUpdatesField.checked = nextConfig.autoCheckUpdates;
    updateManifestUrlField.value = nextConfig.updateManifestUrl;

    // 手动检查会立即读取 update.json，并把结果写入本地配置供下次打开设置页展示。
    const result = await checkForUpdate({ manifestUrl: nextConfig.updateManifestUrl });
    renderUpdateResult(result);
  } catch (error) {
    setUpdateStatus(`检查更新失败。\n${error?.message || String(error)}`);
  } finally {
    checkUpdateButton.disabled = false;
  }
}

async function init() {
  bindSectionNavigation();
  setVersionLabels();
  renderReadonlySettings();
  renderReleaseNotes();
  renderCloudpivotControlTypeReference();
  renderH3yunControlTypeReference();
  setActiveDocsTab("reference", false);
  setActivePlatform("reference", "cloudpivot");
  setActivePlatform("flow", "cloudpivot");
  renderConfig(await loadConfig());
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

pickVscodeButton.addEventListener("click", () => runWithButtonBusy(pickVscodeButton, async () => {
  pickVscodeButton.disabled = true;
  try {
    await pickEditorPath(vscodePathField, "Code.exe");
    setStatus("已回填 VS Code 路径。");
  } catch (error) {
    setStatus(`选择 VS Code 路径失败。\n${error?.message || String(error)}`);
  } finally {
    pickVscodeButton.disabled = false;
  }
}));

pickIdeaButton.addEventListener("click", () => runWithButtonBusy(pickIdeaButton, async () => {
  pickIdeaButton.disabled = true;
  try {
    await pickEditorPath(ideaPathField, "idea64.exe");
    setStatus("已回填 IDEA 路径。");
  } catch (error) {
    setStatus(`选择 IDEA 路径失败。\n${error?.message || String(error)}`);
  } finally {
    pickIdeaButton.disabled = false;
  }
}));

for (const button of docsTabButtons) {
  button.addEventListener("click", () => setActiveDocsTab(button.dataset.docsTab));
}

for (const button of platformTabButtons) {
  button.addEventListener("click", () => setActivePlatform(button.dataset.platformGroup, button.dataset.platformTab));
}

form.addEventListener("submit", (event) => runWithButtonBusy(saveButton, () => handleSubmit(event)));
resetButton.addEventListener("click", () => runWithButtonBusy(resetButton, handleReset));
checkUpdateButton.addEventListener("click", () => runWithButtonBusy(checkUpdateButton, handleCheckUpdate));

init().catch((error) => {
  setStatus(`配置加载失败。\n${error?.message || String(error)}`);
});
