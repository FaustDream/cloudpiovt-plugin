const RAW_CONTROL_TYPE_REFERENCE = [
  { tagName: "a-text", typeName: "单行文本", exampleName: "单行文本", notes: "普通文本输入" },
  { tagName: "a-textarea", typeName: "长文本", exampleName: "长文本", notes: "多行文本输入" },
  { tagName: "a-date", typeName: "日期", exampleName: "日期", notes: "日期或日期时间" },
  { tagName: "a-number", typeName: "数值", exampleName: "数值", notes: "整数或小数" },
  { tagName: "a-radio", typeName: "单选框", exampleName: "单选框", notes: "会提取控件选项", supportsOptions: true },
  { tagName: "a-checkbox", typeName: "复选框", exampleName: "复选框", notes: "会提取控件选项", supportsOptions: true },
  { tagName: "a-dropdown", typeName: "下拉单选框", exampleName: "下拉单选框", notes: "会提取控件选项", supportsOptions: true },
  { tagName: "a-dropdown-multi", typeName: "下拉多选框", exampleName: "下拉多选框", notes: "会提取控件选项", supportsOptions: true },
  { tagName: "a-logic", typeName: "逻辑", exampleName: "逻辑", notes: "布尔开关类控件" },
  { tagName: "a-attachment", typeName: "附件", exampleName: "附件", notes: "文件上传" },
  { tagName: "a-image", typeName: "图片", exampleName: "图片", notes: "图片上传" },
  { tagName: "a-signature", typeName: "手写签名", exampleName: "手写签名", notes: "签字板" },
  { tagName: "a-location", typeName: "地址", exampleName: "地址", notes: "定位地址" },
  { tagName: "a-user-selector", typeName: "人员单选", exampleName: "人员单选", notes: "单选人员" },
  { tagName: "a-user-multi-selector", typeName: "人员多选", exampleName: "人员多选", notes: "多选人员" },
  { tagName: "a-departmentselector", typeName: "部门单选", exampleName: "部门单选", notes: "单选部门" },
  { tagName: "a-departmentmultiselector", typeName: "部门多选", exampleName: "部门多选", notes: "多选部门" },
  { tagName: "a-staffdeptmixed", typeName: "混合选人", exampleName: "混合选人", notes: "人员与部门混合选择" },
  { tagName: "a-rate", typeName: "评分", exampleName: "评分", notes: "星级评分" },
  { tagName: "a-sequence-no", typeName: "单据号", exampleName: "单据号", notes: "系统流水号" },
  { tagName: "a-create-by", typeName: "创建人", exampleName: "创建人", notes: "系统字段" },
  { tagName: "a-create-by-org", typeName: "创建人部门", exampleName: "创建人部门", notes: "系统字段" },
  { tagName: "a-owner", typeName: "拥有者", exampleName: "拥有者", notes: "系统字段" },
  { tagName: "a-ownerdeptid", typeName: "拥有者部门", exampleName: "拥有者部门", notes: "系统字段" },
  { tagName: "a-created-time", typeName: "创建时间", exampleName: "创建时间", notes: "系统字段" },
  { tagName: "a-modified-time", typeName: "修改时间", exampleName: "修改时间", notes: "系统字段" },
  { tagName: "a-modify-b", typeName: "修改人", exampleName: "修改人", notes: "系统字段" },
  { tagName: "a-association-form", typeName: "关联单选", exampleName: "关联单选", notes: "需补充关联表单信息", supportsAssociation: true },
  { tagName: "a-relevance-form-multi", typeName: "关联多选", exampleName: "关联多选", notes: "需补充关联表单信息", supportsAssociation: true },
  { tagName: "a-select", typeName: "选择器", exampleName: "选择器", notes: "兼容历史标签", supportsOptions: true },
  { tagName: "a-input", typeName: "输入框", exampleName: "输入框", notes: "兼容历史标签" }
];

export const CONTROL_TYPE_REFERENCE = RAW_CONTROL_TYPE_REFERENCE.map((item) => Object.freeze({
  ...item
}));

const CONTROL_TYPE_MAP = new Map(
  CONTROL_TYPE_REFERENCE.map((item) => [item.tagName, item])
);

function normalizeTagName(tagName) {
  return String(tagName || "")
    .trim()
    .toLowerCase();
}

export function getControlTypeMeta(tagName) {
  const normalizedTagName = normalizeTagName(tagName);
  return CONTROL_TYPE_MAP.get(normalizedTagName) || {
    tagName: normalizedTagName,
    typeName: "未归类控件",
    exampleName: "",
    notes: "请根据页面 HTML 补充类型映射",
    supportsOptions: false,
    supportsAssociation: false
  };
}

export function formatControlTypeLabel(tagName) {
  const controlTypeMeta = getControlTypeMeta(tagName);
  return `${controlTypeMeta.tagName}（${controlTypeMeta.typeName}）`;
}

export function supportsCustomOptions(tagName) {
  return Boolean(getControlTypeMeta(tagName).supportsOptions);
}

export function supportsAssociationMetadata(tagName) {
  return Boolean(getControlTypeMeta(tagName).supportsAssociation);
}
