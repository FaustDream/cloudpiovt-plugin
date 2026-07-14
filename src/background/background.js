import { loadConfig, resolvePageTypeConfig } from "../../lib/config.js";
import { clearTargetDirectoryHandlesByScopePrefix } from "../../lib/directory/file-handle-db.js";
import {
  clearTargetDirectoryPathsByScopePrefix,
  clearTargetDirectorySnapshotsByScopePrefix,
  createTargetDirectoryPageScope,
  ensureTargetDirectorySnapshot
} from "../../lib/directory/target-directory-state.js";
import {
  checkForUpdate,
  UPDATE_CHECK_ALARM_NAME,
  UPDATE_CHECK_PERIOD_MINUTES
} from "../../lib/services/update-check.js";

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

async function refreshUpdateAlarm() {
  const config = await loadConfig();
  if (!config.autoCheckUpdates) {
    await chrome.alarms.clear(UPDATE_CHECK_ALARM_NAME);
    return;
  }

  // 自动更新只负责检查和记录结果；源码包安装仍由用户手动下载/重新加载，避免后台静默改扩展文件。
  await chrome.alarms.create(UPDATE_CHECK_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: UPDATE_CHECK_PERIOD_MINUTES
  });
}

function refreshUpdateAlarmSafely() {
  refreshUpdateAlarm().catch((error) => {
    console.warn("Refresh update alarm failed.", error);
  });
}

function checkForUpdateSafely() {
  checkForUpdate().catch((error) => {
    console.warn("Check extension update failed.", error);
  });
}

snapshotExistingTabsSafely();
refreshUpdateAlarmSafely();

chrome.runtime.onInstalled.addListener(snapshotExistingTabsSafely);
chrome.runtime.onInstalled.addListener(refreshUpdateAlarmSafely);
chrome.runtime.onStartup.addListener(snapshotExistingTabsSafely);
chrome.runtime.onStartup.addListener(refreshUpdateAlarmSafely);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_CHECK_ALARM_NAME) {
    checkForUpdateSafely();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.autoCheckUpdates) {
    refreshUpdateAlarmSafely();
  }
});

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
