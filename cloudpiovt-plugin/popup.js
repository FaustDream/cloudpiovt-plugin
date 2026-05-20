import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_SELECTION_STRATEGY,
  isOriginAllowed,
  loadConfig,
  resolvePageTypeConfig
} from "./lib/config.js";
import {
  ensureTargetDirectorySelection,
  fileExistsInSelection,
  readFilesFromSelection,
  refreshTargetDirectorySelection,
  writeFilesToSelection
} from "./lib/target-directory-access.js";
import {
  createTargetDirectoryPageScope,
  ensureTargetDirectorySnapshot,
  getStoredTargetDirectorySelection,
  saveNativeTargetDirectorySelection
} from "./lib/target-directory-state.js";
import { buildFromCodeContent, buildReadmeContent, extractReadmeMetadataFromHtml } from "./lib/readme-parser.js";
import { launchNativeEditor, pickNativeDirectory } from "./lib/native-host.js";

const pageOriginEl = document.querySelector("#page-origin");
const targetHandleEl = document.querySelector("#target-handle");
const targetPathEl = document.querySelector("#target-path");
const refreshHandleButton = document.querySelector("#refresh-handle-btn");
const statusOutput = document.querySelector("#status-output");
const frontendCaptureWriteButton = document.querySelector("#frontend-capture-write-btn");
const frontendWritebackButton = document.querySelector("#frontend-writeback-btn");
const bizruleCaptureWriteButton = document.querySelector("#bizrule-capture-write-btn");
const bizruleWritebackButton = document.querySelector("#bizrule-writeback-btn");
const openVscodeButton = document.querySelector("#open-vscode-btn");
const openIdeaButton = document.querySelector("#open-idea-btn");
const openOptionsButton = document.querySelector("#open-options-btn");

let currentPageContext = null;

function setBusy(isBusy) {
  frontendCaptureWriteButton.disabled = isBusy;
  frontendWritebackButton.disabled = isBusy;
  bizruleCaptureWriteButton.disabled = isBusy;
  bizruleWritebackButton.disabled = isBusy;
  refreshHandleButton.disabled = isBusy;
  openVscodeButton.disabled = isBusy;
  openIdeaButton.disabled = isBusy;
}

