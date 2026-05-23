import assert from "node:assert/strict";
import {
  buildFromCodeContent,
  buildReadmeContent,
  buildReadmeWriteFiles,
  extractReadmeMetadataFromHtml
} from "../lib/readme-parser.js";

const pageTypeConfig = {
  pageLabel: "表单在线开发"
};

function assertIncludesAny(content, expectedTexts) {
  for (const text of expectedTexts) {
    assert.equal(content.includes(text), true, `应包含: ${text}`);
  }
}

function assertIncludesBlock(content, expectedBlock) {
  assert.equal(content.includes(expectedBlock), true, `应包含连续片段:\n${expectedBlock}`);
}

function findControl(controls, code) {
  const control = controls.find((item) => item.code === code);
  assert.ok(control, `应找到控件: ${code}`);
  return control;
}

const basicPageUrl = "https://example.com/model/app001/form001";
const basicMetadata = extractReadmeMetadataFromHtml(
  [
    '<a-title data-name="测试表单">ignored</a-title>',
    `<a-select key="result_status" data-name="处理结果" data-options='{"optionsType":"custom","custom":[{"value":"成功","code":"option1","name_i18n":{"zh":"成功"}},{"value":"失败","code":"option2","name_i18n":{"zh":"失败"}},{"value":">3天","code":"option3","name_i18n":{"zh":">3天"}},{"value":"异常","code":"option4","name_i18n":{"zh":"异常"}}]}'></a-select>`,
    '<a-input key="main_name" data-name="主表名称"></a-input>',
    '<a-sheet key="detail_table" data-name="明细表">',
    `<a-radio key="detail_status" data-name="明细状态" data-options='{"optionsType":"custom","custom":[{"value":"通过","code":"option1","name_i18n":{"zh":"通过"}},{"value":"驳回","code":"option2","name_i18n":{"zh":"驳回"}}]}'></a-radio>`,
    '<a-input key="detail_name" data-name="明细名称"></a-input>',
    "</a-sheet>"
  ].join(""),
  basicPageUrl
);

// README.MD 仍然保持空白占位，只把结构化信息写进 FromCode.md。
const readmeContent = buildReadmeContent(basicMetadata, pageTypeConfig, basicPageUrl);
assert.equal(readmeContent, "", "README.MD 应为空白文件");

const firstWriteFiles = buildReadmeWriteFiles(basicMetadata, pageTypeConfig, basicPageUrl, { hasReadme: false });
assert.deepEqual(
  firstWriteFiles.map((item) => item.fileName),
  ["README.MD", "FromCode.md"],
  "README.MD 缺失时应补建 README.MD 和 FromCode.md"
);
assert.equal(firstWriteFiles[0].content, "", "补建的 README.MD 应为空白文件");

const subsequentWriteFiles = buildReadmeWriteFiles(basicMetadata, pageTypeConfig, basicPageUrl, { hasReadme: true });
assert.deepEqual(
  subsequentWriteFiles.map((item) => item.fileName),
  ["FromCode.md"],
  "已有 README.MD 时后续抓取只应同步 FromCode.md"
);

const basicFromCodeContent = buildFromCodeContent(basicMetadata, pageTypeConfig, basicPageUrl);
assertIncludesAny(basicFromCodeContent, [
  "页面地址: https://example.com/model/app001/form001",
  "应用编码: app001",
  "表单编码: form001",
  "主表编码: form001",
  "子表编码: detail_table",
  "控件编码: detail_name"
]);
assertIncludesBlock(
  basicFromCodeContent,
  [
    "控件名称: 处理结果",
    "控件编码: result_status",
    "控件类型: a-select（选择器）",
    "控件选项: 成功、失败、>3天、异常",
    "控件名称: 主表名称"
  ].join("\n")
);
assertIncludesBlock(
  basicFromCodeContent,
  [
    "控件名称: 明细状态",
    "控件编码: detail_status",
    "控件类型: a-radio（单选框）",
    "控件选项: 通过、驳回",
    "控件名称: 明细名称"
  ].join("\n")
);

