import {
  getTargetDirectoryHandle,
  saveTargetDirectoryHandle
} from "./lib/file-handle-db.js";
import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_SELECTION_STRATEGY,
  EDITOR_OPTIONS,
  getEditorProfileById,
  getTargetDirectoryPathByPageType,
  isOriginAllowed,
  loadConfig,
  resolvePageTypeConfig,
  saveTargetDirectoryPathByPageType
} from "./lib/config.js";
import {
  launchNativeEditor,
  pickNativeDirectory,
  probeNativeHost
} from "./lib/native-host.js";
import { buildReadmeContent, extractReadmeMetadataFromHtml } from "./lib/readme-parser.js";

const pageOriginEl = document.querySelector("#page-origin");
const targetHandleEl = document.querySelector("#target-handle");
const refreshHandleButton = document.querySelector("#refresh-handle-btn");
const targetDirectoryPathField = document.querySelector("#target-directory-path");
const statusOutput = document.querySelector("#status-output");
const captureWriteButton = document.querySelector("#capture-write-btn");
const importWriteButton = document.querySelector("#import-write-btn");
const openVscodeButton = document.querySelector("#open-vscode-btn");
const openIdeaButton = document.querySelector("#open-idea-btn");
const openOptionsButton = document.querySelector("#open-options-btn");
let currentPageContext = null;

function setBusy(isBusy) {
  captureWriteButton.disabled = isBusy;
  importWriteButton.disabled = isBusy;
  openVscodeButton.disabled = isBusy;
  openIdeaButton.disabled = isBusy;
  refreshHandleButton.disabled = isBusy;
}

function setStatus(lines) {
  statusOutput.textContent = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
}

function cleanInlineText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePath(value) {
  return String(value || "").trim();
}

function getPathLeafName(path) {
  const normalized = normalizePath(path).replace(/[\\/]+$/, "");
  if (!normalized) {
    return "";
  }
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] || "";
}