function setStatus(message) {
  statusOutput.textContent = Array.isArray(message) ? message.join("\n") : String(message || "");
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

async function updatePageInfo() {
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
    const pathHandleLabel = targetPath
      ? targetPath.split(/[\\/]/).filter(Boolean).pop() || targetPath
      : "未授权";
    targetHandleEl.textContent = targetPath ? pathHandleLabel : (selection.handle?.name || "未授权");
    setCopyableValue(targetPathEl, {
      fullValue: targetPath,
      shortLabel: "复制路径",
      emptyLabel: "未保存",
      copyLabel: "绝对路径"
    });
  } catch (error) {
    targetHandleEl.textContent = "读取失败";
    setCopyableValue(targetPathEl, {
      fullValue: "",
      shortLabel: "复制路径",
      emptyLabel: "读取失败",
      copyLabel: "绝对路径"
    });
    setStatus(`读取目标目录失败。
${error?.message || String(error)}`);
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

  const response = await pickNativeDirectory("");
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
  const selection = await refreshTargetDirectorySelection(pageType, targetScope);
  await updateDirectoryInfo(pageType, targetScope);
  return {
    handleLabel:
      selection.kind === "handle"
        ? (selection.label || "未授权")
        : (selection.directoryPath.split(/[\\/]/).filter(Boolean).pop() || selection.directoryPath),
    directoryPath: selection.kind === "native-path" ? selection.directoryPath : ""
  };
}

async function handleRefreshDirectoryHandle() {
  setBusy(true);
  setStatus("正在更新目标目录...");

  try {
    const { pageType, targetScope } = await updatePageInfo();
    const selection = await refreshDirectoryHandle(pageType, targetScope);
    setStatus([
      "目标目录已更新。",
      `目录句柄：${selection.handleLabel || "未授权"}`,
      `绝对路径：${selection.directoryPath || "未保存"}`
    ]);
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("已取消更新目标目录。");
      return;
    }
    setStatus(`更新目标目录失败。
${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

async function handleOpenEditor(editorType) {
  setBusy(true);
  const editorLabel = editorType === "vscode" ? "VS Code" : "IDEA";
  setStatus(`正在打开 ${editorLabel}...`);

  try {
    const { pageType, targetScope } = await updatePageInfo();
    const config = await loadConfig();
    const executablePath = editorType === "vscode"
      ? config.vscodeExecutablePath
      : config.ideaExecutablePath;

    if (!executablePath) {
      throw new Error(`请先在设置页配置 ${editorLabel} 可执行文件路径。`);
    }

    const targetPath = await ensureLaunchTargetPath(pageType, targetScope);

    const response = await launchNativeEditor({
      executablePath,
      targetPath
    });

    if (!response?.ok) {
      throw new Error(response?.error || `打开 ${editorLabel} 失败。`);
    }

    setStatus([
      `${editorLabel} 已打开目标目录。`,
      `页面类型：${getCurrentPageContext().pageTypeConfig.pageLabel}`,
      `目标目录：${targetPath}`,
      `可执行文件：${executablePath}`
    ]);
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus(`已取消打开 ${editorLabel}。`);
      return;
    }
    setStatus(`打开 ${editorLabel} 失败。\n${error?.message || String(error)}`);
  } finally {
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
      details: `目标目录中不存在文件：${fileName}`
    };
  }

  return {
    ok: true,
    fileName,
    content: normalizeExcessBlankLines(fileResult.content)
  };
}

async function writeReadmeFile(directorySelection, metadata, pageTypeConfig, pageUrl) {
  const readmeContent = buildReadmeContent(metadata, pageTypeConfig, pageUrl);
  const fromCodeContent = buildFromCodeContent(metadata, pageTypeConfig, pageUrl);
  // README.MD 保持自动创建但只放人工说明，编码映射统一沉淀到 FromCode.md。
  await writeFilesToSelection(directorySelection, [
    {
      fileName: "README.MD",
      content: readmeContent
    },
    {
      fileName: "FromCode.md",
      content: fromCodeContent
    }
  ]);
}

function describeDirectoryAccessMode(directorySelection) {
  return directorySelection.kind === "native-path"
    ? "Native Host"
    : "File System Access API";
}

async function handleCaptureAndWrite() {
  setBusy(true);
  setStatus("正在抓取并写入...");

  try {
    const pageContext = await updatePageInfo();
    const { tab, pageType, pageTypeConfig, targetScope } = pageContext;
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      throw new Error(executableContextError);
    }

    const originError = getOriginError(tab.url);
    if (originError) {
      throw new Error(originError);
    }

    const directorySelection = await ensureDirectoryAccessForOperation(pageType, "readwrite", targetScope);
    const hadReadme = await fileExists(directorySelection, "README.MD");

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
${result?.details || result?.errorCode || "未知错误"}`);
      return;
    }

    const exportPlan = buildCodeExportPlan(result.data, pageTypeConfig);
    if (!exportPlan.ok) {
      setStatus(`写入失败。
${exportPlan.details || exportPlan.errorCode || "未知错误"}`);
      return;
    }

    await writeCodeFilesToDirectory(directorySelection, exportPlan.filesToWrite);
    const exportedHtml = exportPlan.filesToWrite.find((item) => item.key === "html")?.content || "";
    const readmeMetadata = extractReadmeMetadataFromHtml(exportedHtml, result.pageUrl || tab.url);
    await writeReadmeFile(directorySelection, readmeMetadata, pageTypeConfig, result.pageUrl || tab.url);
    await updateDirectoryInfo(pageType, targetScope);

    setStatus([
      "抓取并写入成功。",
      `页面类型：${pageTypeConfig.pageLabel}`,
      `目录访问：${describeDirectoryAccessMode(directorySelection)}`,
      `代码文件：${exportPlan.filesToWrite.map((item) => item.fileName).join("、")}`,
      hadReadme ? "README.MD 已更新。" : "README.MD 已新建。",
      "FromCode.md 已同步编码信息。",
    ]);
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
    const pageContext = await updatePageInfo();
    const { tab, pageType, pageTypeConfig, targetScope } = pageContext;
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      throw new Error(executableContextError);
    }

    const originError = getOriginError(tab.url);
    if (originError) {
      throw new Error(originError);
    }

    const directorySelection = await ensureDirectoryAccessForOperation(pageType, "read", targetScope);
    const importPlan = await readCodeFilesFromDirectory(directorySelection, pageTypeConfig);
    if (!importPlan.ok) {
      setStatus(`回写失败。
${importPlan.details || importPlan.errorCode || "未知错误"}`);
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
${result?.details || result?.errorCode || "未知错误"}`);
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
  } catch (error) {
    setStatus(`从文件夹回写失败。
${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

async function handleBizruleCaptureAndWrite() {
  setBusy(true);
  setStatus("正在抓取业务规则并写入...");

  try {
    const pageContext = await updatePageInfo();
    const { tab, pageType, targetScope } = pageContext;
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      throw new Error(executableContextError);
    }

    const originError = getOriginError(tab.url);
    if (originError) {
      throw new Error(originError);
    }

    const directorySelection = await ensureDirectoryAccessForOperation(pageType, "readwrite", targetScope);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: bizRuleProbeMain
    });

    if (!result?.ok) {
      setStatus([
        "业务规则抓取失败。",
        `错误码：${result?.errorCode || "UNKNOWN_ERROR"}`,
        result?.details || "未返回更多诊断信息"
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
    await writeFilesToSelection(directorySelection, [
      {
        fileName: result.fileName,
        content: result.sourceContent
      }
    ]);
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
      `诊断：${(result.details || []).join(" | ") || "无"}`
    ]);
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
    const pageContext = await updatePageInfo();
    const { tab, pageType, targetScope } = pageContext;
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      throw new Error(executableContextError);
    }

    const originError = getOriginError(tab.url);
    if (originError) {
      throw new Error(originError);
    }

    const directorySelection = await ensureDirectoryAccessForOperation(pageType, "read", targetScope);
    const [{ result: probeResult }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: bizRuleProbeMain
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
      setStatus(`业务规则回写失败。\n${importResult.details || importResult.errorCode || "未知错误"}`);
      return;
    }

    const [{ result: writebackResult }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: bizRuleWritebackMain,
      args: [
        {
          fileName: importResult.fileName,
          sourceContent: importResult.content
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
  } catch (error) {
    setStatus(`业务规则回写失败。\n${error?.message || String(error)}`);
  } finally {
    setBusy(false);
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

function bizRuleProbeMain() {
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

  try {
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
    let model = null;

    if (editors.length > 0 && typeof editors[0]?.getModel === "function") {
      model = editors[0].getModel();
      details.push("已通过 editor.getModel() 获取模型");
    }

    if (!model && models.length > 0) {
      model = models[0];
      details.push("已回退到monaco.editor.getModels()[0]");
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

  try {
    const fileName = String(input?.fileName || "").trim();
    const sourceContent = String(input?.sourceContent ?? "");
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

    if (!candidateModels.length) {
      return createBaseResult({
        errorCode: "NO_MONACO_MODEL",
        hasMonacoGlobal: true,
        editorCount: editors.length,
        modelCount: models.length,
        details: ["未找到可写入的 Monaco model"]
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

refreshHandleButton.addEventListener("click", handleRefreshDirectoryHandle);
frontendCaptureWriteButton.addEventListener("click", handleCaptureAndWrite);
frontendWritebackButton.addEventListener("click", handleImportAndWriteBack);
bizruleCaptureWriteButton.addEventListener("click", handleBizruleCaptureAndWrite);
bizruleWritebackButton.addEventListener("click", handleBizruleWriteback);
openVscodeButton.addEventListener("click", () => handleOpenEditor("vscode"));
openIdeaButton.addEventListener("click", () => handleOpenEditor("idea"));
openOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
pageOriginEl.addEventListener("click", handleCopyValue);
targetPathEl.addEventListener("click", handleCopyValue);

async function init() {
  const pageContext = await updatePageInfo();
  renderCurrentPageUrl(pageContext.tab);
  await updateDirectoryInfo(pageContext.pageType, pageContext.targetScope);
  setStatus("等待操作。");
}

init().catch((error) => {
  setStatus(`初始化失败。
${error?.message || String(error)}`);
});
