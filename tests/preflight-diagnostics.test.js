// 预检诊断模块单元测试
// 覆盖所有导出函数：createPreflightResult, hasBlockingPreflightResult,
// formatPreflightResultLine, formatPreflightStatusLines, summarizeDiagnosticPackage,
// createWritebackRiskResult, sanitizeDirectorySnapshot, sanitizePageProbe,
// buildDiagnosticPackage, saveLastDiagnosticPackage, loadLastDiagnosticPackage

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  PREFLIGHT_SEVERITY,
  PREFLIGHT_OPERATION_IDS,
  createPreflightResult,
  hasBlockingPreflightResult,
  formatPreflightResultLine,
  formatPreflightStatusLines,
  summarizeDiagnosticPackage,
  createWritebackRiskResult,
  sanitizeDirectorySnapshot,
  sanitizePageProbe,
  buildDiagnosticPackage,
  saveLastDiagnosticPackage,
  loadLastDiagnosticPackage,
  LAST_DIAGNOSTIC_PACKAGE_KEY
} from "../lib/preflight-diagnostics.js";

// =============================================================================
// PREFLIGHT_SEVERITY / PREFLIGHT_OPERATION_IDS - 常量验证
// =============================================================================

describe("PREFLIGHT_SEVERITY", () => {
  it("应包含 blocker、warning、info 三个级别", () => {
    expect(PREFLIGHT_SEVERITY).toEqual({
      blocker: "blocker",
      warning: "warning",
      info: "info"
    });
  });

  it("应为冻结对象", () => {
    expect(Object.isFrozen(PREFLIGHT_SEVERITY)).toBe(true);
  });
});

describe("PREFLIGHT_OPERATION_IDS", () => {
  it("应包含所有已知操作 ID", () => {
    expect(PREFLIGHT_OPERATION_IDS).toHaveProperty("h3yunCaptureAll");
    expect(PREFLIGHT_OPERATION_IDS).toHaveProperty("cloudpivotFrontendCapture");
    expect(PREFLIGHT_OPERATION_IDS).toHaveProperty("cloudpivotFrontendWriteback");
    expect(PREFLIGHT_OPERATION_IDS).toHaveProperty("cloudpivotBizruleCapture");
    expect(PREFLIGHT_OPERATION_IDS).toHaveProperty("cloudpivotBizruleWriteback");
    expect(PREFLIGHT_OPERATION_IDS).toHaveProperty("h3yunFrontendWriteback");
    expect(PREFLIGHT_OPERATION_IDS).toHaveProperty("h3yunBackendWriteback");
    expect(PREFLIGHT_OPERATION_IDS).toHaveProperty("nativeOpenCustomLauncher");
    expect(PREFLIGHT_OPERATION_IDS).toHaveProperty("directoryRefresh");
    expect(PREFLIGHT_OPERATION_IDS).toHaveProperty("updateSync");
  });
});

// =============================================================================
// createPreflightResult - 创建预检结果
// =============================================================================

