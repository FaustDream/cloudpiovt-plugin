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

const form = document.querySelector("#settings-form");
const saveButton = document.querySelector("#save-btn");
const resetButton = document.querySelector("#reset-btn");
const vscodePathField = document.querySelector("#vscode-executable-path");
const ideaPathField = document.querySelector("#idea-executable-path");
const pickVscodeButton = document.querySelector("#pick-vscode-btn");
const pickIdeaButton = document.querySelector("#pick-idea-btn");
const cloudpivotReadonlyList = document.querySelector("#cloudpivot-readonly-settings-list");
const h3yunReadonlyList = document.querySelector("#h3yun-readonly-settings-list");
const cloudpivotControlTypeReferenceBody = document.querySelector("#cloudpivot-control-type-reference-body");
const h3yunControlTypeReferenceBody = document.querySelector("#h3yun-control-type-reference-body");
const nativeHostStatus = document.querySelector("#native-host-status");
const statusOutput = document.querySelector("#settings-status");
const sectionNavLinks = Array.from(document.querySelectorAll("[data-nav-link]"));
const platformTabButtons = Array.from(document.querySelectorAll("[data-options-platform-tab]"));
const platformPanels = Array.from(document.querySelectorAll("[data-options-platform-panel]"));

function setStatus(message) {
  statusOutput.textContent = message;
}

function setNativeHostStatus(message) {
  nativeHostStatus.textContent = message;
}

function setActiveNavLink(sectionId) {
  for (const link of sectionNavLinks) {
    const isActive = link.getAttribute("href") === `#${sectionId}`;
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

  if (!sections.length) {
    return;
  }

  setActiveNavLink(sections[0].id);

  // 使用可见区块驱动导航高亮，避免长页面滚动时用户丢失当前位置。
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

  for (const section of sections) {
    observer.observe(section);
  }
}

function setActivePlatform(platformKey) {
  const normalizedPlatformKey = platformKey === "h3yun" ? "h3yun" : "cloudpivot";

  // 设置页的平台标签只控制说明数据的显示，避免云枢规则、氚云规则和控件参考混在同一屏里。
  for (const button of platformTabButtons) {
    const isActive = button.dataset.optionsPlatformTab === normalizedPlatformKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }

  for (const panel of platformPanels) {
    const isActive = panel.dataset.optionsPlatformPanel === normalizedPlatformKey;
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
  setStatus(
    [
      "配置已加载",
      `VS Code 路径: ${config.vscodeExecutablePath || "未配置"}`,
      `IDEA 路径: ${config.ideaExecutablePath || "未配置"}`
    ].join("\n")
  );
}

async function pickEditorPath(targetField, defaultHint) {
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
      ideaExecutablePath: ideaPathField.value
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
      ideaExecutablePath: DEFAULT_CONFIG.ideaExecutablePath
    });
    renderConfig(nextConfig);
    setStatus("已恢复默认配置。");
  } catch (error) {
    setStatus(`恢复默认失败。\n${error?.message || String(error)}`);
  } finally {
    resetButton.disabled = false;
  }
}

async function init() {
  bindSectionNavigation();
  renderReadonlySettings();
  renderCloudpivotControlTypeReference();
  renderH3yunControlTypeReference();
  setActivePlatform("cloudpivot");
  renderConfig(await loadConfig());
  const hostStatus = await probeNativeHost();
  setNativeHostStatus(
    hostStatus.available
      ? `原生助手已连接：${hostStatus.hostName} ${hostStatus.version}`
      : `原生助手未连接：${hostStatus.error || "未连接"}`
  );
}

pickVscodeButton.addEventListener("click", async () => {
  pickVscodeButton.disabled = true;
  try {
    await pickEditorPath(vscodePathField, "Code.exe");
    setStatus("已回填 VS Code 路径。");
  } catch (error) {
    setStatus(`选择 VS Code 路径失败。\n${error?.message || String(error)}`);
  } finally {
    pickVscodeButton.disabled = false;
  }
});

pickIdeaButton.addEventListener("click", async () => {
  pickIdeaButton.disabled = true;
  try {
    await pickEditorPath(ideaPathField, "idea64.exe");
    setStatus("已回填 IDEA 路径。");
  } catch (error) {
    setStatus(`选择 IDEA 路径失败。\n${error?.message || String(error)}`);
  } finally {
    pickIdeaButton.disabled = false;
  }
});

for (const button of platformTabButtons) {
  button.addEventListener("click", () => setActivePlatform(button.dataset.optionsPlatformTab));
}

form.addEventListener("submit", handleSubmit);
resetButton.addEventListener("click", handleReset);

init().catch((error) => {
  setStatus(`配置加载失败。\n${error?.message || String(error)}`);
});
