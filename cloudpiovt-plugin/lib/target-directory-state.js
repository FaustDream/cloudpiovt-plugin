import {
  getTargetDirectoryPathByPageType,
  loadConfig,
  saveTargetDirectoryPathByPageType
} from "./config.js";
import {
  clearTargetDirectoryHandle,
  clearTargetDirectoryHandleForScope,
  copyTargetDirectoryHandleToScope,
  getTargetDirectoryHandle,
  getTargetDirectoryHandleForScope,
  saveTargetDirectoryHandle,
  saveTargetDirectoryHandleForScope
} from "./file-handle-db.js";
import {
  getTargetDirectoryPathByScope,
  hasTargetDirectoryScopeSnapshot,
  markTargetDirectoryScopeSnapshot,
  saveTargetDirectoryPathByScope
} from "./target-directory-session.js";
export {
  clearTargetDirectoryPathsByScopePrefix,
  clearTargetDirectorySnapshotsByScopePrefix,
  createTargetDirectoryPageScope
} from "./target-directory-session.js";

function normalizePath(value) {
  return String(value || "").trim();
}

function buildSelection(kind, values = {}) {
  return {
    kind,
    handle: null,
    directoryPath: "",
    label: "",
    ...values
  };
}


/**
 * 打开编辑器和原生目录选择需要绝对路径；页面已有句柄快照时不能误回退到新默认路径。
 */
export async function getStoredDirectoryPath(pageType, pageScope) {
  const hasSnapshot = await hasTargetDirectoryScopeSnapshot(pageScope);
  const scopedPath = await getTargetDirectoryPathByScope(pageScope);
  if (scopedPath) {
    return scopedPath;
  }

  const scopedHandle = await getTargetDirectoryHandleForScope(pageScope).catch(() => null);
  if (scopedHandle || hasSnapshot) {
    return "";
  }

  const config = await loadConfig();
  return getTargetDirectoryPathByPageType(config, pageType);
}

/**
 * File System Access 句柄无法提供绝对路径，保存时需要同步清理对应路径状态。
 */
export async function saveHandleSelection(pageType, handle, pageScope) {
  await saveTargetDirectoryHandle(handle, pageType);
  await saveTargetDirectoryPathByPageType(pageType, "");

  if (pageScope) {
    await saveTargetDirectoryHandleForScope(handle, pageScope);
    await saveTargetDirectoryPathByScope(pageScope, "");
  }
}

/**
 * 保存 Native Host 返回的绝对路径，同时更新当前页面快照和后续新页面默认值。
 */
export async function saveNativeTargetDirectorySelection(pageType, directoryPath, pageScope = "") {
  const normalizedPath = normalizePath(directoryPath);
  if (!normalizedPath) {
    throw new Error("原生助手未返回目录路径。");
  }

  await saveTargetDirectoryPathByPageType(pageType, normalizedPath);
  await clearTargetDirectoryHandle(pageType);

  if (pageScope) {
    await saveTargetDirectoryPathByScope(pageScope, normalizedPath);
    await clearTargetDirectoryHandleForScope(pageScope);
  }

  return normalizedPath;
}

/**
 * 按“页面快照优先、全局默认兜底”的顺序读取目录选择，空快照不会继承新默认值。
 */
export async function getStoredTargetDirectorySelection(pageType, pageScope = "") {
  const hasSnapshot = await hasTargetDirectoryScopeSnapshot(pageScope);
  const scopedPath = await getTargetDirectoryPathByScope(pageScope);
  if (scopedPath) {
    return buildSelection("native-path", { directoryPath: scopedPath, label: scopedPath });
  }

  const scopedHandle = await getTargetDirectoryHandleForScope(pageScope).catch(() => null);
  if (scopedHandle) {
    return buildSelection("handle", {
      handle: scopedHandle,
      label: scopedHandle?.name || "未命名目录"
    });
  }

  if (hasSnapshot) {
    return buildSelection("none");
  }

  const config = await loadConfig();
  const directoryPath = getTargetDirectoryPathByPageType(config, pageType);
  if (directoryPath) {
    return buildSelection("native-path", { directoryPath, label: directoryPath });
  }

  const handle = await getTargetDirectoryHandle(pageType).catch(() => null);
  if (handle) {
    return buildSelection("handle", {
      handle,
      label: handle?.name || "未命名目录"
    });
  }

  return buildSelection("none");
}

/**
 * 在页面首次被扩展识别时建立目录快照，固定该页面后续使用的初始选择。
 */
export async function ensureTargetDirectorySnapshot(pageType, pageScope = "") {
  if (!pageScope) {
    return buildSelection("none");
  }

  const hasSnapshot = await hasTargetDirectoryScopeSnapshot(pageScope);
  const scopedPath = await getTargetDirectoryPathByScope(pageScope);
  if (scopedPath) {
    return buildSelection("native-path", { directoryPath: scopedPath, label: scopedPath });
  }

  const scopedHandle = await getTargetDirectoryHandleForScope(pageScope).catch(() => null);
  if (scopedHandle) {
    return buildSelection("handle", {
      handle: scopedHandle,
      label: scopedHandle?.name || "未命名目录"
    });
  }

  if (hasSnapshot) {
    return buildSelection("none");
  }

  const config = await loadConfig();
  const defaultPath = getTargetDirectoryPathByPageType(config, pageType);
  if (defaultPath) {
    await saveTargetDirectoryPathByScope(pageScope, defaultPath);
    await clearTargetDirectoryHandleForScope(pageScope);
    return buildSelection("native-path", { directoryPath: defaultPath, label: defaultPath });
  }

  const copiedHandle = await copyTargetDirectoryHandleToScope(pageType, pageScope);
  if (copiedHandle) {
    await markTargetDirectoryScopeSnapshot(pageScope);
    const handle = await getTargetDirectoryHandleForScope(pageScope).catch(() => null);
    return buildSelection("handle", { handle, label: handle?.name || "未命名目录" });
  }

  await markTargetDirectoryScopeSnapshot(pageScope);
  return buildSelection("none");
}
