import { normalizePath, normalizePageType } from "../utils.js";

const RECENT_TARGET_DIRECTORIES_KEY = "recentTargetDirectories";

function normalizeTimestamp(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
}

/**
 * 统一清洗最近路径记录，确保弹窗渲染与后续切换逻辑始终基于稳定结构。
 * 不设数量上限，仅去重并按时间降序排列。
 */
export function normalizeRecentTargetDirectories(value) {
  if (!Array.isArray(value)) {
    return [];
  }

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

  // 按 path 去重，保留时间戳最新的
  const dedupedRecords = [];
  const seenPaths = new Set();
  for (const record of sortedRecords) {
    if (seenPaths.has(record.path)) {
      continue;
    }
    seenPaths.add(record.path);
    dedupedRecords.push(record);
  }

  return dedupedRecords;
}

/**
 * 合并一条新使用的目录记录：同路径去重、最近项前置。
 */
export function mergeRecentTargetDirectories(records, nextRecord) {
  const normalizedPath = normalizePath(nextRecord?.path);
  if (!normalizedPath) {
    return normalizeRecentTargetDirectories(records);
  }

  const mergedRecords = [
    {
      path: normalizedPath,
      pageType: normalizePageType(nextRecord?.pageType),
      lastUsedAt: normalizeTimestamp(nextRecord?.lastUsedAt) || Date.now()
    },
    ...normalizeRecentTargetDirectories(records)
  ];

  return normalizeRecentTargetDirectories(mergedRecords);
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

/**
 * 一键清空所有历史目录记录。
 * @returns {Promise<Array>} 空数组
 */
export async function clearAllRecentTargetDirectories() {
  await saveRecentTargetDirectoryRecords([]);
  return [];
}
