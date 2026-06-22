// DOM 诊断快照功能测试（使用 jsdom 模拟 DOM 环境）
// 测试 buildMissingCodeDomSnapshot 的输出结构和边界条件

import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";

// =============================================================================
// 辅助函数：模拟 buildMissingCodeDomSnapshot 的核心逻辑
// 由于实际函数是 popup.js 中的闭包，这里复制其逻辑进行测试
// =============================================================================

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// 模拟 Vue 源采集（测试中不依赖真实 Vue，手动设置 __vue__）
function vueSources(element) {
  const sources = [];
  for (let node = element; node && sources.length < 24; node = node.parentElement) {
    if (node.__vue__) {
      sources.push(node.__vue__);
      if (node.__vue__.$props) sources.push(node.__vue__.$props);
      if (node.__vue__._data) sources.push(node.__vue__._data);
    }
  }
  return sources.filter(Boolean);
}

function buildMissingCodeDomSnapshot(root, sheetFieldCatalog) {
  var snap = {
    sheetFieldCatalog: [],
    sheetContainers: []
  };

  // 输出全局字段编码目录摘要
  for (var gi = 0; gi < sheetFieldCatalog.length; gi++) {
    var group = sheetFieldCatalog[gi];
    snap.sheetFieldCatalog.push({
      sheetCode: group.sheetCode,
      names: group.names,
      entryCount: group.entries.length,
      entries: group.entries.map(function (entry) {
        return { code: entry.code, displayName: entry.displayName || "" };
      })
    });
  }

  // 输出每个子表容器的 DOM 结构及 Vue 状态线索
  var sheetContainers = Array.from(root.querySelectorAll("[data-sheet='true']"));
  for (var ci = 0; ci < sheetContainers.length && ci < 20; ci++) {
    var container = sheetContainers[ci];
    var containerInfo = {
      tagName: String(container.tagName || ""),
      className: String(container.className || ""),
      attributeKeys: Array.from(container.attributes || []).slice(0, 30).map(function (attr) {
        return { name: attr.name, value: String(attr.value || "").substring(0, 300) };
      }),
      sheetControls: []
    };

    var sheetControls = Array.from(container.querySelectorAll(".sheet-control"));
    for (var si = 0; si < sheetControls.length && si < 50; si++) {
      var sc = sheetControls[si];
      var controlInfo = {
        outerHTML: String(sc.outerHTML || "").substring(0, 2000),
        attributeKeys: Array.from(sc.attributes || []).slice(0, 20).map(function (attr) {
          return { name: attr.name, value: String(attr.value || "").substring(0, 300) };
        }),
        textContent: String(sc.textContent || "").replace(/\s+/g, " ").trim().substring(0, 200),
        vueKeys: []
      };

      var sources = vueSources(sc);
      var seenVueKeys = {};
      for (var vi = 0; vi < sources.length && Object.keys(seenVueKeys).length < 40; vi++) {
        var source = sources[vi];
        if (!source || typeof source !== "object") continue;
        var keys = Object.keys(source).filter(function (k) {
          return /(code|field|control|property|schema|data|type|name|label|title|index|display|sheet|sort|order|key)/i.test(k);
        });
        for (var ki = 0; ki < keys.length && Object.keys(seenVueKeys).length < 40; ki++) {
          var key = keys[ki];
          if (seenVueKeys[key]) continue;
          seenVueKeys[key] = true;
          var rawValue = source[key];
          var type = typeof rawValue;
          var displayValue = "";
          if (type === "string") displayValue = rawValue.substring(0, 150);
          else if (type === "number" || type === "boolean") displayValue = String(rawValue);
          else if (rawValue && type === "object") displayValue = "[object]";
          controlInfo.vueKeys.push({ key: key, value: displayValue, type: type });
        }
      }

      containerInfo.sheetControls.push(controlInfo);
    }

    snap.sheetContainers.push(containerInfo);
  }

  return snap;
}

// =============================================================================
// 测试套件
// =============================================================================

