import { resolvePageTypeConfig } from "./lib/config.js";
import { clearTargetDirectoryHandlesByScopePrefix } from "./lib/file-handle-db.js";
import {
  clearTargetDirectoryPathsByScopePrefix,
  clearTargetDirectorySnapshotsByScopePrefix,
  createTargetDirectoryPageScope,
  ensureTargetDirectorySnapshot
} from "./lib/target-directory-state.js";

// tab.url 可能在新建页早期为空，统一从 url/pendingUrl 中取可用页面地址。
function getTabPageUrl(tab) {
  return String(tab?.url || tab?.pendingUrl || "").trim();
}

// 标签页创建或跳转时建立目录快照，确保旧页面不会被后续默认目录变化影响。
async function snapshotTabTargetDirectory(tabId, tab) {
  const pageUrl = getTabPageUrl(tab);
  const pageTypeConfig = resolvePageTypeConfig(pageUrl);
  const pageScope = createTargetDirectoryPageScope(
    {
      id: tab?.id ?? tabId,
      url: pageUrl
    },
    pageTypeConfig.pageType
  );

  // 新页面创建快照时复制当前默认目录；后续默认目录变化不会覆盖已存在的页面快照。
  await ensureTargetDirectorySnapshot(pageTypeConfig.pageType, pageScope);
}

// Chrome 事件监听器不能直接暴露 rejected promise，这里统一吞吐错误到控制台。
function snapshotTabTargetDirectorySafely(tabId, tab) {
  snapshotTabTargetDirectory(tabId, tab).catch((error) => {
    console.warn("Snapshot target directory failed.", error);
  });
}

// 扩展安装、重载或浏览器启动时，先给已经打开的标签页建立基线快照。
async function snapshotExistingTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => snapshotTabTargetDirectory(tab.id, tab)));
}

function snapshotExistingTabsSafely() {
  snapshotExistingTabs().catch((error) => {
    console.warn("Snapshot existing tabs failed.", error);
  });
}

snapshotExistingTabsSafely();

chrome.runtime.onInstalled.addListener(snapshotExistingTabsSafely);
chrome.runtime.onStartup.addListener(snapshotExistingTabsSafely);

chrome.tabs.onCreated.addListener((tab) => {
  snapshotTabTargetDirectorySafely(tab.id, tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !getTabPageUrl(tab)) {
    return;
  }

  snapshotTabTargetDirectorySafely(tabId, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const scopePrefix = `tab:${tabId}:`;
  Promise.all([
    clearTargetDirectoryPathsByScopePrefix(scopePrefix),
    clearTargetDirectorySnapshotsByScopePrefix(scopePrefix),
    clearTargetDirectoryHandlesByScopePrefix(scopePrefix)
  ]).catch((error) => {
    console.warn("Clear target directory snapshot failed.", error);
  });
});