describe("createPreflightResult", () => {
  it("应使用默认值创建完整结果对象", () => {
    const result = createPreflightResult();
    expect(result).toEqual({
      operationId: "",
      checkId: "",
      severity: "info",
      ok: true,
      errorCode: "",
      evidence: "",
      nextAction: "",
      data: {}
    });
  });

  it("应从输入参数正确填充所有字段", () => {
    const result = createPreflightResult({
      operationId: "h3yun.captureAll",
      checkId: "page.context",
      severity: "blocker",
      ok: false,
      errorCode: "PAGE_ERROR",
      evidence: "page not found",
      nextAction: "请刷新页面后重试",
      data: { detail: "extra info" }
    });
    expect(result).toEqual({
      operationId: "h3yun.captureAll",
      checkId: "page.context",
      severity: "blocker",
      ok: false,
      errorCode: "PAGE_ERROR",
      evidence: "page not found",
      nextAction: "请刷新页面后重试",
      data: { detail: "extra info" }
    });
  });

  it("应将未知 severity 标准化为 info", () => {
    const result = createPreflightResult({ severity: "critical" });
    expect(result.severity).toBe("info");
  });

  it("应清理文本中的多余空格", () => {
    const result = createPreflightResult({
      operationId: "  test.op  ",
      evidence: "  line1  \n  line2  "
    });
    expect(result.operationId).toBe("test.op");
    // cleanMultilineText 只做整体 trim 和 \r\n→\n，内部空格保留
    expect(result.evidence).toBe("line1  \n  line2");
  });

  it("ok 默认为 true 仅当 input.ok === false 时才为 false", () => {
    expect(createPreflightResult({ ok: false }).ok).toBe(false);
    expect(createPreflightResult({ ok: true }).ok).toBe(true);
    expect(createPreflightResult({}).ok).toBe(true);
    // ok: undefined 默认为 true（因 input.ok !== false）
    expect(createPreflightResult({ ok: undefined }).ok).toBe(true);
  });

  it("非对象 data 应标准化为空对象", () => {
    expect(createPreflightResult({ data: "string" }).data).toEqual({});
    expect(createPreflightResult({ data: [1, 2] }).data).toEqual({});
    expect(createPreflightResult({ data: null }).data).toEqual({});
  });
});

// =============================================================================
// hasBlockingPreflightResult - 检查是否有阻断级结果
// =============================================================================

describe("hasBlockingPreflightResult", () => {
  it("空数组应返回 false", () => {
    expect(hasBlockingPreflightResult([])).toBe(false);
  });

  it("undefined 应返回 false", () => {
    expect(hasBlockingPreflightResult(undefined)).toBe(false);
  });

  it("非数组输入应返回 false", () => {
    expect(hasBlockingPreflightResult({})).toBe(false);
  });

  it("仅有 info 级别的结果应返回 false", () => {
    const results = [
      createPreflightResult({ severity: "info", ok: true }),
      createPreflightResult({ severity: "warning", ok: false })
    ];
    expect(hasBlockingPreflightResult(results)).toBe(false);
  });

  it("有 blocker 且 ok=false 应返回 true", () => {
    const results = [
      createPreflightResult({ severity: "info", ok: true }),
      createPreflightResult({ severity: "blocker", ok: false })
    ];
    expect(hasBlockingPreflightResult(results)).toBe(true);
  });

  it("blocker 但 ok=true 应返回 false", () => {
    const results = [
      createPreflightResult({ severity: "blocker", ok: true })
    ];
    expect(hasBlockingPreflightResult(results)).toBe(false);
  });

  it("混合结果中任意一个 blocker+ok=false 即返回 true", () => {
    const results = [
      createPreflightResult({ severity: "info", ok: true }),
      createPreflightResult({ severity: "warning", ok: false }),
      createPreflightResult({ severity: "blocker", ok: false }),
      createPreflightResult({ severity: "info", ok: true })
    ];
    expect(hasBlockingPreflightResult(results)).toBe(true);
  });
});

// =============================================================================
// formatPreflightResultLine - 格式化单条预检结果
// =============================================================================

describe("formatPreflightResultLine", () => {
  it("应格式化完整结果", () => {
    const line = formatPreflightResultLine({
      operationId: "h3yun.captureAll",
      checkId: "page.context",
      severity: "info",
      ok: true,
      evidence: "page context resolved"
    });
    expect(line).toBe(
      "operationId=h3yun.captureAll | checkId=page.context | severity=info | ok=true | evidence=page context resolved"
    );
  });

  it("缺失字段应使用默认值", () => {
    const line = formatPreflightResultLine({});
    expect(line).toContain("operationId=unknown");
    expect(line).toContain("checkId=unknown");
    expect(line).toContain("severity=info");
    expect(line).toContain("ok=true");
  });

  it("应省略空的 errorCode 和 nextAction", () => {
    const line = formatPreflightResultLine({ operationId: "test" });
    expect(line).not.toContain("errorCode");
    expect(line).not.toContain("nextAction");
  });

  it("有 errorCode 时应包含", () => {
    const line = formatPreflightResultLine({
      operationId: "test",
      errorCode: "ERR_001"
    });
    expect(line).toContain("errorCode=ERR_001");
  });

  it("有 nextAction 时应包含", () => {
    const line = formatPreflightResultLine({
      operationId: "test",
      nextAction: "请重试"
    });
    expect(line).toContain("nextAction=请重试");
  });
});