describe("buildMissingCodeDomSnapshot", () => {
  let dom;

  beforeAll(() => {
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  });

  it("空 DOM（无 [data-sheet] 容器）应返回空 containers", () => {
    const doc = dom.window.document;
    const snap = buildMissingCodeDomSnapshot(doc.body, []);
    expect(snap.sheetFieldCatalog).toEqual([]);
    expect(snap.sheetContainers).toEqual([]);
  });

  it("应正确输出 sheetFieldCatalog 摘要", () => {
    const doc = dom.window.document;
    const catalog = [
      {
        sheetCode: "D001",
        names: ["子表1", "子表A"],
        entries: [
          { code: "D001.F001", displayName: "字段1" },
          { code: "D001.F002", displayName: "字段2" },
          { code: "D001.F003", displayName: "" }
        ]
      },
      {
        sheetCode: "D002",
        names: [],
        entries: [
          { code: "D002.CustomField", displayName: "自定义字段" }
        ]
      }
    ];
    const snap = buildMissingCodeDomSnapshot(doc.body, catalog);
    expect(snap.sheetFieldCatalog).toHaveLength(2);
    expect(snap.sheetFieldCatalog[0].sheetCode).toBe("D001");
    expect(snap.sheetFieldCatalog[0].names).toEqual(["子表1", "子表A"]);
    expect(snap.sheetFieldCatalog[0].entryCount).toBe(3);
    expect(snap.sheetFieldCatalog[0].entries).toHaveLength(3);
    // 空 displayName 应保留为空字符串
    expect(snap.sheetFieldCatalog[0].entries[2].displayName).toBe("");
    // 第二个 group
    expect(snap.sheetFieldCatalog[1].sheetCode).toBe("D002");
    expect(snap.sheetFieldCatalog[1].entries).toHaveLength(1);
    expect(snap.sheetFieldCatalog[1].entries[0].code).toBe("D002.CustomField");
  });

  it("应捕获单个子表容器的 DOM 结构", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");
    container.className = "grid-view-body";
    container.setAttribute("data-code", "D001");

    // 添加 .sheet-control 子元素
    const ctrl1 = doc.createElement("div");
    ctrl1.className = "sheet-control";
    ctrl1.setAttribute("index", "0");
    ctrl1.setAttribute("title", "物品名称");
    ctrl1.textContent = "物品名称";

    const ctrl2 = doc.createElement("div");
    ctrl2.className = "sheet-control";
    ctrl2.setAttribute("index", "1");
    ctrl2.setAttribute("title", "数量");
    ctrl2.textContent = "数量";

    container.appendChild(ctrl1);
    container.appendChild(ctrl2);
    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    expect(snap.sheetContainers).toHaveLength(1);
    expect(snap.sheetContainers[0].tagName).toBe("DIV");
    expect(snap.sheetContainers[0].className).toBe("grid-view-body");
    expect(snap.sheetContainers[0].sheetControls).toHaveLength(2);
  });

  it("应捕获子表控件的属性和文本内容", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");

    const ctrl = doc.createElement("div");
    ctrl.className = "sheet-control custom-class";
    ctrl.setAttribute("index", "2");
    ctrl.setAttribute("title", "自定义字段");
    ctrl.setAttribute("data-custom", "custom-value");
    ctrl.textContent = "自定义字段";

    container.appendChild(ctrl);
    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    const captured = snap.sheetContainers[0].sheetControls[0];

    expect(captured.outerHTML).toContain("sheet-control");
    expect(captured.outerHTML).toContain("custom-class");
    expect(captured.textContent).toBe("自定义字段");

    // 检查属性
    const attributeNames = captured.attributeKeys.map((a) => a.name);
    expect(attributeNames).toContain("class");
    expect(attributeNames).toContain("index");
    expect(attributeNames).toContain("title");
  });

  it("outerHTML 超过 2000 字符时应截断", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");

    // 创建属性很长的大元素
    const ctrl = doc.createElement("div");
    ctrl.className = "sheet-control";
    let longAttr = "";
    for (let i = 0; i < 500; i++) longAttr += "data-x";
    ctrl.setAttribute("data-long", longAttr);

    container.appendChild(ctrl);
    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    expect(snap.sheetContainers[0].sheetControls[0].outerHTML.length).toBeLessThanOrEqual(2000);
  });

  it("sheetContainers 超过 20 个时应截断", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    for (let i = 0; i < 25; i++) {
      const container = doc.createElement("div");
      container.setAttribute("data-sheet", "true");
      container.setAttribute("data-code", `D${String(i).padStart(3, "0")}`);
      root.appendChild(container);
    }
    const snap = buildMissingCodeDomSnapshot(root, []);
    expect(snap.sheetContainers.length).toBeLessThanOrEqual(20);
  });

  it("sheetControls 超过 50 个时应截断", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");
    for (let i = 0; i < 60; i++) {
      const ctrl = doc.createElement("div");
      ctrl.className = "sheet-control";
      ctrl.textContent = `字段${i}`;
      container.appendChild(ctrl);
    }
    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    expect(snap.sheetContainers[0].sheetControls.length).toBeLessThanOrEqual(50);
  });

  it("含 Vue 状态数据的控件应正确收集 vueKeys", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");

    const ctrl = doc.createElement("div");
    ctrl.className = "sheet-control";
    ctrl.setAttribute("index", "0");

    // 模拟 Vue 状态数据
    ctrl.__vue__ = {
      $props: {
        displayName: "字段名称",
        fieldCode: "F001",
        controlKey: "FormTextBox"
      },
      _data: {
        code: "D001.F001",
        type: "text",
        sort: 1,
        required: false
      }
    };

    container.appendChild(ctrl);
    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    const vueKeys = snap.sheetContainers[0].sheetControls[0].vueKeys;

    // 应包含来自 Vue 状态的 key
    const keyNames = vueKeys.map((k) => k.key.toLowerCase());
    expect(keyNames).toContain("displayname");
    expect(keyNames).toContain("fieldcode");
    expect(keyNames).toContain("controlkey");
    expect(keyNames).toContain("code");
    expect(keyNames).toContain("type");
    expect(keyNames).toContain("sort");
  });

  it("Vue keys 中对象类型值应显示 [object]", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");

    const ctrl = doc.createElement("div");
    ctrl.className = "sheet-control";
    ctrl.__vue__ = {
      $props: {
        // key 必须匹配过滤正则（含 code/field/control/property/schema/data/type/name/label 等）
        propertyOptions: { a: 1, b: 2 },
        controlRules: [{ required: true }]
      }
    };

    container.appendChild(ctrl);
    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    const vueKeys = snap.sheetContainers[0].sheetControls[0].vueKeys;

    const optionsKey = vueKeys.find((k) => k.key === "propertyOptions");
    expect(optionsKey).toBeDefined();
    expect(optionsKey.value).toBe("[object]");
    expect(optionsKey.type).toBe("object");
  });

  it("Vue keys 超过 40 个时应截断", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");

    const ctrl = doc.createElement("div");
    ctrl.className = "sheet-control";

    // 创建大量 Vue 状态 key
    const vueState = {};
    for (let i = 0; i < 100; i++) {
      vueState[`fieldCode${i}`] = `F${String(i).padStart(3, "0")}`;
      vueState[`controlName${i}`] = `控件${i}`;
      vueState[`dataType${i}`] = "string";
    }
    ctrl.__vue__ = { $props: vueState };

    container.appendChild(ctrl);
    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    expect(snap.sheetContainers[0].sheetControls[0].vueKeys.length).toBeLessThanOrEqual(40);
  });

  it("不匹配过滤条件的 Vue keys 应被排除", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");

    const ctrl = doc.createElement("div");
    ctrl.className = "sheet-control";
    ctrl.__vue__ = {
      $props: {
        fieldCode: "F001",          // 匹配 - 包含 "code"
        displayName: "名称",         // 匹配 - 包含 "name"
        controlType: "TextBox",     // 匹配 - 包含 "control"
        unrelatedValue: "ignored",  // 不匹配
        xyz: "also-ignored",        // 不匹配
        abc: "not-matched"          // 不匹配
      }
    };

    container.appendChild(ctrl);
    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    const vueKeys = snap.sheetContainers[0].sheetControls[0].vueKeys;
    const keyNames = vueKeys.map((k) => k.key);

    expect(keyNames).toContain("fieldCode");
    expect(keyNames).toContain("displayName");
    expect(keyNames).toContain("controlType");
    expect(keyNames).not.toContain("unrelatedValue");
    expect(keyNames).not.toContain("xyz");
    expect(keyNames).not.toContain("abc");
  });

  it("无 Vue 状态数据的控件应返回空 vueKeys", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");

    const ctrl = doc.createElement("div");
    ctrl.className = "sheet-control";
    ctrl.textContent = "无Vue状态";

    container.appendChild(ctrl);
    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    expect(snap.sheetContainers[0].sheetControls[0].vueKeys).toEqual([]);
  });

  it("属性值超过 300 字符时应截断", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");

    const ctrl = doc.createElement("div");
    ctrl.className = "sheet-control";
    let longValue = "x".repeat(500);
    ctrl.setAttribute("data-long-value", longValue);

    container.appendChild(ctrl);
    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    const longAttr = snap.sheetContainers[0].sheetControls[0].attributeKeys
      .find((a) => a.name === "data-long-value");
    expect(longAttr).toBeDefined();
    expect(longAttr.value.length).toBeLessThanOrEqual(300);
  });

  it("textContent 超过 200 字符时应截断", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");

    const ctrl = doc.createElement("div");
    ctrl.className = "sheet-control";
    ctrl.textContent = "x".repeat(500);

    container.appendChild(ctrl);
    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    expect(snap.sheetContainers[0].sheetControls[0].textContent.length).toBeLessThanOrEqual(200);
  });

  it("多个子表容器的完整快照结构应正确", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");

    // 第一个子表容器
    const container1 = doc.createElement("div");
    container1.setAttribute("data-sheet", "true");
    container1.className = "grid-view-container-1";

    const c1 = doc.createElement("div");
    c1.className = "sheet-control";
    c1.setAttribute("index", "0");
    c1.textContent = "字段A";

    const c2 = doc.createElement("div");
    c2.className = "sheet-control";
    c2.setAttribute("index", "1");
    c2.textContent = "字段B";

    container1.appendChild(c1);
    container1.appendChild(c2);
    root.appendChild(container1);

    // 第二个子表容器
    const container2 = doc.createElement("div");
    container2.setAttribute("data-sheet", "true");
    container2.className = "grid-view-container-2";

    const c3 = doc.createElement("div");
    c3.className = "sheet-control";
    c3.setAttribute("index", "0");
    c3.textContent = "字段C";

    container2.appendChild(c3);
    root.appendChild(container2);

    const catalog = [
      {
        sheetCode: "D001",
        names: ["子表1"],
        entries: [
          { code: "D001.F001", displayName: "字段A" },
          { code: "D001.F002", displayName: "字段B" }
        ]
      },
      {
        sheetCode: "D002",
        names: ["子表2"],
        entries: [
          { code: "D002.F001", displayName: "字段C" }
        ]
      }
    ];

    const snap = buildMissingCodeDomSnapshot(root, catalog);

    // 验证整体结构
    expect(snap.sheetFieldCatalog).toHaveLength(2);
    expect(snap.sheetContainers).toHaveLength(2);

    // 第一个容器
    expect(snap.sheetContainers[0].className).toBe("grid-view-container-1");
    expect(snap.sheetContainers[0].sheetControls).toHaveLength(2);

    // 第二个容器
    expect(snap.sheetContainers[1].className).toBe("grid-view-container-2");
    expect(snap.sheetContainers[1].sheetControls).toHaveLength(1);

    // catalog 与 containers 配对
    expect(snap.sheetFieldCatalog[0].entryCount).toBe(2);
    expect(snap.sheetFieldCatalog[1].entryCount).toBe(1);
  });

  it("应正确收集容器自身的属性", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    container.setAttribute("data-sheet", "true");
    container.setAttribute("data-code", "D001");
    container.setAttribute("data-display-name", "采购明细");
    container.setAttribute("style", "display:block");

    root.appendChild(container);

    const snap = buildMissingCodeDomSnapshot(root, []);
    const attrs = snap.sheetContainers[0].attributeKeys;
    expect(attrs.length).toBe(4); // class 不显式设置，但可能为空

    const attrMap = {};
    attrs.forEach((a) => { attrMap[a.name] = a.value; });
    expect(attrMap["data-sheet"]).toBe("true");
    expect(attrMap["data-code"]).toBe("D001");
    expect(attrMap["data-display-name"]).toBe("采购明细");
  });

  it("没有子表容器的根元素应返回空结果", () => {
    const doc = dom.window.document;
    const root = doc.createElement("div");

    // 添加非 data-sheet 元素
    const div = doc.createElement("div");
    div.className = "normal-container";
    div.setAttribute("data-code", "F001");
    root.appendChild(div);

    const snap = buildMissingCodeDomSnapshot(root, []);
    expect(snap.sheetContainers).toHaveLength(0);
  });
});
