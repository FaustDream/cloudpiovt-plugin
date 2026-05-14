import {
  getTargetDirectoryHandle,
  saveTargetDirectoryHandle
} from "./lib/file-handle-db.js";
import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_SELECTION_STRATEGY,
  isOriginAllowed,
  resolvePageTypeConfig
} from "./lib/config.js";
import { buildReadmeContent, extractReadmeMetadataFromHtml } from "./lib/readme-parser.js";

const pageOriginEl = document.querySelector("#page-origin");
const targetHandleEl = document.querySelector("#target-handle");
const refreshHandleButton = document.querySelector("#refresh-handle-btn");
const statusOutput = document.querySelector("#status-output");
const frontendCaptureWriteButton = document.querySelector("#frontend-capture-write-btn");
const frontendWritebackButton = document.querySelector("#frontend-writeback-btn");
const bizruleCaptureWriteButton = document.querySelector("#bizrule-capture-write-btn");
const bizruleWritebackButton = document.querySelector("#bizrule-writeback-btn");
const openOptionsButton = document.querySelector("#open-options-btn");

let currentPageContext = null;

function setBusy(isBusy) {
  frontendCaptureWriteButton.disabled = isBusy;
  frontendWritebackButton.disabled = isBusy;
  bizruleCaptureWriteButton.disabled = isBusy;
  bizruleWritebackButton.disabled = isBusy;
  refreshHandleButton.disabled = isBusy;
}

function setStatus(message) {
  statusOutput.textContent = Array.isArray(message) ? message.join("\n") : String(message || "");
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
    return "涓嶅彲璇嗗埆椤甸潰";
  }
}

function renderCurrentPageUrl(tab) {
  pageOriginEl.textContent = tab?.url || "鏃犳硶鑾峰彇";
}

async function updatePageInfo() {
  const tab = await getActiveTab();
  renderCurrentPageUrl(tab);
  const pageTypeConfig = resolvePageTypeConfig(tab?.url || "");
  currentPageContext = {
    tab,
    pageType: pageTypeConfig.pageType,
    pageTypeConfig
  };
  return currentPageContext;
}

function getCurrentPageContext() {
  return currentPageContext || {
    tab: null,
    pageType: "default",
    pageTypeConfig: resolvePageTypeConfig("")
  };
}

async function updateDirectoryInfo(pageType) {
  try {
    const handle = await getTargetDirectoryHandle(pageType);
    targetHandleEl.textContent = handle?.name || "灏氭湭閫夋嫨";
  } catch (error) {
    targetHandleEl.textContent = "璇诲彇澶辫触";
    setStatus(`璇诲彇鐩綍鍙ユ焺澶辫触銆俓n${error?.message || String(error)}`);
  }
}

function supportsDirectoryPicker() {
  return typeof window.showDirectoryPicker === "function";
}