// =============================================================================
// formatPreflightStatusLines - 格式化多条预检结果
// =============================================================================

describe("formatPreflightStatusLines", () => {
  it("空数组应返回 preflightResults=empty", () => {
    expect(formatPreflightStatusLines([])).toEqual(["preflightResults=empty"]);
  });

  it("undefined 应返回 preflightResults=empty", () => {
    expect(formatPreflightStatusLines(undefined)).toEqual(["preflightResults=empty"]);
  });

  it("单条结果应包含标题行和结果行", () => {
    const lines = formatPreflightStatusLines([
      { operationId: "test", checkId: "chk" }
    ]);
    expect(lines[0]).toBe("preflightResults:");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("operationId=test");
    expect(lines[1]).toContain("checkId=chk");
  });

  it("多条结果应正确格式化", () => {
    const lines = formatPreflightStatusLines([
      { operationId: "op1", checkId: "chk1" },
      { operationId: "op2", checkId: "chk2" }
    ]);
    expect(lines[0]).toBe("preflightResults:");
    expect(lines.length).toBe(3);
  });
});

// =============================================================================
// summarizeDiagnosticPackage - 诊断包摘要
// =============================================================================

describe("summarizeDiagnosticPackage", () => {
  it("应输出关键诊断字段", () => {
    const summary = summarizeDiagnosticPackage({
      createdAt: "2026-01-01T00:00:00.000Z",
      operationId: "h3yun.captureAll",
      extension: { name: "开发助手", version: "1.4.0" },
      directorySnapshot: { targetPath: "/test/path" },
      preflightResults: []
    });
    expect(summary).toContain("operationId=h3yun.captureAll");
    expect(summary).toContain("extensionVersion=1.4.0");
    expect(summary).toContain("blockers=0");
    expect(summary).toContain("warnings=0");
    expect(summary).toContain("targetPath=/test/path");
  });

  it("应正确统计 blocker 和 warning 数量", () => {
    const summary = summarizeDiagnosticPackage({
      preflightResults: [
        { severity: "blocker", ok: false },
        { severity: "blocker", ok: false },
        { severity: "warning", ok: false },
        { severity: "warning", ok: true },
        { severity: "info", ok: true },
        { severity: "blocker", ok: true }  // blocker 但 ok=true 不算
      ]
    });
    expect(summary).toContain("blockers=2");
    expect(summary).toContain("warnings=2");
  });

  it("空包应使用默认值", () => {
    const summary = summarizeDiagnosticPackage({});
    expect(summary).toContain("operationId=unknown");
    expect(summary).toContain("extensionVersion=unknown");
    expect(summary).toContain("blockers=0");
    expect(summary).toContain("warnings=0");
  });

  it("createdAt 为空时应回退为空字符串（覆盖 || '' 分支）", () => {
    const summary = summarizeDiagnosticPackage({
      createdAt: "",
      operationId: "test"
    });
    expect(summary).toContain("createdAt=");
    // extension.version 为空时也回退
    expect(summary).toContain("extensionVersion=unknown");
  });
});

// =============================================================================
// createWritebackRiskResult - 创建回写风险结果
// =============================================================================

