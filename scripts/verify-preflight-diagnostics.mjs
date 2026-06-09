import assert from "node:assert/strict";
import {
  PREFLIGHT_OPERATION_IDS,
  PREFLIGHT_SEVERITY,
  buildDiagnosticPackage,
  createPreflightResult,
  createWritebackRiskResult,
  formatPreflightStatusLines,
  hasBlockingPreflightResult,
  sanitizeDirectorySnapshot,
  sanitizePageProbe,
  summarizeDiagnosticPackage
} from "../lib/preflight-diagnostics.js";

const blocker = createPreflightResult({
  operationId: PREFLIGHT_OPERATION_IDS.cloudpivotFrontendCapture,
  checkId: "directory.write",
  severity: PREFLIGHT_SEVERITY.blocker,
  ok: false,
  errorCode: "DIRECTORY_WRITE_DENIED",
  evidence: "目录写入权限未授予。",
  nextAction: "重新选择目标目录。"
});

assert.equal(blocker.severity, "blocker");
assert.equal(blocker.ok, false);
assert.equal(hasBlockingPreflightResult([blocker]), true);
assert.match(formatPreflightStatusLines([blocker]).join("\n"), /operationId=cloudpivot\.frontend\.capture/);

const directorySnapshot = sanitizeDirectorySnapshot({
  accessMode: "Native Host",
  targetPath: "D:/work/order-form",
  files: [
    { fileName: "README.md", exists: true, size: 128, modifiedAt: "2026-06-08T00:00:00.000Z", content: "should not leak" },
    { fileName: "form-script.js", exists: false, size: 0 }
  ]
});

assert.equal(directorySnapshot.files.length, 2);
assert.equal(Object.hasOwn(directorySnapshot.files[0], "content"), false);

const pageProbe = sanitizePageProbe({
  url: "https://example.com/form-design",
  title: "表单设计",
  platformKey: "cloudpivot",
  pageType: "form",
  monacoModels: [
    {
      selector: "#jsText",
      codeKind: "frontend",
      mounted: true,
      modelCount: 2,
      languageIds: ["javascript"],
      sourceLength: 2048,
      sourceContent: "should not leak"
    }
  ]
});

assert.equal(pageProbe.monacoModels[0].sourceLength, 2048);
assert.equal(Object.hasOwn(pageProbe.monacoModels[0], "sourceContent"), false);

const diagnosticPackage = buildDiagnosticPackage({
  operationId: PREFLIGHT_OPERATION_IDS.h3yunFrontendWriteback,
  extension: { name: "开发助手", version: "1.3.5" },
  browser: { userAgent: "node-test" },
  logs: [{ time: "now", level: "error", lines: ["失败"], suggestion: "处理建议" }],
  pageProbe,
  directorySnapshot,
  preflightResults: [blocker],
  nativeHost: { available: true, hostName: "com.cloudpiovt.editor_helper" }
});

assert.equal(diagnosticPackage.schemaVersion, 1);
assert.equal(diagnosticPackage.preflightResults[0].errorCode, "DIRECTORY_WRITE_DENIED");
assert.equal(diagnosticPackage.directorySnapshot.targetPath, "D:/work/order-form");
assert.match(summarizeDiagnosticPackage(diagnosticPackage), /blockers=1/);

const writebackRisk = createWritebackRiskResult({
  operationId: PREFLIGHT_OPERATION_IDS.cloudpivotFrontendWriteback,
  fileName: "form-script.js",
  size: 512,
  modifiedAt: "2026-06-08T10:00:00.000Z"
});

assert.equal(writebackRisk.severity, "warning");
assert.equal(writebackRisk.ok, true);
assert.equal(writebackRisk.data.fileName, "form-script.js");

console.log("verify-preflight-diagnostics=ok");
