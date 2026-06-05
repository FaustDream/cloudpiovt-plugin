import { DEFAULT_CONFIG, loadConfig, saveConfig } from "./config.js";
import { CURRENT_EXTENSION_VERSION } from "./release-notes.js";

export const UPDATE_CHECK_ALARM_NAME = "cloudpiovt-update-check";
export const UPDATE_CHECK_PERIOD_MINUTES = 24 * 60;

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 8);
  }
  const normalized = String(value || "").trim();
  return normalized ? [normalized] : [];
}

export function compareVersions(leftVersion, rightVersion) {
  const leftParts = normalizeVersion(leftVersion).split(/[.-]/).slice(0, 3);
  const rightParts = normalizeVersion(rightVersion).split(/[.-]/).slice(0, 3);

  for (let index = 0; index < 3; index += 1) {
    const leftNumber = Number.parseInt(leftParts[index] || "0", 10);
    const rightNumber = Number.parseInt(rightParts[index] || "0", 10);
    if (leftNumber !== rightNumber) {
      return leftNumber > rightNumber ? 1 : -1;
    }
  }
  return 0;
}

function normalizeUpdateManifest(manifest, manifestUrl) {
  const latestVersion = normalizeVersion(manifest?.version);
  const downloadUrl = String(manifest?.downloadUrl || manifest?.sourceZipUrl || manifest?.zipUrl || "").trim();
  if (!latestVersion) {
    throw new Error("update.json 缺少 version 字段。");
  }
  if (!downloadUrl) {
    throw new Error("update.json 缺少 downloadUrl 字段。");
  }

  // 远程更新配置只保留下载和展示必要字段，后续做一键安装时可继续复用 sha256 做包校验。
  return {
    latestVersion,
    title: String(manifest?.title || "").trim(),
    downloadUrl,
    projectUrl: String(manifest?.projectUrl || manifest?.repositoryUrl || "").trim(),
    releaseDate: String(manifest?.releaseDate || "").trim(),
    sha256: String(manifest?.sha256 || "").trim(),
    notes: normalizeTextList(manifest?.notes || manifest?.changelog),
    manifestUrl
  };
}

function getCurrentExtensionVersion() {
  return normalizeVersion(globalThis.chrome?.runtime?.getManifest?.()?.version || CURRENT_EXTENSION_VERSION);
}

export async function checkForUpdate(options = {}) {
  const config = await loadConfig();
  const manifestUrl = String(options.manifestUrl || config.updateManifestUrl || DEFAULT_CONFIG.updateManifestUrl);
  const currentVersion = getCurrentExtensionVersion();
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`更新配置请求失败：HTTP ${response.status}`);
    }

    const remoteManifest = normalizeUpdateManifest(await response.json(), manifestUrl);
    const result = {
      ok: true,
      updateAvailable: compareVersions(remoteManifest.latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion: remoteManifest.latestVersion,
      title: remoteManifest.title,
      downloadUrl: remoteManifest.downloadUrl,
      projectUrl: remoteManifest.projectUrl,
      manifestUrl,
      checkedAt,
      error: "",
      notes: remoteManifest.notes
    };
    if (options.persist !== false) {
      await saveConfig({ lastUpdateCheckResult: result });
    }
    return result;
  } catch (error) {
    const result = {
      ok: false,
      updateAvailable: false,
      currentVersion,
      latestVersion: "",
      title: "",
      downloadUrl: "",
      projectUrl: "",
      manifestUrl,
      checkedAt,
      error: error?.message || String(error),
      notes: []
    };
    if (options.persist !== false) {
      await saveConfig({ lastUpdateCheckResult: result });
    }
    return result;
  }
}