describe("createWritebackRiskResult", () => {
  it("应创建 writeback.localFileRisk 检查结果", () => {
    const result = createWritebackRiskResult({
      operationId: "h3yun.frontend.writeback",
      fileName: "test.js",
      size: 1024,
      modifiedAt: "2026-01-01T00:00:00.000Z"
    });
    expect(result.checkId).toBe("writeback.localFileRisk");
    expect(result.severity).toBe("warning");
    expect(result.ok).toBe(true);
    expect(result.evidence).toContain("fileName=test.js");
    expect(result.evidence).toContain("size=1024");
    expect(result.data.fileName).toBe("test.js");
    expect(result.data.size).toBe(1024);
  });

  it("可自定义 checkId", () => {
    const result = createWritebackRiskResult({
      operationId: "test",
      checkId: "custom.check"
    });
    expect(result.checkId).toBe("custom.check");
  });

  it("size 非数字时应为 null", () => {
    const result = createWritebackRiskResult({
      operationId: "test",
      fileName: "test.js",
      size: "abc"
    });
    expect(result.data.size).toBeNull();
  });

  it("size 为 NaN 时应为 null", () => {
    const result = createWritebackRiskResult({
      operationId: "test",
      fileName: "test.js",
      size: NaN
    });
    expect(result.data.size).toBeNull();
  });

  it("省略 fileName 时应省略 evidence 中的 fileName", () => {
    const result = createWritebackRiskResult({ operationId: "test" });
    expect(result.evidence).not.toContain("fileName");
    expect(result.data.fileName).toBe("");
  });
});

// =============================================================================
// sanitizeDirectorySnapshot - 清理目录快照
// =============================================================================

describe("sanitizeDirectorySnapshot", () => {
  it("应清理并截断文件列表", () => {
    const files = Array.from({ length: 100 }, (_, i) => ({
      fileName: `file${i}.js`,
      exists: true,
      size: 100,
      modifiedAt: "2026-01-01"
    }));
    const snapshot = sanitizeDirectorySnapshot({
      accessMode: "Native Host",
      targetPath: "/test",
      files
    });
    expect(snapshot.fileLimit).toBe(80);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.files.length).toBe(80);
  });

  it("未截断时应正确标记", () => {
    const snapshot = sanitizeDirectorySnapshot({
      accessMode: "manual",
      targetPath: "/test",
      files: [{ fileName: "test.js", exists: true, size: 100 }]
    });
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.files.length).toBe(1);
  });

  it("空输入应返回默认值", () => {
    const snapshot = sanitizeDirectorySnapshot({});
    expect(snapshot.accessMode).toBe("");
    expect(snapshot.targetPath).toBe("");
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.files).toEqual([]);
  });

  it("可自定义 maxFiles", () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      fileName: `f${i}`,
      exists: true,
      size: 1
    }));
    const snapshot = sanitizeDirectorySnapshot({ files }, { maxFiles: 5 });
    expect(snapshot.files.length).toBe(5);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.fileLimit).toBe(5);
  });

  it("size 为 Infinity 或 NaN 时应回退为 null", () => {
    const snapshot = sanitizeDirectorySnapshot({
      accessMode: "test",
      targetPath: "/test",
      files: [
        { fileName: "a.js", exists: true, size: Infinity },
        { fileName: "b.js", exists: true, size: NaN },
        { fileName: "c.js", exists: true, size: undefined }
      ]
    });
    expect(snapshot.files[0].size).toBeNull();
    expect(snapshot.files[1].size).toBeNull();
    expect(snapshot.files[2].size).toBeNull();
  });
});

// =============================================================================
// sanitizePageProbe - 清理页面探测数据
// =============================================================================

