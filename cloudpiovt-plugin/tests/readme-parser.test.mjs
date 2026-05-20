import assert from "node:assert/strict";
import {
  buildFromCodeContent,
  buildReadmeContent,
  extractReadmeMetadataFromHtml
} from "../lib/readme-parser.js";

const pageTypeConfig = {
  pageLabel: "表单在线开发"
};

const pageUrl = "https://example.com/model/app001/form001";
const metadata = extractReadmeMetadataFromHtml(
  [
    '<a-title data-name="测试表单">ignored</a-title>',
    '<a-input key="main_name" data-name="主表名称"></a-input>',
    '<a-sheet key="detail_table" data-name="明细表">',
    '<a-input key="detail_name" data-name="明细名称"></a-input>',
    "</a-sheet>"
  ].join(""),
  pageUrl
);

function assertIncludesAny(content, expectedTexts) {
  for (const text of expectedTexts) {
    assert.equal(content.includes(text), true, `应包含: ${text}`);
  }
}

// README.MD 现在只生成空白文件，控件名称、表名称等明细统一沉淀到 FromCode.md。
const readmeContent = buildReadmeContent(metadata, pageTypeConfig, pageUrl);
assert.equal(readmeContent, "", "README.MD 应为空白文件");

const fromCodeContent = buildFromCodeContent(metadata, pageTypeConfig, pageUrl);
assertIncludesAny(fromCodeContent, [
  "页面地址: https://example.com/model/app001/form001",
  "应用编码: app001",
  "表单编码: form001",
  "主表编码: form001",
  "控件编码: main_name",
  "子表编码: detail_table",
  "控件编码: detail_name"
]);

console.log("readme parser scenarios passed");
