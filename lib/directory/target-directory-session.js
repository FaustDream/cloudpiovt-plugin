import { normalizePath, normalizePageType } from "../utils.js";

const TARGET_DIRECTORY_PAGE_PATHS_KEY = "targetDirectoryPagePaths";
const TARGET_DIRECTORY_PAGE_SNAPSHOTS_KEY = "targetDirectoryPageSnapshots";

function normalizeScopeKey(scopeKey) {
  return String(scopeKey || "").trim();
}

function hashScopePart(value) {
  const text = String(value || "");
  let hash = 2166136261;

  // 页面 URL 可能很长，页面级目录快照只需要稳定短 key，避免把完整 URL 直接写入 storage 对象键。
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return hash.toString(36);
}

function getSessionStorageArea() {
  // 页面级快照只服务当前浏览器会话；旧版 Chrome 若没有 session 区域，则降级到 local。
  return chrome.storage.session || chrome.storage.local;
}

function normalizeScopedTargetDirectoryPaths(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((result, [scopeKey, directoryPath]) => {
    const normalizedScopeKey = normalizeScopeKey(scopeKey);
    const normalizedPath = normalizePath(directoryPath);
    if (normalizedScopeKey && normalizedPath) {
      result[normalizedScopeKey] = normalizedPath;
    }
    return result;
  }, {});
}

async function loadTargetDirectoryPagePaths() {
  const storageArea = getSessionStorageArea();
  const stored = await storageArea.get({ [TARGET_DIRECTORY_PAGE_PATHS_KEY]: {} });
  return normalizeScopedTargetDirectoryPaths(stored[TARGET_DIRECTORY_PAGE_PATHS_KEY]);
}

async function loadTargetDirectoryPageSnapshots() {
  const storageArea = getSessionStorageArea();
  const stored = await storageArea.get({ [TARGET_DIRECTORY_PAGE_SNAPSHOTS_KEY]: {} });
  const snapshots = stored[TARGET_DIRECTORY_PAGE_SNAPSHOTS_KEY];
  if (!snapshots || typeof snapshots !== "object" || Array.isArray(snapshots)) {
    return {};
  }

  return Object.entries(snapshots).reduce((result, [scopeKey, exists]) => {
    const normalizedScopeKey = normalizeScopeKey(scopeKey);
    if (normalizedScopeKey && exists) {
      result[normalizedScopeKey] = true;
    }
    return result;
  }, {});
}

/**
 * 为浏览器标签页中的具体页面生成目录快照 scope，用于区分“已打开页面”和“未来新页面”。
 */
export function createTargetDirectoryPageScope(tab, pageType) {
  const tabId = typeof tab === "object" ? tab?.id : tab;
  const pageUrl = typeof tab === "object" ? (tab?.url || tab?.pendingUrl || "") : "";
  const normalizedTabId = String(tabId ?? "").trim();

  if (!normalizedTabId) {
    return "";
  }

  return `tab:${normalizedTabId}:${normalizePageType(pageType)}:${hashScopePart(pageUrl)}`;
}

/**
 * 读取页面级绝对路径快照；没有快照路径时返回空字符串，让调用方决定是否回退默认值。
 */
export async function getTargetDirectoryPathByScope(pageScope) {
  const normalizedScopeKey = normalizeScopeKey(pageScope);
  if (!normalizedScopeKey) {
    return "";
  }

  const pagePaths = await loadTargetDirectoryPagePaths();
  return normalizePath(pagePaths[normalizedScopeKey]);
}

/**
 * 判断页面 scope 是否已经建立快照，包含“当时没有选择目录”的空快照。
 */
export async function hasTargetDirectoryScopeSnapshot(pageScope) {
  const normalizedScopeKey = normalizeScopeKey(pageScope);
  if (!normalizedScopeKey) {
    return false;
  }

  const snapshots = await loadTargetDirectoryPageSnapshots();
  return Boolean(snapshots[normalizedScopeKey]);
}

/**
 * 标记页面 scope 已经完成快照，避免旧页面在默认目录更新后被动继承新默认值。
 */
export async function markTargetDirectoryScopeSnapshot(pageScope) {
  const normalizedScopeKey = normalizeScopeKey(pageScope);
  if (!normalizedScopeKey) {
    return;
  }

  const snapshots = await loadTargetDirectoryPageSnapshots();
  snapshots[normalizedScopeKey] = true;
  await getSessionStorageArea().set({ [TARGET_DIRECTORY_PAGE_SNAPSHOTS_KEY]: snapshots });
}

/**
 * 保存页面级绝对路径；空路径表示当前页面改用句柄或保持空选择，但仍会保留快照标记。
 */
export async function saveTargetDirectoryPathByScope(pageScope, targetDirectoryPath) {
  const normalizedScopeKey = normalizeScopeKey(pageScope);
  if (!normalizedScopeKey) {
    return "";
  }

  const pagePaths = await loadTargetDirectoryPagePaths();
  const normalizedPath = normalizePath(targetDirectoryPath);

  if (normalizedPath) {
    pagePaths[normalizedScopeKey] = normalizedPath;
  } else {
    delete pagePaths[normalizedScopeKey];
  }

  await getSessionStorageArea().set({ [TARGET_DIRECTORY_PAGE_PATHS_KEY]: pagePaths });
  await markTargetDirectoryScopeSnapshot(normalizedScopeKey);
  return normalizedPath;
}

/**
 * 标签页关闭后清理同一 tab 前缀下的路径快照，避免会话级 storage 持续增长。
 */
export async function clearTargetDirectoryPathsByScopePrefix(scopePrefix) {
  const normalizedPrefix = normalizeScopeKey(scopePrefix);
  if (!normalizedPrefix) {
    return;
  }

  const pagePaths = await loadTargetDirectoryPagePaths();
  const nextPagePaths = Object.entries(pagePaths).reduce((result, [scopeKey, directoryPath]) => {
    if (!scopeKey.startsWith(normalizedPrefix)) {
      result[scopeKey] = directoryPath;
    }
    return result;
  }, {});

  await getSessionStorageArea().set({ [TARGET_DIRECTORY_PAGE_PATHS_KEY]: nextPagePaths });
}

/**
 * 标签页关闭后清理同一 tab 前缀下的快照存在标记。
 */
export async function clearTargetDirectorySnapshotsByScopePrefix(scopePrefix) {
  const normalizedPrefix = normalizeScopeKey(scopePrefix);
  if (!normalizedPrefix) {
    return;
  }

  const snapshots = await loadTargetDirectoryPageSnapshots();
  const nextSnapshots = Object.entries(snapshots).reduce((result, [scopeKey, exists]) => {
    if (!scopeKey.startsWith(normalizedPrefix)) {
      result[scopeKey] = exists;
    }
    return result;
  }, {});

  await getSessionStorageArea().set({ [TARGET_DIRECTORY_PAGE_SNAPSHOTS_KEY]: nextSnapshots });
}
