import { DEFAULT_CONFIG, READONLY_SETTINGS, loadConfig, saveConfig } from "./lib/config.js";
import { pickNativeEditor, probeNativeHost } from "./lib/native-host.js";

const form = document.querySelector("#settings-form");
const saveButton = document.querySelector("#save-btn");
const resetButton = document.querySelector("#reset-btn");
const vscodePathField = document.querySelector("#vscode-executable-path");
const ideaPathField = document.querySelector("#idea-executable-path");
const pickVscodeButton = document.querySelector("#pick-vscode-btn");
const pickIdeaButton = document.querySelector("#pick-idea-btn");
const readonlyList = document.querySelector("#readonly-settings-list");
const nativeHostStatus = document.querySelector("#native-host-status");
const statusOutput = document.querySelector("#settings-status");

function setStatus(message) {
  statusOutput.textContent = message;
}

function setNativeHostStatus(message) {
  nativeHostStatus.textContent = message;
}

function renderReadonlySettings() {
  readonlyList.replaceChildren(
    ...READONLY_SETTINGS.map((text) => {
      const item = document.createElement("li");
      item.className = "readonly-list-item";
      item.textContent = text;
      return item;
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
  renderReadonlySettings();
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

form.addEventListener("submit", handleSubmit);
resetButton.addEventListener("click", handleReset);

init().catch((error) => {
  setStatus(`配置加载失败。\n${error?.message || String(error)}`);
});