function isLikelyAbsolutePath(path) {
  return /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\/.test(path) || /^\//.test(path);
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

async function updatePageInfo() {
  const tab = await getActiveTab();
  pageOriginEl.textContent = tab?.url || "无法获取";
  const pageTypeConfig = resolvePageTypeConfig(tab?.url || "");
  currentPageContext = {
    tab,
    pageType: pageTypeConfig.pageType,
    pageTypeConfig
  };
  return currentPageContext;
}

async function updateDirectoryInfo(pageType, config = null) {
  const nextConfig = config || (await loadConfig());
  targetDirectoryPathField.textContent = getTargetDirectoryPathByPageType(nextConfig, pageType) || "未设置";
  try {
    const handle = await getTargetDirectoryHandle(pageType);
    targetHandleEl.textContent = handle?.name || "尚未选择";
  } catch (error) {
    targetHandleEl.textContent = "读取失败";
    setStatus(`读取目录句柄失败。\n${error?.message || String(error)}`);
  }
}

function supportsDirectoryPicker() {
  return typeof window.showDirectoryPicker === "function";
}

async function selectTargetDirectoryHandle(pageType) {
  if (!supportsDirectoryPicker()) {
    throw new Error("当前扩展页不支持 File System Access API。");
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await saveTargetDirectoryHandle(handle, pageType);
  return handle;
}

async function ensureDirectoryPermission(handle, mode = "readwrite") {
  if (!handle) {
    throw new Error("尚未选择目标文件夹。");
  }

  const options = { mode };
  if (typeof handle.queryPermission === "function") {
    const permission = await handle.queryPermission(options);
    if (permission === "granted") {
      return;
    }
  }

  if (typeof handle.requestPermission === "function") {
    const permission = await handle.requestPermission(options);
    if (permission === "granted") {
      return;
    }
  }

  throw new Error(mode === "read" ? "目标文件夹读取权限未授予。" : "目标文件夹写入权限未授予。");
}

async function ensureDirectoryHandleForOperation(pageType, mode) {
  let handle = await getTargetDirectoryHandle(pageType);
  if (!handle) {
    handle = await selectTargetDirectoryHandle(pageType);
  }
  await ensureDirectoryPermission(handle, mode);
  return handle;
}

async function persistTargetDirectoryPath(pageType) {
  const config = await loadConfig();
  targetDirectoryPathField.textContent = getTargetDirectoryPathByPageType(config, pageType) || "未设置";
  return config;
}

async function refreshDirectoryHandle(pageType) {
  const handle = await selectTargetDirectoryHandle(pageType);
  await updateDirectoryInfo(pageType);
  return handle;
}

async function updateDirectoryPathByPrompt(pageType) {
  const config = await loadConfig();
  const pickedDirectory = await pickNativeDirectory(
    getTargetDirectoryPathByPageType(config, pageType)
  );

  if (!pickedDirectory?.ok) {
    return {
      ok: false,
      cancelled: Boolean(pickedDirectory?.cancelled),
      error: pickedDirectory?.error || "未知错误",
      directoryPath: ""
    };
  }

  const nextConfig = await saveTargetDirectoryPathByPageType(
    pageType,
    pickedDirectory.directoryPath || ""
  );
  await updateDirectoryInfo(pageType, nextConfig);
  return {
    ok: true,
    cancelled: false,
    error: "",
    directoryPath: pickedDirectory.directoryPath || ""
  };
}

async function handleRefreshDirectoryHandle() {
  setBusy(true);
  setStatus("正在更新目录句柄...");

  try {
    const { pageType } = getCurrentPageContext();
    const handle = await refreshDirectoryHandle(pageType);
    const hostStatus = await probeNativeHost();

    if (!hostStatus.available) {
      setStatus(`目录句柄已更新：${handle?.name || "未命名目录"}\n原生助手未连接，目标文件夹路径未更新。`);
      return;
    }

    setStatus(`目录句柄已更新：${handle?.name || "未命名目录"}\n请在接下来的系统目录选择器中选择同一个文件夹，以更新目标文件夹路径。`);
    const pathResult = await updateDirectoryPathByPrompt(pageType);
    if (!pathResult.ok) {
      if (pathResult.cancelled) {
        setStatus("目录句柄已更新，但目标文件夹路径更新已取消。");
        return;
      }

      setStatus(`目录句柄已更新，但目标文件夹路径更新失败。\n${pathResult.error}`);
      return;
    }

    const pathLeafName = getPathLeafName(pathResult.directoryPath);
    const mismatchHint = !pathLeafName || pathLeafName === handle?.name
      ? ""
      : `\n注意：目录句柄名称为 ${handle?.name || "未知目录"}，路径末级目录名为 ${pathLeafName}，请确认两次选择的是同一目录。`;
    setStatus(`目录句柄和目标文件夹路径已更新：${pathResult.directoryPath}${mismatchHint}`);
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("已取消更新目录句柄。");
      return;
    }
    setStatus(`更新目录句柄失败。\n${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

function getCurrentPageContext() {
  return currentPageContext || {
    tab: null,
    pageType: "default",
    pageTypeConfig: resolvePageTypeConfig("")
  };
}

function renderCurrentPageUrl(tab) {
  pageOriginEl.textContent = tab?.url || "无法获取";
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
      details: "目标组件的 $data 中未找到有效的 data.codes 对象。"
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

async function writeCodeFilesToDirectory(directoryHandle, filesToWrite) {
  for (const file of filesToWrite) {
    const fileHandle = await directoryHandle.getFileHandle(file.fileName, { create: true });
    await writeTextToFile(fileHandle, file.content);
  }
}

async function readCodeFilesFromDirectory(directoryHandle, pageTypeConfig) {
  const filesToImport = [];
  const skippedKeys = [];

  for (const { key, fileName } of pageTypeConfig.fileMappings) {
    let fileHandle;
    try {
      fileHandle = await directoryHandle.getFileHandle(fileName);
    } catch (error) {
      if (error?.name === "NotFoundError") {
        skippedKeys.push(key);
        continue;
      }
      return {
        ok: false,
        errorCode: "DIRECTORY_READ_FAILED",
        details: `读取 ${fileName} 失败：${error?.message || String(error)}`
      };
    }

    try {
      filesToImport.push({
        key,
        fileName,
        content: normalizeExcessBlankLines(await readTextFromFile(fileHandle))
      });
    } catch (error) {
      return {
        ok: false,
        errorCode: "DIRECTORY_READ_FAILED",
        details: `读取 ${fileName} 内容失败：${error?.message || String(error)}`
      };
    }
  }

  if (!filesToImport.length) {
    return {
      ok: false,
      errorCode: "NO_IMPORTABLE_CODE_FILES",
      details: `${pageTypeConfig.pageLabel} 对应的默认文件不存在。`,
      skippedKeys
    };
  }

  return {
    ok: true,
    filesToImport,
    skippedKeys
  };
}

async function fileExists(directoryHandle, fileName) {
  try {
    await directoryHandle.getFileHandle(fileName);
    return true;
  } catch (error) {
    if (error?.name === "NotFoundError") {
      return false;
    }
    throw error;
  }
}

async function writeReadmeFile(directoryHandle, metadata, pageTypeConfig, pageUrl) {
  const readmeContent = buildReadmeContent(metadata, pageTypeConfig, pageUrl);
  const readmeHandle = await directoryHandle.getFileHandle("README.MD", { create: true });
  await writeTextToFile(readmeHandle, readmeContent);
}

function formatLaunchResult(result) {
  const editorName = result.editorName || "编辑器";
  return result.ok ? `${editorName} 打开成功` : `${editorName} 打开失败`;
}

/* async function handleSelectDirectory() {
  setBusy(true);
  setStatus("正在选择目标文件夹...");

  try {
    const { pageType } = getCurrentPageContext();
    const hostStatus = await probeNativeHost();
    if (!hostStatus.available) {
      setStatus("鍘熺敓鍔╂墜鏈繛鎺ワ紝鏃犳硶鍥炲啓鏈湴缁濆璺緞銆?);
      return;
    }
    let savedConfig = await loadConfig();
    const pickedDirectory = await pickNativeDirectory(
      getTargetDirectoryPathByPageType(savedConfig, pageType)
    );
    if (pickedDirectory?.ok) {
      savedConfig = await saveTargetDirectoryPathByPageType(
        pageType,
        pickedDirectory.directoryPath || ""
      );
    } else if (!pickedDirectory?.cancelled) {
        setStatus(`目录句柄已保存，但路径回写失败：${pickedDirectory?.error || "未知错误"}`);
        await updateDirectoryInfo(pageType, savedConfig);
        return;
      }
    }

    await updateDirectoryInfo(pageType, savedConfig);
    setStatus(
      hostStatus.available
        ? `已选择目标文件夹：${handle.name}\n路径已回写。`
        : `已选择目标文件夹：${handle.name}\n原生助手未连接，请手动填写路径。`
    );
  } catch (error) {
    setStatus(`选择目标文件夹失败。\n${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

*/

function buildEditorLaunchTarget(profile, targetDirectoryPath) {
  const normalizedPath = normalizePath(targetDirectoryPath);
  const normalizedExecutablePath = normalizePath(profile?.executablePath);
  const editorName = profile?.name || "编辑器";

  if (!normalizedPath) {
    return {
      ok: false,
      editorName,
      errorCode: "MISSING_TARGET_PATH",
      details: "请先填写目标文件夹路径。"
    };
  }

  if (!isLikelyAbsolutePath(normalizedPath)) {
    return {
      ok: false,
      editorName,
      errorCode: "INVALID_TARGET_PATH",
      details: "目标文件夹路径必须是本地绝对路径。"
    };
  }

  if (!normalizedExecutablePath) {
    return {
      ok: false,
      editorName,
      errorCode: "MISSING_EXECUTABLE_PATH",
      details: `请先在设置页填写 ${editorName} 的应用路径。`
    };
  }

  return {
    ok: true,
    editorName,
    executablePath: normalizedExecutablePath,
    targetPath: normalizedPath,
    argumentsTemplate: '"{path}"'
  };
}

async function launchEditorById(editorId) {
  setBusy(true);
  setStatus("正在打开编辑器...");

  try {
    const { pageType } = getCurrentPageContext();
    const config = await persistTargetDirectoryPath(pageType);
    const profile = getEditorProfileById(config, editorId);
    if (!profile) {
      setStatus("未找到对应的打开方式。");
      return;
    }

    const launchTarget = buildEditorLaunchTarget(
      profile,
      getTargetDirectoryPathByPageType(config, pageType)
    );
    if (!launchTarget.ok) {
      setStatus(`${formatLaunchResult(launchTarget)}\n${launchTarget.details || ""}`);
      return;
    }

    const launchState = await launchNativeEditor(launchTarget);
    if (!launchState?.ok) {
      setStatus(
        `${formatLaunchResult({ ok: false, editorName: profile.name })}\n${
          launchState?.error || "未知错误"
        }`
      );
      return;
    }

    setStatus(formatLaunchResult({ ok: true, editorName: profile.name }));
  } catch (error) {
    setStatus(`打开编辑器失败。\n${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

async function handleCaptureAndWrite() {
  setBusy(true);
  setStatus("正在抓取并写入...");

  try {
    const pageContext = await updatePageInfo();
    const { tab, pageType, pageTypeConfig } = pageContext;
    renderCurrentPageUrl(tab);
    await persistTargetDirectoryPath(pageType);
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      throw new Error(executableContextError);
    }

    const originError = getOriginError(tab.url);
    if (originError) {
      throw new Error(originError);
    }

    const handle = await ensureDirectoryHandleForOperation(pageType, "readwrite");
    const hadReadme = await fileExists(handle, "README.MD");

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
      setStatus(`抓取失败。\n${result?.details || result?.errorCode || "未知错误"}`);
      return;
    }

    const exportPlan = buildCodeExportPlan(result.data, pageTypeConfig);
    if (!exportPlan.ok) {
      setStatus(`写入失败。\n${exportPlan.details || exportPlan.errorCode || "未知错误"}`);
      return;
    }

    await writeCodeFilesToDirectory(handle, exportPlan.filesToWrite);
    const exportedHtml = exportPlan.filesToWrite.find((item) => item.key === "html")?.content || "";
    const readmeMetadata = extractReadmeMetadataFromHtml(exportedHtml, result.pageUrl || tab.url);
    await writeReadmeFile(handle, readmeMetadata, pageTypeConfig, result.pageUrl || tab.url);
    await updateDirectoryInfo(pageType);

    setStatus(
      [
        "抓取并写入成功。",
        `页面类型：${pageTypeConfig.pageLabel}`,
        `代码文件：${exportPlan.filesToWrite.map((item) => item.fileName).join("、")}`,
        hadReadme ? "README.MD 已更新。" : "README.MD 已新建。"
      ].join("\n")
    );
  } catch (error) {
    setStatus(`抓取并写入失败。\n${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

async function handleImportAndWriteBack() {
  setBusy(true);
  setStatus("正在从文件夹回写...");

  try {
    const pageContext = await updatePageInfo();
    const { tab, pageType, pageTypeConfig } = pageContext;
    renderCurrentPageUrl(tab);
    await persistTargetDirectoryPath(pageType);
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      throw new Error(executableContextError);
    }

    const originError = getOriginError(tab.url);
    if (originError) {
      throw new Error(originError);
    }

    const handle = await ensureDirectoryHandleForOperation(pageType, "read");
    const importPlan = await readCodeFilesFromDirectory(handle, pageTypeConfig);
    if (!importPlan.ok) {
      setStatus(`回写失败。\n${importPlan.details || importPlan.errorCode || "未知错误"}`);
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
      setStatus(`回写失败。\n${result?.details || result?.errorCode || "未知错误"}`);
      return;
    }

    await updateDirectoryInfo(pageType);
    setStatus(
      [
        "从文件夹回写成功。",
        `页面类型：${pageTypeConfig.pageLabel}`,
        `回写字段：${result.updatedKeys.join("、") || "无"}`
      ].join("\n")
    );
  } catch (error) {
    setStatus(`从文件夹回写失败。\n${error?.message || String(error)}`);
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
      .replace(/[>＞]/g, "/")
      .replace(/[|｜]/g, "/")
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

    return /subtable|sub-table|detail|child|sheet|明细|子表/.test(source);
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
      return /subtable|detail|child|sheet|明细|子表/.test(marker);
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

refreshHandleButton.addEventListener("click", handleRefreshDirectoryHandle);
captureWriteButton.addEventListener("click", handleCaptureAndWrite);
importWriteButton.addEventListener("click", handleImportAndWriteBack);
openVscodeButton.addEventListener("click", () => launchEditorById("vscode"));
openIdeaButton.addEventListener("click", () => launchEditorById("idea"));
openOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

async function init() {
  const pageContext = await updatePageInfo();
  renderCurrentPageUrl(pageContext.tab);
  await updateDirectoryInfo(pageContext.pageType);
  const availableEditors = EDITOR_OPTIONS.map((item) => item.name).join(" / ");
  setStatus(`等待操作。\n可用打开方式：${availableEditors}`);
}

init().catch((error) => {
  setStatus(`初始化失败。\n${error?.message || String(error)}`);
});