describe("sanitizePageProbe", () => {
  it("应清理 Monaco model 数据", () => {
    const probe = sanitizePageProbe({
      url: "https://example.com",
      title: "测试页面",
      platformKey: "h3yun",
      pageType: "h3yun-form",
      pageLabel: "氚云表单设计",
      executableContextOk: true,
      monacoModels: []
    });
    expect(probe.url).toBe("https://example.com");
    expect(probe.title).toBe("测试页面");
    expect(probe.platformKey).toBe("h3yun");
    expect(probe.pageType).toBe("h3yun-form");
    expect(probe.monacoModels).toEqual([]);
  });

  it("应正确映射 Monaco model 字段", () => {
    const probe = sanitizePageProbe({
      url: "https://example.com",
      monacoModels: [{
        selector: ".editor",
        codeKind: "frontend",
        mounted: true,
        modelCount: 3,
        editorCount: 1,
        selectedStrategy: "container-model",
        languageIds: ["javascript", "typescript"],
        sourceLength: 5000,
        errorCode: "",
        diagnostic: ""
      }]
    });
    expect(probe.monacoModels).toHaveLength(1);
    const model = probe.monacoModels[0];
    expect(model.selector).toBe(".editor");
    expect(model.codeKind).toBe("frontend");
    expect(model.mounted).toBe(true);
    expect(model.modelCount).toBe(3);
    expect(model.selectedStrategy).toBe("container-model");
    expect(model.languageIds).toEqual(["javascript", "typescript"]);
    expect(model.sourceLength).toBe(5000);
  });

  it("空 Monaco model 字段应使用 null 默认值", () => {
    const probe = sanitizePageProbe({
      url: "https://example.com",
      monacoModels: [{}]
    });
    const model = probe.monacoModels[0];
    expect(model.selector).toBe("");
    expect(model.codeKind).toBe("");
    expect(model.mounted).toBe(false);
    expect(model.modelCount).toBeNull();
    expect(model.editorCount).toBeNull();
    expect(model.sourceLength).toBeNull();
  });

  it("executableContextOk 默认应为 true", () => {
    const probe = sanitizePageProbe({});
    expect(probe.executableContextOk).toBe(true);
  });

  it("executableContextOk 可设置为 false", () => {
    const probe = sanitizePageProbe({ executableContextOk: false });
    expect(probe.executableContextOk).toBe(false);
  });
});

// =============================================================================
// buildDiagnosticPackage - 构建完整诊断包（重点：新增 designerDomSnapshot）
// =============================================================================