async function selectTargetDirectoryHandle(pageType) {
  if (!supportsDirectoryPicker()) {
    throw new Error("褰撳墠鎵╁睍椤典笉鏀寔 File System Access API銆?);
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await saveTargetDirectoryHandle(handle, pageType);
  return handle;
}

async function ensureDirectoryPermission(handle, mode = "readwrite") {
  if (!handle) {
    throw new Error("灏氭湭閫夋嫨鐩綍鍙ユ焺銆?);
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

  throw new Error(mode === "read" ? "鐩綍璇诲彇鏉冮檺鏈巿浜堛€? : "鐩綍鍐欏叆鏉冮檺鏈巿浜堛€?);
}

async function ensureDirectoryHandleForOperation(pageType, mode) {
  let handle = await getTargetDirectoryHandle(pageType);
  if (!handle) {
    handle = await selectTargetDirectoryHandle(pageType);
  }
  await ensureDirectoryPermission(handle, mode);
  return handle;
}

async function refreshDirectoryHandle(pageType) {
  const handle = await selectTargetDirectoryHandle(pageType);
  await updateDirectoryInfo(pageType);
  return handle;
}

async function handleRefreshDirectoryHandle() {
  setBusy(true);
  setStatus("姝ｅ湪鏇存柊鐩綍鍙ユ焺...");

  try {
    const { pageType } = getCurrentPageContext();
    const handle = await refreshDirectoryHandle(pageType);
    setStatus(`鐩綍鍙ユ焺宸叉洿鏂帮細${handle?.name || "鏈懡鍚嶇洰褰?}`);
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("宸插彇娑堟洿鏂扮洰褰曞彞鏌勩€?);
      return;
    }
    setStatus(`鏇存柊鐩綍鍙ユ焺澶辫触銆俓n${error?.message || String(error)}`);
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
    return "鏈壘鍒板綋鍓嶆椿鍔ㄦ爣绛鹃〉銆?;
  }
  if (!/^https?:/i.test(tab.url)) {
    return "褰撳墠鏍囩椤典笉鏄櫘閫氱綉椤碉紝鏃犳硶娉ㄥ叆鑴氭湰銆?;
  }
  return "";
}

function getOriginError(tabUrl) {
  if (!isOriginAllowed(tabUrl, DEFAULT_ALLOWED_ORIGINS)) {
    return `褰撳墠椤甸潰 origin 涓嶅湪鍏佽鍒楄〃涓細${describeOrigin(tabUrl)}`;
  }
  return "";
}

function buildCodeExportPlan(data, pageTypeConfig) {
  const codes = data?.codes;
  if (!codes || typeof codes !== "object" || Array.isArray(codes)) {
    return {
      ok: false,
      errorCode: "NO_CODES_OBJECT",
      details: "鐩爣缁勪欢鐨?$data 涓湭鎵惧埌鏈夋晥鐨?data.codes 瀵硅薄銆?
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
      details: "data.codes 涓病鏈夊彲瀵煎嚭鐨?javascript銆乭tml銆乧ss 鏂囨湰鍐呭銆?,
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
        details: `璇诲彇 ${fileName} 澶辫触锛?{error?.message || String(error)}`
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
        details: `璇诲彇 ${fileName} 鍐呭澶辫触锛?{error?.message || String(error)}`
      };
    }
  }

  if (!filesToImport.length) {
    return {
      ok: false,
      errorCode: "NO_IMPORTABLE_CODE_FILES",
      details: `${pageTypeConfig.pageLabel} 瀵瑰簲鐨勯粯璁ゆ枃浠朵笉瀛樺湪銆俙,
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

async function handleCaptureAndWrite() {
  setBusy(true);
  setStatus("姝ｅ湪鎶撳彇骞跺啓鍏?..");

  try {
    const pageContext = await updatePageInfo();
    const { tab, pageType, pageTypeConfig } = pageContext;
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
      setStatus(`鎶撳彇澶辫触銆俓n${result?.details || result?.errorCode || "鏈煡閿欒"}`);
      return;
    }

    const exportPlan = buildCodeExportPlan(result.data, pageTypeConfig);
    if (!exportPlan.ok) {
      setStatus(`鍐欏叆澶辫触銆俓n${exportPlan.details || exportPlan.errorCode || "鏈煡閿欒"}`);
      return;
    }

    await writeCodeFilesToDirectory(handle, exportPlan.filesToWrite);
    const exportedHtml = exportPlan.filesToWrite.find((item) => item.key === "html")?.content || "";
    const readmeMetadata = extractReadmeMetadataFromHtml(exportedHtml, result.pageUrl || tab.url);
    await writeReadmeFile(handle, readmeMetadata, pageTypeConfig, result.pageUrl || tab.url);
    await updateDirectoryInfo(pageType);

    setStatus([
      "鎶撳彇骞跺啓鍏ユ垚鍔熴€?,
      `椤甸潰绫诲瀷锛?{pageTypeConfig.pageLabel}`,
      `浠ｇ爜鏂囦欢锛?{exportPlan.filesToWrite.map((item) => item.fileName).join("銆?)}`,
      hadReadme ? "README.MD 宸叉洿鏂般€? : "README.MD 宸叉柊寤恒€?
    ]);
  } catch (error) {
    setStatus(`鎶撳彇骞跺啓鍏ュけ璐ャ€俓n${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

async function handleImportAndWriteBack() {
  setBusy(true);
  setStatus("姝ｅ湪浠庢枃浠跺す鍥炲啓...");

  try {
    const pageContext = await updatePageInfo();
    const { tab, pageType, pageTypeConfig } = pageContext;
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
      setStatus(`鍥炲啓澶辫触銆俓n${importPlan.details || importPlan.errorCode || "鏈煡閿欒"}`);
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
      setStatus(`鍥炲啓澶辫触銆俓n${result?.details || result?.errorCode || "鏈煡閿欒"}`);
      return;
    }

    await updateDirectoryInfo(pageType);
    setStatus([
      "从文件夹回写成功。",
      `页面类型：${pageTypeConfig.pageLabel}`,
      `回写字段：${result.updatedKeys.join("、") || "无"}`,
      result.compatibilityState?.shimmed
        ? `兼容处理：webIDEService.updateDataSource -> ${result.compatibilityState.fallbackMethod}`
        : "兼容处理：未注入 webIDEService 兜底"
    ]);
  } catch (error) {
    setStatus(`浠庢枃浠跺す鍥炲啓澶辫触銆俓n${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

async function handleBizruleCaptureAndWrite() {
  setBusy(true);
  setStatus("姝ｅ湪鎶撳彇涓氬姟瑙勫垯骞跺啓鍏?..");

  try {
    const pageContext = await updatePageInfo();
    const { tab, pageType } = pageContext;
    const executableContextError = getExecutableContextError(tab);
    if (executableContextError) {
      throw new Error(executableContextError);
    }

    const originError = getOriginError(tab.url);
    if (originError) {
      throw new Error(originError);
    }

    const handle = await ensureDirectoryHandleForOperation(pageType, "readwrite");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: bizRuleProbeMain
    });

    if (!result?.ok) {
      setStatus([
        "涓氬姟瑙勫垯鎶撳彇澶辫触銆?,
        `閿欒鐮侊細${result?.errorCode || "UNKNOWN_ERROR"}`,
        result?.details || "鏈繑鍥炴洿澶氳瘖鏂俊鎭€?
      ]);
      return;
    }

    if (!result.sourceContent) {
      setStatus("涓氬姟瑙勫垯鎶撳彇澶辫触銆俓n椤甸潰宸叉壘鍒?Monaco model锛屼絾婧愮爜鍐呭涓虹┖銆?);
      return;
    }

    if (!result.fileName) {
      setStatus("涓氬姟瑙勫垯鎶撳彇澶辫触銆俓n宸茶鍙栨簮鐮侊紝浣嗘湭鑳借В鏋愯緭鍑烘枃浠跺悕銆?);
      return;
    }

    const hadTargetFile = await fileExists(handle, result.fileName);
    const fileHandle = await handle.getFileHandle(result.fileName, { create: true });
    await writeTextToFile(fileHandle, result.sourceContent);
    await updateDirectoryInfo(pageType);

    setStatus([
      "涓氬姟瑙勫垯鎶撳彇鍐欏叆鎴愬姛銆?,
      `鏂囦欢鍚嶏細${result.fileName}`,
      `绫诲悕锛?{result.className || "鏈В鏋?}`,
      `璇█锛?{result.language || "鏈煡"}`,
      `URI锛?{result.uri || "绌?}`,
      `婧愮爜闀垮害锛?{result.sourceLength}`,
      hadTargetFile ? "鐩爣鏂囦欢宸叉洿鏂般€? : "鐩爣鏂囦欢宸叉柊寤恒€?,
      `璇婃柇锛?{(result.details || []).join(" | ") || "鏃?}`
    ]);
  } catch (error) {
    setStatus(`涓氬姟瑙勫垯鎶撳彇鍐欏叆澶辫触銆俓n${error?.message || String(error)}`);
  } finally {
    setBusy(false);
  }
}

function handleBizruleWriteback() {
  setStatus("涓氬姟瑙勫垯鍥炲啓鍔熻兘鏆傛湭瀹炵幇銆?);
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
      .replace(/[>锛瀅/g, "/")
      .replace(/[|锝淽/g, "/")
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
      details: "椤甸潰涓婃湭鍙戠幇鍙闂殑 Vue 缁勪欢鍏ュ彛銆?
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
      details: `鏈尮閰嶅埌鍊欓€夌粍浠跺悕锛?{candidateNames.join(", ")}`
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
      details: "鐩爣缁勪欢瀛樺湪锛屼絾鏈毚闇插叕寮€鐨?$data銆?
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
      details: "椤甸潰涓婃湭鍙戠幇鍙闂殑 Vue 缁勪欢鍏ュ彛銆?
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
      details: `鏈尮閰嶅埌鍊欓€夌粍浠跺悕锛?{candidateNames.join(", ")}`
    });
  }

  if (!codeEntries.length) {
    return createBaseResult({
      errorCode: "NO_IMPORTABLE_CODE_FILES",
      vueMajor,
      candidateCount: candidateEntries.length,
      matchedComponentName: candidateEntries[0].componentName,
      discoveredComponentNames: Array.from(discoveredComponentNames).sort(),
      details: "娌℃湁鍙洖鍐欑殑浠ｇ爜鏂囦欢鍐呭銆?
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
          ? "鐩爣缁勪欢瀛樺湪锛屼絾鏈毚闇插叕寮€鐨?$data銆?
          : "鐩爣缁勪欢鐨?$data.codes 鏃犳硶寤虹珛涓哄彲鍐欏璞°€?
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
        details: ["window.monaco.editor 涓嶅瓨鍦?]
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
      details.push("宸查€氳繃 editor.getModel() 鑾峰彇妯″瀷");
    }

    if (!model && models.length > 0) {
      model = models[0];
      details.push("宸插洖閫€鍒?monaco.editor.getModels()[0]");
    }

    if (!model) {
      return createBaseResult({
        errorCode: "NO_MONACO_MODEL",
        hasMonacoGlobal: true,
        editorCount: editors.length,
        modelCount: models.length,
        details: details.concat("鏈壘鍒板彲鐢ㄧ殑 Monaco model")
      });
    }

    if (typeof model.getValue !== "function") {
      return createBaseResult({
        errorCode: "MODEL_NOT_READABLE",
        hasMonacoGlobal: true,
        editorCount: editors.length,
        modelCount: models.length,
        details: details.concat("Monaco model 涓嶆敮鎸?getValue()")
      });
    }

    const source = String(model.getValue() || "");
    const sampleText = source.slice(0, 300);
    const language = typeof model.getLanguageId === "function" ? model.getLanguageId() : "";
    const uri = model.uri?.toString?.() || "";
    const className = extractJavaClassName(source);
    const uriFileName = extractFileNameFromUri(uri);
    const fileName = uriFileName || (className ? `${className}.java` : "");
    details.push(source ? "宸茶鍙栧埌婧愮爜鏂囨湰" : "婧愮爜鏂囨湰涓虹┖");
    if (uriFileName) {
      details.push("宸蹭粠 model URI 瑙ｆ瀽鏂囦欢鍚?);
    } else if (className) {
      details.push("宸蹭粠婧愮爜绫诲悕鍥為€€瑙ｆ瀽鏂囦欢鍚?);
    } else {
      details.push("鏈В鏋愬埌涓氬姟瑙勫垯鏂囦欢鍚?);
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

refreshHandleButton.addEventListener("click", handleRefreshDirectoryHandle);
frontendCaptureWriteButton.addEventListener("click", handleCaptureAndWrite);
frontendWritebackButton.addEventListener("click", handleImportAndWriteBack);
bizruleCaptureWriteButton.addEventListener("click", handleBizruleCaptureAndWrite);
bizruleWritebackButton.addEventListener("click", handleBizruleWriteback);
openOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

async function init() {
  const pageContext = await updatePageInfo();
  renderCurrentPageUrl(pageContext.tab);
  await updateDirectoryInfo(pageContext.pageType);
  setStatus("等待操作。");
}

init().catch((error) => {
  setStatus(`鍒濆鍖栧け璐ャ€俓n${error?.message || String(error)}`);
});