const fullControlPageUrl = "https://example.com/model/demoApp/master001/formDesign";
const fullControlHtml = [
  '<a-title key="title1741850424932" data-name="主表1" data-name_i18n=\'{"en":"主表1"}\' data-span="24"></a-title>',
  '<a-text key="ShortText1779343804017" data-name="单行文本"></a-text>',
  '<a-textarea key="LongText1779343804527" data-name="长文本"></a-textarea>',
  '<a-date key="Date1779343805306" data-name="日期"></a-date>',
  '<a-number key="Number1779343805750" data-name="数值"></a-number>',
  `<a-radio key="Radio1779343806374" data-name="单选框" data-options='{"optionsType":"custom","custom":[{"value":"1","code":"option1","name_i18n":{"zh":"1"}},{"value":"2","code":"option2","name_i18n":{"zh":"2"}},{"value":"3","code":"option3","name_i18n":{"zh":"3"}},{"value":"4","code":"option4","name_i18n":{"zh":"4"}}],"businessModel":{"orderType":1},"dictionary":{}}'></a-radio>`,
  `<a-checkbox key="Checkbox1779343806845" data-name="复选框" data-options='{"optionsType":"custom","custom":[{"value":"1","code":"option1","name_i18n":{"zh":"1"}},{"value":"2","code":"option2","name_i18n":{"zh":"2"}},{"value":"3","code":"option3","name_i18n":{"zh":"3"}},{"value":"4","code":"option4","name_i18n":{"zh":"4"}}],"businessModel":{"orderType":1},"dictionary":{}}'></a-checkbox>`,
  `<a-dropdown key="Dropdown1779343807422" data-name="下拉单选框" data-options='{"optionsType":"custom","custom":[{"value":"1","code":"option1","name_i18n":{"zh":"1"}},{"value":"2","code":"option2","name_i18n":{"zh":"2"}},{"value":"3","code":"option3","name_i18n":{"zh":"3"}},{"value":"4","code":"option4","name_i18n":{"zh":"4"}}],"businessModel":{"orderType":1},"dictionary":{}}'></a-dropdown>`,
  `<a-dropdown-multi key="DropdownMulti1779343807835" data-name="下拉多选框" data-options='{"optionsType":"custom","custom":[{"value":"1","code":"option1","name_i18n":{"zh":"1"}},{"value":"2","code":"option2","name_i18n":{"zh":"2"}},{"value":"3","code":"option3","name_i18n":{"zh":"3"}},{"value":"4","code":"option4","name_i18n":{"zh":"4"}}],"businessModel":{"orderType":1},"dictionary":{}}'></a-dropdown-multi>`,
  '<a-logic key="Logic1779343808361" data-name="逻辑"></a-logic>',
  '<a-attachment key="Attachment1779343809508" data-name="附件"></a-attachment>',
  '<a-image key="Attachment1779343810737" data-name="图片"></a-image>',
  '<a-signature key="Attachment1779343811135" data-name="手写签名"></a-signature>',
  '<a-location key="Address1779343811638" data-name="地址"></a-location>',
  '<a-user-selector key="StaffSingle1779343812065" data-name="人员单选"></a-user-selector>',
  '<a-user-multi-selector key="StaffMulti1779343813108" data-name="人员多选"></a-user-multi-selector>',
  '<a-departmentselector key="DeptSingle1779343813514" data-name="部门单选"></a-departmentselector>',
  '<a-departmentmultiselector key="DeptMulti1779343814030" data-name="部门多选"></a-departmentmultiselector>',
  '<a-staffDeptMixed key="StaffDeptMix1779343814481" data-name="混合选人"></a-staffDeptMixed>',
  '<a-rate key="Number1779343815763" data-name="评分"></a-rate>',
  '<a-sequence-no key="sequenceNo" data-name="单据号"></a-sequence-no>',
  '<a-create-by key="creater" data-name="创建人"></a-create-by>',
  '<a-create-by-org key="createdDeptId" data-name="创建人部门"></a-create-by-org>',
  '<a-owner key="owner" data-name="拥有者"></a-owner>',
  '<a-association-form key="RelevanceForm1779343871245" data-name="关联单选" data-schema-code="csqm" data-query-code="csqm" data-display-field="name"></a-association-form>',
  '<a-relevance-form-multi key="RelevanceFormEx1779343872183" data-name="关联多选" data-schema-code="csqm" data-query-code="csqm" data-display-field="name"></a-relevance-form-multi>',
  '<a-ownerDeptId key="ownerDeptId" data-name="拥有者部门"></a-ownerDeptId>',
  '<a-created-time key="createdTime" data-name="创建时间"></a-created-time>',
  '<a-modified-time key="modifiedTime" data-name="修改时间"></a-modified-time>',
  '<a-modify-b key="modifier" data-name="修改人"></a-modify-b>'
].join("");

const fullControlMetadata = extractReadmeMetadataFromHtml(fullControlHtml, fullControlPageUrl);
assert.equal(fullControlMetadata.formName, "主表1", "应识别表单名称");
assert.equal(fullControlMetadata.applicationCode, "demoApp", "应识别应用编码");
assert.equal(fullControlMetadata.formCode, "master001", "应识别表单编码");
assert.equal(fullControlMetadata.subtables.length, 0, "当前示例不应识别出子表");

