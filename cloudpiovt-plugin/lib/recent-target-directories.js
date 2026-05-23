const RECENT_TARGET_DIRECTORIES_KEY = "recentTargetDirectories";
export const MAX_RECENT_TARGET_DIRECTORIES = 5;

function normalizePath(value) {
  return String(value || "").trim();
}

function normalizePageType(pageType) {
  const normalized = String(pageType || "").trim();
  return normalized || "default";
}

function normalizeTimestamp(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
}

/**
 * 统一清洗最近路径记录，确保弹窗渲染与后续切换逻辑始终基于稳定结构。
 */
export function normalizeRecentTargetDirectories(value, limit = MAX_RECENT_TARGET_DIRECTORIES) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedLimit = Math.max(0, Number(limit) || MAX_RECENT_TARGET_DIRECTORIES);
  const sortedRecords = value
    .map((item) => {
      const path = normalizePath(item?.path);
      if (!path) {
        return null;
      }

      return {
        path,
        pageType: normalizePageType(item?.pageType),
        lastUsedAt: normalizeTimestamp(item?.lastUsedAt)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt);

  const dedupedRecords = [];
  const seenPaths = new Set();
  for (const record of sortedRecords) {
    if (seenPaths.has(record.path)) {
      continue;
    }

    seenPaths.add(record.path);
    dedupedRecords.push(record);
    if (dedupedRecords.length >= normalizedLimit) {
      break;
    }
  }

  return dedupedRecords;
}

/**
 * 合并一条新使用的目录记录：同路径去重、最近项前置、数量裁剪。
 */
export function mergeRecentTargetDirectories(records, nextRecord, limit = MAX_RECENT_TARGET_DIRECTORIES) {
  const normalizedPath = normalizePath(nextRecord?.path);
  if (!normalizedPath) {
    return normalizeRecentTargetDirectories(records, limit);
  }

  const mergedRecords = [
    {
      path: normalizedPath,
      pageType: normalizePageType(nextRecord?.pageType),
      lastUsedAt: normalizeTimestamp(nextRecord?.lastUsedAt) || Date.now()
    },
    ...normalizeRecentTargetDirectories(records, Number.MAX_SAFE_INTEGER)
  ];

  return normalizeRecentTargetDirectories(mergedRecords, limit);
}

async function loadRecentTargetDirectoryRecords() {
  const stored = await chrome.storage.local.get({ [RECENT_TARGET_DIRECTORIES_KEY]: [] });
  return normalizeRecentTargetDirectories(stored[RECENT_TARGET_DIRECTORIES_KEY]);
}

async function saveRecentTargetDirectoryRecords(records) {
  const normalizedRecords = normalizeRecentTargetDirectories(records);
  await chrome.storage.local.set({ [RECENT_TARGET_DIRECTORIES_KEY]: normalizedRecords });
  return normalizedRecords;
}

export async function getRecentTargetDirectories() {
  return loadRecentTargetDirectoryRecords();
}

export async function addRecentTargetDirectory(path, pageType) {
  const records = await loadRecentTargetDirectoryRecords();
  const nextRecords = mergeRecentTargetDirectories(records, {
    path,
    pageType,
    lastUsedAt: Date.now()
  });
  return saveRecentTargetDirectoryRecords(nextRecords);
}

export async function removeRecentTargetDirectory(path) {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) {
    return loadRecentTargetDirectoryRecords();
  }

  const records = await loadRecentTargetDirectoryRecords();
  const nextRecords = records.filter((item) => item.path !== normalizedPath);
  return saveRecentTargetDirectoryRecords(nextRecords);
}
