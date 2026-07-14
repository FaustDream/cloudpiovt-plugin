export const PREFLIGHT_SEVERITY = Object.freeze({
  blocker: "blocker",
  warning: "warning",
  info: "info"
});

export const PREFLIGHT_OPERATION_IDS = Object.freeze({
  cloudpivotFrontendCapture: "cloudpivot.frontend.capture",
  cloudpivotFrontendWriteback: "cloudpivot.frontend.writeback",
  cloudpivotBizruleCapture: "cloudpivot.bizrule.capture",
  cloudpivotBizruleWriteback: "cloudpivot.bizrule.writeback",
  h3yunCaptureAll: "h3yun.captureAll",
  h3yunFrontendWriteback: "h3yun.frontend.writeback",
  h3yunBackendWriteback: "h3yun.backend.writeback",
  nativeOpenCustomLauncher: "native.openCustomLauncher",
  directoryRefresh: "directory.refresh",
  updateSync: "update.sync"
});

export const LAST_DIAGNOSTIC_PACKAGE_KEY = "lastDiagnosticPackage";

const DEFAULT_DIRECTORY_FILE_LIMIT = 80;

function cleanInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanMultilineText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeSeverity(value) {
  return Object.values(PREFLIGHT_SEVERITY).includes(value)
    ? value
    : PREFLIGHT_SEVERITY.info;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function createPreflightResult(input = {}) {
  // 预检结果是诊断 JSON 的核心结构，字段名保持稳定，方便后续按 operationId/checkId 聚合失败原因。
  return {
    operationId: cleanInlineText(input.operationId),
    checkId: cleanInlineText(input.checkId),
    severity: normalizeSeverity(input.severity),
    ok: input.ok !== false,
    errorCode: cleanInlineText(input.errorCode),
    evidence: cleanMultilineText(input.evidence),
    nextAction: cleanMultilineText(input.nextAction),
    data: normalizeObject(input.data)
  };
}

export function hasBlockingPreflightResult(results = []) {
  return normalizeArray(results).some((result) => {
    const normalized = createPreflightResult(result);
    return normalized.severity === PREFLIGHT_SEVERITY.blocker && !normalized.ok;
  });
}

export function formatPreflightResultLine(result = {}) {
  const normalized = createPreflightResult(result);
  return [
    `operationId=${normalized.operationId || "unknown"}`,
    `checkId=${normalized.checkId || "unknown"}`,
    `severity=${normalized.severity}`,
    `ok=${normalized.ok}`,
    normalized.errorCode ? `errorCode=${normalized.errorCode}` : "",
    normalized.evidence ? `evidence=${normalized.evidence}` : "",
    normalized.nextAction ? `nextAction=${normalized.nextAction}` : ""
  ].filter(Boolean).join(" | ");
}

export function formatPreflightStatusLines(results = []) {
  const normalizedResults = normalizeArray(results).map(createPreflightResult);
  if (!normalizedResults.length) {
    return ["preflightResults=empty"];
  }

  return [
    "preflightResults:",
    ...normalizedResults.map(formatPreflightResultLine)
  ];
}

export function summarizeDiagnosticPackage(packageData = {}) {
  const normalizedPackage = buildDiagnosticPackage(packageData);
  const blockerCount = normalizedPackage.preflightResults.filter((item) => (
    item.severity === PREFLIGHT_SEVERITY.blocker && !item.ok
  )).length;
  const warningCount = normalizedPackage.preflightResults.filter((item) => (
    item.severity === PREFLIGHT_SEVERITY.warning
  )).length;

  // 设置页摘要只输出定位字段，不展开完整 JSON，便于用户快速复制给开发者判断问题类型。
  return [
    `createdAt=${normalizedPackage.createdAt || ""}`,
    `operationId=${normalizedPackage.operationId || "unknown"}`,
    `extensionVersion=${normalizedPackage.extension.version || "unknown"}`,
    `blockers=${blockerCount}`,
    `warnings=${warningCount}`,
    `targetPath=${normalizedPackage.directorySnapshot.targetPath || ""}`
  ].join("\n");
}

export function createWritebackRiskResult(input = {}) {
  const fileName = cleanInlineText(input.fileName);
  return createPreflightResult({
    operationId: input.operationId,
    checkId: input.checkId || "writeback.localFileRisk",
    severity: PREFLIGHT_SEVERITY.warning,
    ok: true,
    errorCode: "",
    evidence: [
      fileName ? `fileName=${fileName}` : "",
      Number.isFinite(Number(input.size)) ? `size=${Number(input.size)}` : "",
      input.modifiedAt ? `modifiedAt=${cleanInlineText(input.modifiedAt)}` : ""
    ].filter(Boolean).join(" | "),
    nextAction: "",
    data: {
      fileName,
      size: Number.isFinite(Number(input.size)) ? Number(input.size) : null,
      modifiedAt: cleanInlineText(input.modifiedAt)
    }
  });
}

export function sanitizeDirectorySnapshot(input = {}, options = {}) {
  const maxFiles = Number.isInteger(options.maxFiles)
    ? Math.max(0, options.maxFiles)
    : DEFAULT_DIRECTORY_FILE_LIMIT;
  const files = normalizeArray(input.files).slice(0, maxFiles).map((file) => ({
    fileName: cleanInlineText(file?.fileName),
    exists: file?.exists === true,
    size: Number.isFinite(Number(file?.size)) ? Number(file.size) : null,
    modifiedAt: cleanInlineText(file?.modifiedAt)
  }));

  // 目录快照只保存清单和绝对路径，不保存 README/DESIGN/源码正文，降低诊断包泄露业务代码的风险。
  return {
    accessMode: cleanInlineText(input.accessMode),
    targetPath: cleanInlineText(input.targetPath),
    fileLimit: maxFiles,
    truncated: normalizeArray(input.files).length > maxFiles,
    files
  };
}

export function sanitizePageProbe(input = {}) {
  const monacoModels = normalizeArray(input.monacoModels).map((model) => ({
    selector: cleanInlineText(model?.selector),
    codeKind: cleanInlineText(model?.codeKind),
    mounted: model?.mounted === true,
    modelCount: Number.isFinite(Number(model?.modelCount)) ? Number(model.modelCount) : null,
    editorCount: Number.isFinite(Number(model?.editorCount)) ? Number(model.editorCount) : null,
    selectedStrategy: cleanInlineText(model?.selectedStrategy),
    languageIds: normalizeArray(model?.languageIds).map(cleanInlineText).filter(Boolean),
    sourceLength: Number.isFinite(Number(model?.sourceLength)) ? Number(model.sourceLength) : null,
    errorCode: cleanInlineText(model?.errorCode),
    diagnostic: cleanInlineText(model?.diagnostic)
  }));

  // 页面探测只记录结构状态，不记录 Monaco 内容片段，避免诊断包携带源码。
  return {
    url: cleanInlineText(input.url),
    title: cleanInlineText(input.title),
    platformKey: cleanInlineText(input.platformKey),
    pageType: cleanInlineText(input.pageType),
    pageLabel: cleanInlineText(input.pageLabel),
    executableContextOk: input.executableContextOk !== false,
    monacoModels
  };
}

export function buildDiagnosticPackage(input = {}) {
  const createdAt = cleanInlineText(input.createdAt) || new Date().toISOString();
  return {
    schemaVersion: 1,
    createdAt,
    operationId: cleanInlineText(input.operationId),
    extension: {
      name: cleanInlineText(input.extension?.name),
      version: cleanInlineText(input.extension?.version)
    },
    browser: {
      userAgent: cleanInlineText(input.browser?.userAgent)
    },
    logs: normalizeArray(input.logs).map((log) => ({
      time: cleanInlineText(log?.time),
      level: cleanInlineText(log?.level),
      lines: normalizeArray(log?.lines).map(cleanMultilineText),
      suggestion: cleanMultilineText(log?.suggestion),
      context: normalizeObject(log?.context)
    })),
    pageProbe: sanitizePageProbe(input.pageProbe),
    directorySnapshot: sanitizeDirectorySnapshot(input.directorySnapshot),
    preflightResults: normalizeArray(input.preflightResults).map(createPreflightResult),
    nativeHost: normalizeObject(input.nativeHost),
    updateSync: normalizeObject(input.updateSync),
    // 氚云子表控件编码缺失时的 DOM 诊断快照（仅当存在缺失时注入，通常为 null）
    designerDomSnapshot: input.designerDomSnapshot || null
  };
}

export async function saveLastDiagnosticPackage(packageData) {
  if (!globalThis.chrome?.storage?.local) {
    return packageData;
  }

  await chrome.storage.local.set({
    [LAST_DIAGNOSTIC_PACKAGE_KEY]: buildDiagnosticPackage(packageData)
  });
  return packageData;
}

export async function loadLastDiagnosticPackage() {
  if (!globalThis.chrome?.storage?.local) {
    return null;
  }

  const stored = await chrome.storage.local.get({ [LAST_DIAGNOSTIC_PACKAGE_KEY]: null });
  const packageData = stored?.[LAST_DIAGNOSTIC_PACKAGE_KEY];
  return packageData ? buildDiagnosticPackage(packageData) : null;
}