assert.deepEqual(
  findControl(fullControlMetadata.mainControls, "Radio1779343806374").options,
  ["1", "2", "3", "4"],
  "单选框应提取控件选项"
);
assert.deepEqual(
  findControl(fullControlMetadata.mainControls, "Checkbox1779343806845").options,
  ["1", "2", "3", "4"],
  "复选框应提取控件选项"
);
assert.deepEqual(
  findControl(fullControlMetadata.mainControls, "Dropdown1779343807422").options,
  ["1", "2", "3", "4"],
  "下拉单选框应提取控件选项"
);
assert.deepEqual(
  findControl(fullControlMetadata.mainControls, "DropdownMulti1779343807835").options,
  ["1", "2", "3", "4"],
  "下拉多选框应提取控件选项"
);

const firstAssociationFromCode = buildFromCodeContent(fullControlMetadata, pageTypeConfig, fullControlPageUrl);
assertIncludesBlock(
  firstAssociationFromCode,
  [
    "控件名称: 单行文本",
    "控件编码: ShortText1779343804017",
    "控件类型: a-text（单行文本）",
    "控件名称: 长文本"
  ].join("\n")
);
assertIncludesBlock(
  firstAssociationFromCode,
  [
    "控件名称: 下拉多选框",
    "控件编码: DropdownMulti1779343807835",
    "控件类型: a-dropdown-multi（下拉多选框）",
    "控件选项: 1、2、3、4",
    "控件名称: 逻辑"
  ].join("\n")
);
assertIncludesBlock(
  firstAssociationFromCode,
  [
    "控件名称: 关联单选",
    "控件编码: RelevanceForm1779343871245",
    "控件类型: a-association-form（关联单选）",
    "关联表单编码: csqm",
    "关联表单名称: ",
    "控件名称: 关联多选"
  ].join("\n")
);
assertIncludesBlock(
  firstAssociationFromCode,
  [
    "控件名称: 关联多选",
    "控件编码: RelevanceFormEx1779343872183",
    "控件类型: a-relevance-form-multi（关联多选）",
    "关联表单编码: csqm",
    "关联表单名称: ",
    "控件名称: 拥有者部门"
  ].join("\n")
);

const preservedAssociationFromCode = buildFromCodeContent(
  fullControlMetadata,
  pageTypeConfig,
  fullControlPageUrl,
  [
    "主表控件",
    "控件名称: 关联单选",
    "控件编码: RelevanceForm1779343871245",
    "控件类型: a-association-form（关联单选）",
    "关联表单编码: custom_form_code",
    "关联表单名称: 自定义表单",
    "控件名称: 关联多选",
    "控件编码: RelevanceFormEx1779343872183",
    "控件类型: a-relevance-form-multi（关联多选）",
    "关联表单编码: custom_multi_code",
    "关联表单名称: 自定义多选表单"
  ].join("\n")
);
assertIncludesAny(preservedAssociationFromCode, [
  "关联表单编码: custom_form_code",
  "关联表单名称: 自定义表单",
  "关联表单编码: custom_multi_code",
  "关联表单名称: 自定义多选表单"
]);

const duplicatedAssociationMetadata = extractReadmeMetadataFromHtml(
  [
    '<a-title data-name="重复编码测试"></a-title>',
    '<a-association-form key="shared_code" data-name="主表关联" data-schema-code="main_form"></a-association-form>',
    '<a-sheet key="detail_table" data-name="明细表">',
    '<a-association-form key="shared_code" data-name="子表关联" data-schema-code="detail_form"></a-association-form>',
    "</a-sheet>"
  ].join(""),
  basicPageUrl
);
const duplicatedAssociationFromCode = buildFromCodeContent(
  duplicatedAssociationMetadata,
  pageTypeConfig,
  basicPageUrl,
  [
    "主表控件",
    "控件名称: 主表关联",
    "控件编码: shared_code",
    "控件类型: a-association-form（关联单选）",
    "关联表单编码: custom_main",
    "关联表单名称: 主表手填",
    "",
    "子表信息",
    "子表名称: 明细表",
    "子表编码: detail_table",
    "控件名称: 子表关联",
    "控件编码: shared_code",
    "控件类型: a-association-form（关联单选）",
    "关联表单编码: custom_detail",
    "关联表单名称: 子表手填"
  ].join("\n")
);
assertIncludesBlock(
  duplicatedAssociationFromCode,
  [
    "控件名称: 主表关联",
    "控件编码: shared_code",
    "控件类型: a-association-form（关联单选）",
    "关联表单编码: custom_main",
    "关联表单名称: 主表手填",
    "",
    "子表信息"
  ].join("\n")
);
assertIncludesBlock(
  duplicatedAssociationFromCode,
  [
    "子表名称: 明细表",
    "子表编码: detail_table",
    "控件名称: 子表关联",
    "控件编码: shared_code",
    "控件类型: a-association-form（关联单选）",
    "关联表单编码: custom_detail",
    "关联表单名称: 子表手填"
  ].join("\n")
);

console.log("readme parser scenarios passed");
