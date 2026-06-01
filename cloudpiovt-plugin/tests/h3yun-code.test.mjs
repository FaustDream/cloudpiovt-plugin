import assert from "node:assert/strict";
import {
  buildH3yunFromCodeContent,
  extractH3yunCSharpClassName,
  extractH3yunDesignerId,
  resolveH3yunBackendFileName,
  resolveH3yunFrontendFileName,
  selectH3yunCodeModelSnapshot
} from "../lib/h3yun-code.js";

const h3yunFormUrl = "https://www.h3yun.com/pc/form-designer.html#/form-design?appcode=D000772XTKFCS&id=D000772bdef015e8ca549ac9921b0ec1776682c&isBeta=true";
const h3yunBackendSource = [
  "using System;",
  "public class D000772bdef015e8ca549ac9921b0ec1776682c: H3.SmartForm.SmartFormController",
  "{",
  "}"
].join("\n");

assert.equal(
  extractH3yunCSharpClassName(h3yunBackendSource),
  "D000772bdef015e8ca549ac9921b0ec1776682c",
  "应从氚云 C# 源码解析 SmartFormController 类名"
);

assert.equal(
  extractH3yunDesignerId(h3yunFormUrl),
  "D000772bdef015e8ca549ac9921b0ec1776682c",
  "应从氚云 hash 路由查询参数解析对象 ID"
);

assert.equal(
  resolveH3yunBackendFileName({ sourceContent: h3yunBackendSource, pageUrl: h3yunFormUrl }),
  "D000772bdef015e8ca549ac9921b0ec1776682c.cs",
  "源码类名应优先作为后端代码文件名"
);

assert.equal(
  resolveH3yunBackendFileName({ sourceContent: "", pageUrl: h3yunFormUrl }),
  "D000772bdef015e8ca549ac9921b0ec1776682c.cs",
  "源码为空时应回退使用页面对象 ID"
);

assert.equal(
  resolveH3yunBackendFileName({ sourceContent: "", pageUrl: "https://www.h3yun.com/pc/form-designer.html" }),
  "h3yun-backend.cs",
  "缺少类名和对象 ID 时应使用稳定兜底文件名"
);

assert.equal(
  resolveH3yunFrontendFileName({ pageUrl: h3yunFormUrl }),
  "D000772bdef015e8ca549ac9921b0ec1776682c.js",
  "前端 JS 文件名应优先使用页面对象 ID"
);

const fromCodeContent = buildH3yunFromCodeContent({
  pageUrl: h3yunFormUrl,
  appCode: "D000772XTKFCS",
  formId: "D000772bdef015e8ca549ac9921b0ec1776682c",
  controls: [
    { code: "F0000001", controlKey: "FormTextBox", displayName: "单行文本", children: [] },
    {
      code: "D000772F0338b760052a42b6ba0354e705eca09e",
      controlKey: "FormGridView",
      displayName: "子表",
      children: [{ code: "", controlKey: "SheetControl", displayName: "单行文本", index: "0" }]
    }
  ]
});

assert.equal(fromCodeContent.includes("平台: 氚云"), true, "FromCode.md 应标记氚云平台");
assert.equal(fromCodeContent.includes("应用编码: D000772XTKFCS"), true, "FromCode.md 应包含应用编码");
assert.equal(fromCodeContent.includes("控件编码: F0000001"), true, "FromCode.md 应包含主表控件编码");
assert.equal(fromCodeContent.includes("子表编码: D000772F0338b760052a42b6ba0354e705eca09e"), true, "FromCode.md 应包含子表编码");
assert.equal(fromCodeContent.includes("子表控件名称: 单行文本"), true, "FromCode.md 应包含子表控件名称");

const h3yunFrontendTemplate = [
  "/* 控件接口说明：",
  " * 1. 读取控件: this.***,*号输入控件编码;",
  " * 2. 读取控件的值： this.***.GetValue();",
  " */",
  "$.extend($.JForm, {",
  "    OnLoad:function(){",
  "    },",
  "    AfterSubmit:function(action, responseValue){",
  "    }",
  "});",
  "// 模板尾部说明让默认模板更长，模拟氚云旧 model 未卸载场景。"
].join("\n");
const h3yunFrontendEdited = [
  "/* 控件接口说明：",
  " * 1. 读取控件: this.***,*号输入控件编码;",
  " */",
  "$.extend($.JForm, {",
  "    OnLoad:function(){",
  "        this.F0000001.SetValue(\"用户后续编辑\");",
  "    },",
  "    AfterSubmit:function(action, responseValue){",
  "    }",
  "});"
].join("\n");

assert.equal(
  selectH3yunCodeModelSnapshot([
    { index: 0, sourceContent: h3yunBackendSource, length: h3yunBackendSource.length, versionId: 1, isAttached: true },
    { index: 1, sourceContent: h3yunFrontendTemplate, length: h3yunFrontendTemplate.length, versionId: 1, isAttached: true },
    { index: 2, sourceContent: h3yunFrontendEdited, length: h3yunFrontendEdited.length, versionId: 8, isAttached: true }
  ], "frontend")?.sourceContent,
  h3yunFrontendEdited,
  "多个前端 model 同时命中时，应优先选择版本更新的用户编辑 model，而不是更长的模板 model"
);

console.log("h3yun code scenarios passed");
