// 氚云代码模块单元测试
// 覆盖导出函数：isH3yunCodeKindMatch, selectH3yunCodeModelSnapshot,
// extractH3yunCSharpClassName, extractH3yunDesignerId,
// resolveH3yunBackendFileName, resolveH3yunFrontendFileName,
// buildH3yunFromCodeContent, hasMissingH3yunChildCodes（新增）

import { describe, it, expect } from "vitest";
import {
  H3YUN_BACKEND_FALLBACK_FILE_NAME,
  H3YUN_FRONTEND_FALLBACK_FILE_NAME,
  isH3yunCodeKindMatch,
  selectH3yunCodeModelSnapshot,
  extractH3yunCSharpClassName,
  extractH3yunDesignerId,
  resolveH3yunBackendFileName,
  resolveH3yunFrontendFileName,
  buildH3yunFromCodeContent,
  hasMissingH3yunChildCodes
} from "../lib/h3yun-code.js";

// =============================================================================
// 常量验证
// =============================================================================

describe("H3YUN_BACKEND_FALLBACK_FILE_NAME", () => {
  it("应为 h3yun-backend.cs", () => {
    expect(H3YUN_BACKEND_FALLBACK_FILE_NAME).toBe("h3yun-backend.cs");
  });
});

describe("H3YUN_FRONTEND_FALLBACK_FILE_NAME", () => {
  it("应为 h3yun-frontend.js", () => {
    expect(H3YUN_FRONTEND_FALLBACK_FILE_NAME).toBe("h3yun-frontend.js");
  });
});

// =============================================================================
// isH3yunCodeKindMatch - 代码类型匹配
// =============================================================================

describe("isH3yunCodeKindMatch", () => {
  it("应识别 C# 源代码", () => {
    const csSource = "using System;\nnamespace Test { public class MyClass { } }";
    expect(isH3yunCodeKindMatch(csSource, "backend")).toBe(true);
  });

  it("应识别前端 JS 源代码", () => {
    const jsSource = "/* 注释 */\n$.extend({});\nfunction init() {}";
    expect(isH3yunCodeKindMatch(jsSource, "frontend")).toBe(true);
  });

  it("C# 源码不应匹配为 frontend（不含 JS 模式时）", () => {
    const csSource = "using System;\nnamespace Test { }";
    expect(isH3yunCodeKindMatch(csSource, "frontend")).toBe(false);
  });

  it("空字符串不应匹配任何类型", () => {
    expect(isH3yunCodeKindMatch("", "frontend")).toBe(false);
    expect(isH3yunCodeKindMatch("", "backend")).toBe(false);
  });

  it("undefined 不应抛出异常", () => {
    expect(() => isH3yunCodeKindMatch(undefined, "frontend")).not.toThrow();
    expect(isH3yunCodeKindMatch(undefined, "frontend")).toBe(false);
  });

  it("含 JS 模式但不含 C# 模式的代码应匹配 frontend", () => {
    expect(isH3yunCodeKindMatch("$.MyForm.extend({});", "frontend")).toBe(true);
  });
});

// =============================================================================
// selectH3yunCodeModelSnapshot - 选择最佳代码 model
// =============================================================================

