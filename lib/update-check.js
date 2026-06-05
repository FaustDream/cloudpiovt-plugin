import { gitSync } from "./native-host.js";
import { loadConfig, saveConfig } from "./config.js";
import { CURRENT_EXTENSION_VERSION } from "./release-notes.js";

export const UPDATE_CHECK_ALARM_NAME = "cloudpiovt-update-check";
export const UPDATE_CHECK_PERIOD_MINUTES = 24 * 60;

// 统一把 Native Host git_sync 返回的驼峰字段转成 update-check 内部结果格式
function normalizeGitResult(raw) {
  return {
    ok: raw?.ok === true,
    updateAvailable: raw?.updateAvailable === true,
    synced: raw?.synced === true,
    currentVersion: String(raw?.currentVersion || CURRENT_EXTENSION_VERSION),
    latestVersion: String(raw?.latestVersion || ""),
    error: String(raw?.error || ""),
    checkedAt: new Date().toISOString()
  };
}

// 检查更新（只读取 git 远程版本，不执行 pull）
export async function checkForUpdate() {
  const checkedAt = new Date().toISOString();
  let raw;
  try {
    raw = await gitSync({ sync: false });
  } catch (error) {
    raw = { ok: false, error: error?.message || String(error) };
  }

  const result = normalizeGitResult(raw);
  result.checkedAt = checkedAt;

  // 结果写入本地配置，供设置页恢复上次状态
  await saveConfig({ lastUpdateCheckResult: result });
  return result;
}

// 强制同步：从 git 远程拉取最新代码（git reset --hard origin/master）
export async function syncFromGit() {
  let raw;
  try {
    raw = await gitSync({ sync: true });
  } catch (error) {
    raw = { ok: false, error: error?.message || String(error) };
  }

  const result = normalizeGitResult(raw);

  await saveConfig({ lastUpdateCheckResult: result });
  return result;
}