describe("buildDiagnosticPackage", () => {
  it("应创建最小诊断包结构", () => {
    const pkg = buildDiagnosticPackage({
      operationId: "h3yun.captureAll"
    });
    expect(pkg.schemaVersion).toBe(1);
    expect(pkg.operationId).toBe("h3yun.captureAll");
    expect(pkg.extension).toEqual({ name: "", version: "" });
    expect(pkg.browser).toEqual({ userAgent: "" });
    expect(pkg.logs).toEqual([]);
    expect(pkg.preflightResults).toEqual([]);
    expect(pkg.nativeHost).toEqual({});
    expect(pkg.updateSync).toEqual({});
    // 关键断言：新增的 designerDomSnapshot 字段
    expect(pkg).toHaveProperty("designerDomSnapshot");
    expect(pkg.designerDomSnapshot).toBeNull();
  });

  it("designerDomSnapshot 默认应为 null", () => {
    const pkg = buildDiagnosticPackage({});
    expect(pkg.designerDomSnapshot).toBeNull();
  });

  it("designerDomSnapshot 未提供时应为 null", () => {
    const pkg = buildDiagnosticPackage({ designerDomSnapshot: undefined });
    expect(pkg.designerDomSnapshot).toBeNull();
  });

  it("designerDomSnapshot 提供时应保留传入的值", () => {
    const snapshot = {
      sheetFieldCatalog: [
        { sheetCode: "D001", names: ["子表1"], entryCount: 3, entries: [] }
      ],
      sheetContainers: []
    };
    const pkg = buildDiagnosticPackage({
      operationId: "h3yun.captureAll",
      designerDomSnapshot: snapshot
    });
    expect(pkg.designerDomSnapshot).toEqual(snapshot);
    expect(pkg.designerDomSnapshot.sheetFieldCatalog).toHaveLength(1);
    expect(pkg.designerDomSnapshot.sheetFieldCatalog[0].sheetCode).toBe("D001");
  });

  it("designerDomSnapshot 为 null 时应保持 null", () => {
    const pkg = buildDiagnosticPackage({ designerDomSnapshot: null });
    expect(pkg.designerDomSnapshot).toBeNull();
  });

  it("designerDomSnapshot 为空对象时应保留空对象（非 null）", () => {
    const pkg = buildDiagnosticPackage({ designerDomSnapshot: {} });
    expect(pkg.designerDomSnapshot).toEqual({});
  });

  it("应包含复杂 DOM 快照数据", () => {
    const complexSnapshot = {
      sheetFieldCatalog: [
        {
          sheetCode: "D001",
          names: ["采购明细"],
          entryCount: 5,
          entries: [
            { code: "D001.F001", displayName: "物品名称" },
            { code: "D001.F002", displayName: "数量" },
            { code: "D001.F003", displayName: "单价" },
            { code: "D001.CustomField", displayName: "自定义编码字段" },
            { code: "D001.F005", displayName: "金额" }
          ]
        }
      ],
      sheetContainers: [
        {
          tagName: "DIV",
          className: "sheet-container",
          attributeKeys: [
            { name: "data-sheet", value: "true" },
            { name: "data-code", value: "D001" }
          ],
          sheetControls: [
            {
              outerHTML: "<div class='sheet-control' data-code=''><span>物品名称</span></div>",
              attributeKeys: [
                { name: "class", value: "sheet-control" },
                { name: "index", value: "0" }
              ],
              textContent: "物品名称",
              vueKeys: [
                { key: "displayName", value: "物品名称", type: "string" },
                { key: "fieldCode", value: "F001", type: "string" },
                { key: "controlKey", value: "FormTextBox", type: "string" }
              ]
            }
          ]
        }
      ]
    };
    const pkg = buildDiagnosticPackage({
      operationId: "h3yun.captureAll",
      designerDomSnapshot: complexSnapshot
    });
    expect(pkg.designerDomSnapshot).toEqual(complexSnapshot);
    expect(pkg.designerDomSnapshot.sheetContainers).toHaveLength(1);
    expect(pkg.designerDomSnapshot.sheetContainers[0].sheetControls).toHaveLength(1);
    expect(pkg.designerDomSnapshot.sheetFieldCatalog[0].entries).toHaveLength(5);
  });

  it("应正确合并 extension 和 browser 信息", () => {
    const pkg = buildDiagnosticPackage({
      extension: { name: "开发助手", version: "1.4.0" },
      browser: { userAgent: "Chrome/148" }
    });
    expect(pkg.extension).toEqual({ name: "开发助手", version: "1.4.0" });
    expect(pkg.browser).toEqual({ userAgent: "Chrome/148" });
  });

  it("应正确序列化日志", () => {
    const pkg = buildDiagnosticPackage({
      logs: [
        {
          time: "2026/6/16 11:00:00",
          level: "warn",
          lines: ["line1", "line2"],
          suggestion: "请重试",
          context: { platform: "氚云" }
        }
      ]
    });
    expect(pkg.logs).toHaveLength(1);
    expect(pkg.logs[0].time).toBe("2026/6/16 11:00:00");
    expect(pkg.logs[0].level).toBe("warn");
    expect(pkg.logs[0].lines).toEqual(["line1", "line2"]);
    expect(pkg.logs[0].suggestion).toBe("请重试");
    expect(pkg.logs[0].context).toEqual({ platform: "氚云" });
  });

  it("日志的 lines 非数组时应为空数组", () => {
    const pkg = buildDiagnosticPackage({
      logs: [{ time: "t", level: "info", lines: "not-an-array" }]
    });
    expect(pkg.logs[0].lines).toEqual([]);
  });

  it("preflightResults 应正确映射", () => {
    const pkg = buildDiagnosticPackage({
      preflightResults: [
        { operationId: "h3yun.captureAll", checkId: "page.context", severity: "info", ok: true }
      ]
    });
    expect(pkg.preflightResults).toHaveLength(1);
    expect(pkg.preflightResults[0].operationId).toBe("h3yun.captureAll");
    expect(pkg.preflightResults[0].checkId).toBe("page.context");
  });

  it("预检结果非数组时应为空数组", () => {
    const pkg = buildDiagnosticPackage({ preflightResults: "invalid" });
    expect(pkg.preflightResults).toEqual([]);
  });

  it("nativeHost 非对象时应为空对象", () => {
    const pkg = buildDiagnosticPackage({ nativeHost: "invalid" });
    expect(pkg.nativeHost).toEqual({});
  });

  it("updateSync 非对象时应为空对象", () => {
    const pkg = buildDiagnosticPackage({ updateSync: null });
    expect(pkg.updateSync).toEqual({});
  });

  it("应使用提供的 createdAt 而不是新建", () => {
    const pkg = buildDiagnosticPackage({ createdAt: "2026-01-01T00:00:00.000Z" });
    expect(pkg.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("未提供 createdAt 时应自动生成 ISO 时间", () => {
    const pkg = buildDiagnosticPackage({});
    expect(pkg.createdAt).toBeTruthy();
    expect(() => new Date(pkg.createdAt)).not.toThrow();
  });

  it("schemaVersion 始终为 1", () => {
    expect(buildDiagnosticPackage({}).schemaVersion).toBe(1);
  });
});

// =============================================================================
// saveLastDiagnosticPackage / loadLastDiagnosticPackage - 持久化测试
// =============================================================================

describe("saveLastDiagnosticPackage", () => {
  let storageSpy;

  beforeEach(() => {
    // 模拟 chrome.storage.local
    const storageData = {};
    storageSpy = {
      set: vi.fn(async (data) => { Object.assign(storageData, data); }),
      get: vi.fn(async (keys) => {
        const defaults = keys?.[LAST_DIAGNOSTIC_PACKAGE_KEY] !== undefined
          ? { [LAST_DIAGNOSTIC_PACKAGE_KEY]: null }
          : {};
        const result = {};
        if (keys && typeof keys === "object") {
          for (const [key, defaultValue] of Object.entries(keys)) {
            result[key] = key in storageData ? storageData[key] : defaultValue;
          }
        }
        return result;
      })
    };
    globalThis.chrome = { storage: { local: storageSpy } };
  });

  afterEach(() => {
    delete globalThis.chrome;
  });

  it("应将诊断包保存到 chrome.storage.local", async () => {
    const pkg = buildDiagnosticPackage({ operationId: "test" });
    const result = await saveLastDiagnosticPackage(pkg);
    expect(result.operationId).toBe("test");
    expect(result.designerDomSnapshot).toBeNull();
    expect(storageSpy.set).toHaveBeenCalledTimes(1);
  });

  it("保存后应可加载", async () => {
    const pkg = buildDiagnosticPackage({
      operationId: "test-load",
      designerDomSnapshot: { test: true }
    });
    await saveLastDiagnosticPackage(pkg);
    const loaded = await loadLastDiagnosticPackage();
    expect(loaded).not.toBeNull();
    expect(loaded.operationId).toBe("test-load");
    expect(loaded.designerDomSnapshot).toEqual({ test: true });
  });

  it("无 chrome.storage.local 时 save 仍应返回 packageData", async () => {
    delete globalThis.chrome;
    const pkg = buildDiagnosticPackage({ operationId: "no-storage" });
    const result = await saveLastDiagnosticPackage(pkg);
    expect(result.operationId).toBe("no-storage");
  });
});

describe("loadLastDiagnosticPackage", () => {
  let storageData;

  beforeEach(() => {
    storageData = {};
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys) => {
            if (keys && typeof keys === "object") {
              const result = {};
              for (const [key, defaultValue] of Object.entries(keys)) {
                result[key] = key in storageData ? storageData[key] : defaultValue;
              }
              return result;
            }
            return {};
          })
        }
      }
    };
  });

  afterEach(() => {
    delete globalThis.chrome;
  });

  it("无存储数据时应返回 null", async () => {
    const result = await loadLastDiagnosticPackage();
    expect(result).toBeNull();
  });

  it("有存储数据时应返回重建的诊断包", async () => {
    const pkg = buildDiagnosticPackage({
      operationId: "stored",
      designerDomSnapshot: { snap: true }
    });
    storageData[LAST_DIAGNOSTIC_PACKAGE_KEY] = pkg;
    const loaded = await loadLastDiagnosticPackage();
    expect(loaded.operationId).toBe("stored");
    expect(loaded.designerDomSnapshot).toEqual({ snap: true });
  });

  it("无 chrome.storage.local 时应返回 null", async () => {
    delete globalThis.chrome;
    const result = await loadLastDiagnosticPackage();
    expect(result).toBeNull();
  });
});