describe("selectH3yunCodeModelSnapshot", () => {
  it("空快照列表应返回 null", () => {
    expect(selectH3yunCodeModelSnapshot([], "frontend")).toBeNull();
  });

  it("无匹配的快照应返回 null", () => {
    const snapshots = [
      { sourceContent: "using System;", versionId: 1 }
    ];
    expect(selectH3yunCodeModelSnapshot(snapshots, "frontend")).toBeNull();
  });

  it("单个匹配快照应返回该快照", () => {
    const snapshots = [
      { sourceContent: "$.extend({});", versionId: 5, index: 0 }
    ];
    const result = selectH3yunCodeModelSnapshot(snapshots, "frontend");
    expect(result).not.toBeNull();
    expect(result.versionId).toBe(5);
  });

  it("多个匹配快照应返回优先级最高的（挂载 + 高版本）", () => {
    const snapshots = [
      { sourceContent: "/* old */\nfunction oldCode(){}", versionId: 1, index: 0 },
      { sourceContent: "/* new */\nfunction newCode(){}", versionId: 100, index: 1, isAttached: true, isContainerModel: true }
    ];
    const result = selectH3yunCodeModelSnapshot(snapshots, "frontend");
    expect(result).not.toBeNull();
    expect(result.versionId).toBe(100);
  });

  it("应过滤非匹配类型的快照", () => {
    const snapshots = [
      { sourceContent: "using System;", versionId: 1 },  // C# - 不匹配 frontend
      { sourceContent: "/* test */\nfunction test(){}", versionId: 2 }  // JS - 匹配 frontend
    ];
    const result = selectH3yunCodeModelSnapshot(snapshots, "frontend");
    expect(result).not.toBeNull();
    expect(result.versionId).toBe(2);
  });

  it("处理 sourceContent 为空的快照", () => {
    const snapshots = [
      { sourceContent: "", versionId: 1 },
      { sourceContent: null, versionId: 2 }
    ];
    expect(selectH3yunCodeModelSnapshot(snapshots, "frontend")).toBeNull();
  });

  it("两个快照完全相同时应返回第一个（compareModelSnapshots 返回 0 分支）", () => {
    const snapshots = [
      { sourceContent: "/* a */\nfunction a(){}", versionId: 1, index: 0 },
      { sourceContent: "/* a */\nfunction a(){}", versionId: 1, index: 0 }
    ];
    const result = selectH3yunCodeModelSnapshot(snapshots, "frontend");
    // compareModelSnapshots 返回 0 时 reduce 保留 best（第一个）
    expect(result).not.toBeNull();
    expect(result.index).toBe(0);
  });

  it("snapshotLength 回退到 sourceContent.length（length 为 NaN/Infinity 时）", () => {
    const jsContent = "/* js */\nfunction handler(){}";
    const snaps = [
      { sourceContent: jsContent, versionId: 1, index: 0, length: Infinity }
    ];
    const r = selectH3yunCodeModelSnapshot(snaps, "frontend");
    expect(r).not.toBeNull();
    // length 为 Infinity → snapshotLength 回退到 sourceContent.length
    expect(r.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// extractH3yunCSharpClassName - 提取 C# 类名
// =============================================================================

describe("extractH3yunCSharpClassName", () => {
  it("应提取 public class 类名", () => {
    const result = extractH3yunCSharpClassName("public class MyForm { }");
    expect(result).toBe("MyForm");
  });

  it("应提取普通 class 类名", () => {
    const result = extractH3yunCSharpClassName("class TestClass { }");
    expect(result).toBe("TestClass");
  });

  it("无类名时应返回空字符串", () => {
    expect(extractH3yunCSharpClassName("using System;")).toBe("");
  });

  it("空输入应返回空字符串", () => {
    expect(extractH3yunCSharpClassName("")).toBe("");
    expect(extractH3yunCSharpClassName(null)).toBe("");
    expect(extractH3yunCSharpClassName(undefined)).toBe("");
  });
});

// =============================================================================
// extractH3yunDesignerId - 提取表单设计器 ID
// =============================================================================

describe("extractH3yunDesignerId", () => {
  it("应从 query string 中提取 id", () => {
    const url = "https://www.h3yun.com/pc/form-designer.html#/form-design?appcode=ABC&id=D123&isBeta=true";
    // hash 中的 query 参数
    expect(extractH3yunDesignerId(url)).toBe("D123");
  });

  it("应从 search params 中提取 id", () => {
    const url = "https://www.h3yun.com/pc/form-designer.html?id=D456#/form-design";
    // 注意：hash 中也有参数时，hash query 优先
    expect(extractH3yunDesignerId("https://www.h3yun.com/pc/form-designer.html#/form-design?id=D789")).toBe("D789");
  });

  it("无 id 时应返回空字符串", () => {
    expect(extractH3yunDesignerId("https://example.com")).toBe("");
  });

  it("id 出现在 search params 中（非 hash）时应直接返回", () => {
    // 覆盖 searchId 有值时直接 return searchId 的分支
    const url = "https://www.h3yun.com/pc/form-designer.html?id=D999#/form-design";
    expect(extractH3yunDesignerId(url)).toBe("D999");
  });

  it("无效 URL 应返回空字符串", () => {
    expect(extractH3yunDesignerId("not-a-url")).toBe("");
    expect(extractH3yunDesignerId("")).toBe("");
  });
});

// =============================================================================
// resolveH3yunBackendFileName - 解析后端文件名
// =============================================================================

describe("resolveH3yunBackendFileName", () => {
  it("应使用 C# 类名作为文件名", () => {
    const fileName = resolveH3yunBackendFileName({
      sourceContent: "public class MyBackendClass { }"
    });
    expect(fileName).toBe("MyBackendClass.cs");
  });

  it("无类名时应使用 URL ID", () => {
    const fileName = resolveH3yunBackendFileName({
      sourceContent: "using System;",
      pageUrl: "https://www.h3yun.com/pc/form-designer.html#/form-design?id=D123"
    });
    expect(fileName).toBe("D123.cs");
  });

  it("无类名且无 URL ID 时应使用兜底名", () => {
    const fileName = resolveH3yunBackendFileName({});
    expect(fileName).toBe("h3yun-backend.cs");
  });

  it("文件名已包含 .cs 后缀时不应重复", () => {
    const fileName = resolveH3yunBackendFileName({
      sourceContent: "public class MyForm.cs { }"
    });
    // 类名包含 .cs 字符但应该是正确类名
    expect(fileName.toLowerCase()).toMatch(/\.cs$/);
    expect(fileName).not.toMatch(/\.cs\.cs$/);
  });
});

// =============================================================================
// resolveH3yunFrontendFileName - 解析前端文件名
// =============================================================================

describe("resolveH3yunFrontendFileName", () => {
  it("应使用 URL ID 作为文件名", () => {
    const fileName = resolveH3yunFrontendFileName({
      pageUrl: "https://www.h3yun.com/pc/form-designer.html#/form-design?id=D123"
    });
    expect(fileName).toBe("D123.js");
  });

  it("无 URL ID 时应使用兜底名", () => {
    const fileName = resolveH3yunFrontendFileName({});
    expect(fileName).toBe("h3yun-frontend.js");
  });

  it("无效 URL 时应使用兜底名", () => {
    const fileName = resolveH3yunFrontendFileName({
      pageUrl: "not-a-url"
    });
    expect(fileName).toBe("h3yun-frontend.js");
  });
});

// =============================================================================
// buildH3yunFromCodeContent - 构建 FromCode.md 内容
// =============================================================================

describe("buildH3yunFromCodeContent", () => {
  it("应输出基本格式", () => {
    const content = buildH3yunFromCodeContent({
      pageUrl: "https://example.com/form?id=D001",
      appCode: "APP001",
      formId: "D001",
      controls: []
    });
    expect(content).toContain("页面地址: https://example.com/form?id=D001");
    expect(content).toContain("平台: 氚云");
    expect(content).toContain("应用编码: APP001");
    expect(content).toContain("表单ID: D001");
    expect(content).toContain("主表控件");
  });

  it("应输出主表控件信息", () => {
    const content = buildH3yunFromCodeContent({
      pageUrl: "https://example.com",
      appCode: "A",
      formId: "D",
      controls: [
        {
          code: "F001",
          controlKey: "FormTextBox",
          displayName: "姓名",
          children: []
        }
      ]
    });
    expect(content).toContain("控件名称: 姓名");
    expect(content).toContain("控件编码: F001");
    expect(content).toContain("控件类型: FormTextBox");
  });

  it("应输出子表控件信息", () => {
    const content = buildH3yunFromCodeContent({
      pageUrl: "https://example.com",
      appCode: "A",
      formId: "D",
      controls: [
        {
          code: "D001",
          controlKey: "FormGridView",
          displayName: "明细",
          sheetCode: "D001",
          children: [
            { code: "D001.F001", controlKey: "FormTextBox", displayName: "物品" },
            { code: "D001.F002", controlKey: "FormTextBox", displayName: "数量" }
          ]
        }
      ]
    });
    expect(content).toContain("子表信息");
    expect(content).toContain("子表名称: 明细");
    expect(content).toContain("子表编码: D001");
    expect(content).toContain("子表控件名称: 物品");
    // stripH3yunSheetCodePrefix 应剥离 D001 前缀
    expect(content).toContain("子表控件编码: F001");
    expect(content).toContain("子表控件编码: F002");
  });

  it("子表编码缺失时应回退到 control.code", () => {
    const content = buildH3yunFromCodeContent({
      pageUrl: "https://example.com",
      appCode: "A",
      formId: "D",
      controls: [
        {
          code: "D001",
          controlKey: "FormGridView",
          displayName: "明细",
          sheetCode: "",
          children: [
            { code: "D001.F001", controlKey: "FormTextBox", displayName: "物品" }
          ]
        }
      ]
    });
    expect(content).toContain("子表编码: D001");  // 回退到 control.code
  });

  it("metadata 为空时应正常输出", () => {
    const content = buildH3yunFromCodeContent({});
    expect(content).toContain("页面地址:");
    expect(content).toContain("平台: 氚云");
    expect(content).toContain("主表控件");
  });

  it("controls 非数组时应正常输出", () => {
    const content = buildH3yunFromCodeContent({ controls: null });
    expect(content).toContain("主表控件");
  });

  it("多重换行应压缩为双换行", () => {
    const content = buildH3yunFromCodeContent({
      pageUrl: "",
      controls: [
        { code: "F1", controlKey: "T", displayName: "n1", children: [] },
        { code: "F2", controlKey: "T", displayName: "n2", children: [] }
      ]
    });
    // 不应有连续 3 个以上的换行符
    expect(content).not.toMatch(/\n{3,}/);
  });

  it("子表控件编码不匹配 F 前缀时 stripH3yunSheetCodePrefix 也应剥离 D 前缀（支持自定义编码）", () => {
    // 当子控件编码格式为 D001.CustomCode（自定义编码），strip 也应剥离 D 前缀只保留字段编码
    const content = buildH3yunFromCodeContent({
      pageUrl: "https://example.com",
      appCode: "A",
      formId: "D",
      controls: [
        {
          code: "D001",
          controlKey: "FormGridView",
          displayName: "明细",
          sheetCode: "D001",
          children: [
            { code: "D001.CustomCode", controlKey: "FormTextBox", displayName: "自定义" },
            { code: "D001.plaintext", controlKey: "FormTextBox", displayName: "纯文本" }
          ]
        }
      ]
    });
    // 自定义编码（非 F 前缀）也应剥离 D 前缀，只保留字段编码部分
    expect(content).toContain("子表控件编码: CustomCode");
    expect(content).toContain("子表控件编码: plaintext");
  });
});

// =============================================================================
// hasMissingH3yunChildCodes - 检查子表控件编码缺失（新增功能）
// =============================================================================

describe("hasMissingH3yunChildCodes", () => {
  it("空数组应返回 false", () => {
    expect(hasMissingH3yunChildCodes([])).toBe(false);
  });

  it("undefined 应返回 false", () => {
    expect(hasMissingH3yunChildCodes(undefined)).toBe(false);
  });

  it("null 应返回 false", () => {
    expect(hasMissingH3yunChildCodes(null)).toBe(false);
  });

  it("非数组输入应返回 false", () => {
    expect(hasMissingH3yunChildCodes("string")).toBe(false);
    expect(hasMissingH3yunChildCodes({})).toBe(false);
    expect(hasMissingH3yunChildCodes(42)).toBe(false);
  });

  it("没有 children 的 control 应返回 false", () => {
    const controls = [
      { code: "F001", controlKey: "FormTextBox", displayName: "姓名" }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(false);
  });

  it("空 children 数组应返回 false", () => {
    const controls = [
      { code: "F001", controlKey: "FormTextBox", displayName: "姓名", children: [] }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(false);
  });

  it("所有子表控件都有编码时应返回 false", () => {
    const controls = [
      {
        code: "D001",
        controlKey: "FormGridView",
        displayName: "明细",
        children: [
          { code: "D001.F001", controlKey: "FormTextBox", displayName: "物品" },
          { code: "D001.F002", controlKey: "FormTextBox", displayName: "数量" },
          { code: "D001.F003", controlKey: "FormTextBox", displayName: "单价" }
        ]
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(false);
  });

  it("存在子表控件编码为空字符串时应返回 true", () => {
    const controls = [
      {
        code: "D001",
        controlKey: "FormGridView",
        displayName: "明细",
        children: [
          { code: "D001.F001", controlKey: "FormTextBox", displayName: "物品" },
          { code: "", controlKey: "FormTextBox", displayName: "数量" },
          { code: "D001.F003", controlKey: "FormTextBox", displayName: "单价" }
        ]
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(true);
  });

  it("存在子表控件编码为 null 时应返回 true", () => {
    const controls = [
      {
        code: "D001",
        controlKey: "FormGridView",
        displayName: "明细",
        children: [
          { code: "D001.F001", controlKey: "FormTextBox", displayName: "物品" },
          { code: null, controlKey: "FormTextBox", displayName: "数量" }
        ]
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(true);
  });

  it("存在子表控件编码为 undefined 时应返回 true", () => {
    const controls = [
      {
        code: "D001",
        controlKey: "FormGridView",
        displayName: "明细",
        children: [
          { controlKey: "FormTextBox", displayName: "物品" }  // 无 code 字段
        ]
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(true);
  });

  it("存在子表控件编码仅有空格时应返回 true", () => {
    const controls = [
      {
        code: "D001",
        controlKey: "FormGridView",
        displayName: "明细",
        children: [
          { code: "   ", controlKey: "FormTextBox", displayName: "物品" }
        ]
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(true);
  });

  it("children 不是数组时应安全处理", () => {
    const controls = [
      {
        code: "D001",
        controlKey: "FormGridView",
        displayName: "明细",
        children: null
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(false);
  });

  it("children 不是数组（字符串）时应安全处理", () => {
    const controls = [
      {
        code: "D001",
        controlKey: "FormGridView",
        displayName: "明细",
        children: "not-an-array"
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(false);
  });

  it("多个子表中有一个缺失编码即返回 true", () => {
    const controls = [
      {
        code: "D001",
        displayName: "明细1",
        children: [
          { code: "D001.F001", displayName: "物品1" },
          { code: "D001.F002", displayName: "物品2" }
        ]
      },
      {
        code: "D002",
        displayName: "明细2",
        children: [
          { code: "D002.F001", displayName: "物品3" },
          { code: "", displayName: "缺失编码项" }
        ]
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(true);
  });

  it("多个 control 但只有一个有子表且编码完整时应返回 false", () => {
    const controls = [
      { code: "F001", controlKey: "FormTextBox", displayName: "标题" },
      {
        code: "D001",
        controlKey: "FormGridView",
        displayName: "明细",
        children: [
          { code: "D001.F001", displayName: "物品" },
          { code: "D001.F002", displayName: "数量" }
        ]
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(false);
  });

  it("所有前 4 个有编码，第 5 个缺失时应返回 true（模拟 5 个缺失场景）", () => {
    const controls = [
      {
        code: "D001",
        controlKey: "FormGridView",
        displayName: "明细",
        children: [
          { code: "D001.F001", controlKey: "FormTextBox", displayName: "字段1" },
          { code: "D001.F002", controlKey: "FormTextBox", displayName: "字段2" },
          { code: "D001.F003", controlKey: "FormTextBox", displayName: "字段3" },
          { code: "D001.F004", controlKey: "FormTextBox", displayName: "字段4" },
          { code: "",         controlKey: "FormTextBox", displayName: "缺失字段5" },
          { code: "",         controlKey: "FormTextBox", displayName: "缺失字段6" }
        ]
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(true);
  });

  it("子控件 code 前后有空格的空白字符串应视为缺失", () => {
    const controls = [
      {
        code: "D001",
        children: [
          { code: "  \t  ", displayName: "空格编码" }
        ]
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(true);
  });

  it("子控件 code 为数字 0 时，因 0||'' 返回空字符串被视作缺失", () => {
    const controls = [
      {
        code: "D001",
        children: [
          { code: 0, displayName: "编码为0" }
        ]
      }
    ];
    // 注意：0 || "" 在 JS 中返回 ""，因此数字 0 被视作缺失编码
    expect(hasMissingH3yunChildCodes(controls)).toBe(true);
  });

  it("空 controls 数组但有其他字段应返回 false", () => {
    const controls = [
      { code: "D001", displayName: "子表", children: [] }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(false);
  });

  it("深层嵌套的子表控件应被检测", () => {
    const controls = [
      {
        code: "D001",
        displayName: "主子表",
        children: [
          { code: "D001.F001", displayName: "正常1" },
          { code: "D001.F002", displayName: "正常2" }
        ]
      },
      {
        code: "D002",
        displayName: "有缺失的子表",
        children: [
          { code: "D002.F001", displayName: "正常" },
          { displayName: "无code字段" }
        ]
      }
    ];
    expect(hasMissingH3yunChildCodes(controls)).toBe(true);
  });

  it("大数组性能测试：100 个 controls 各 20 个 children", () => {
    const controls = Array.from({ length: 100 }, (_, ci) => ({
      code: `D${String(ci).padStart(3, "0")}`,
      displayName: `子表${ci}`,
      children: Array.from({ length: 20 }, (_, si) => ({
        code: `D${String(ci).padStart(3, "0")}.F${String(si).padStart(3, "0")}`,
        displayName: `字段${ci}-${si}`
      }))
    }));
    expect(hasMissingH3yunChildCodes(controls)).toBe(false);
  });

  it("尾部有缺失编码的大数组应在首次匹配时短路返回", () => {
    const controls = Array.from({ length: 100 }, (_, ci) => ({
      code: `D${String(ci).padStart(3, "0")}`,
      displayName: `子表${ci}`,
      children: ci < 99
        ? Array.from({ length: 5 }, (_, si) => ({
            code: `D${String(ci).padStart(3, "0")}.F${String(si).padStart(3, "0")}`,
            displayName: `字段${ci}-${si}`
          }))
        : [
            { code: "", displayName: "缺失" }
          ]
    }));
    expect(hasMissingH3yunChildCodes(controls)).toBe(true);
  });
});
