/**
 * 控件类型元数据模块。
 *
 * 提供云枢（HTML 标签名映射）和氚云（typeCode 映射）两套控件的类型信息，
 * 供 FromCode / README 生成和预检诊断使用。
 */

// ── 云枢控件类型参考 ──────────────────────────────────

interface ControlTypeMeta {
  readonly tagName: string;
  readonly typeName: string;
  readonly exampleName: string;
  readonly notes: string;
  readonly supportsOptions?: boolean;
  readonly supportsAssociation?: boolean;
  readonly supportsDateFormat?: boolean;
}

const RAW_CONTROL_TYPE_REFERENCE: readonly ControlTypeMeta[] = [
  { tagName: 'a-text', typeName: '单行文本', exampleName: '单行文本', notes: '普通文本输入' },
  { tagName: 'a-textarea', typeName: '长文本', exampleName: '长文本', notes: '多行文本输入' },
  { tagName: 'a-date', typeName: '日期', exampleName: '日期', notes: '日期或日期时间', supportsDateFormat: true },
  { tagName: 'a-number', typeName: '数值', exampleName: '数值', notes: '整数或小数' },
  { tagName: 'a-radio', typeName: '单选框', exampleName: '单选框', notes: '会提取控件选项', supportsOptions: true },
  { tagName: 'a-checkbox', typeName: '复选框', exampleName: '复选框', notes: '会提取控件选项', supportsOptions: true },
  { tagName: 'a-dropdown', typeName: '下拉单选框', exampleName: '下拉单选框', notes: '会提取控件选项', supportsOptions: true },
  { tagName: 'a-dropdown-multi', typeName: '下拉多选框', exampleName: '下拉多选框', notes: '会提取控件选项', supportsOptions: true },
  { tagName: 'a-logic', typeName: '逻辑', exampleName: '逻辑', notes: '布尔开关类控件' },
  { tagName: 'a-attachment', typeName: '附件', exampleName: '附件', notes: '文件上传' },
  { tagName: 'a-image', typeName: '图片', exampleName: '图片', notes: '图片上传' },
  { tagName: 'a-signature', typeName: '手写签名', exampleName: '手写签名', notes: '签字板' },
  { tagName: 'a-location', typeName: '地址', exampleName: '地址', notes: '定位地址' },
  { tagName: 'a-user-selector', typeName: '人员单选', exampleName: '人员单选', notes: '单选人员' },
  { tagName: 'a-user-multi-selector', typeName: '人员多选', exampleName: '人员多选', notes: '多选人员' },
  { tagName: 'a-departmentselector', typeName: '部门单选', exampleName: '部门单选', notes: '单选部门' },
  { tagName: 'a-departmentmultiselector', typeName: '部门多选', exampleName: '部门多选', notes: '多选部门' },
  { tagName: 'a-staffdeptmixed', typeName: '混合选人', exampleName: '混合选人', notes: '人员与部门混合选择' },
  { tagName: 'a-rate', typeName: '评分', exampleName: '评分', notes: '星级评分' },
  { tagName: 'a-sequence-no', typeName: '单据号', exampleName: '单据号', notes: '系统流水号' },
  { tagName: 'a-create-by', typeName: '创建人', exampleName: '创建人', notes: '系统字段' },
  { tagName: 'a-create-by-org', typeName: '创建人部门', exampleName: '创建人部门', notes: '系统字段' },
  { tagName: 'a-owner', typeName: '拥有者', exampleName: '拥有者', notes: '系统字段' },
  { tagName: 'a-ownerdeptid', typeName: '拥有者部门', exampleName: '拥有者部门', notes: '系统字段' },
  { tagName: 'a-created-time', typeName: '创建时间', exampleName: '创建时间', notes: '系统字段' },
  { tagName: 'a-modified-time', typeName: '修改时间', exampleName: '修改时间', notes: '系统字段' },
  { tagName: 'a-modify-b', typeName: '修改人', exampleName: '修改人', notes: '系统字段' },
  { tagName: 'a-association-form', typeName: '关联单选', exampleName: '关联单选', notes: '需补充关联表单信息', supportsAssociation: true },
  { tagName: 'a-relevance-form-multi', typeName: '关联多选', exampleName: '关联多选', notes: '需补充关联表单信息', supportsAssociation: true },
  { tagName: 'a-select', typeName: '选择器', exampleName: '选择器', notes: '兼容历史标签', supportsOptions: true },
  { tagName: 'a-input', typeName: '输入框', exampleName: '输入框', notes: '兼容历史标签' },
];

// ── 氚云控件类型参考 ──────────────────────────────────

/**
 * 氚云控件读取策略。
 * - `read`：参与 FromCode 输出
 * - `ignore`：布局 / 容器 / 说明类控件，不读取（FromCode 中不出现，子表内同样适用）
 */
export type H3yunControlReadMode = 'read' | 'ignore';

/**
 * 氚云控件「选项值」输出策略。
 * - `none`：不输出选项值（单行文本、多行文本等控件即使携带预设项也不输出）
 * - `items`：输出控件预设选项（下拉、单选、复选）
 * - `boolean`：固定输出 `true`、`false`（是否类控件，忽略设计器给出的「是/否」）
 */
export type H3yunOptionsMode = 'none' | 'items' | 'boolean';

interface H3yunControlTypeMeta {
  readonly typeCode: string;
  readonly typeName: string;
  readonly exampleName: string;
  readonly notes: string;
  readonly readMode: H3yunControlReadMode;
  readonly optionsMode: H3yunOptionsMode;
}

/** 是否类控件的固定选项值（氚云设计器给出「是/否」，读取时统一为布尔语义） */
export const H3YUN_BOOLEAN_OPTION_VALUES: readonly string[] = ['true', 'false'];

/**
 * 氚云全部控件类型（依据设计器实际输出的 ControlKey / type）。
 *
 * 说明：分组标题、一行多列在 allControls 中没有 ControlKey，只有数字 type（101 / 102），
 * 因此这里以数字字符串登记；其余类型均为 ControlKey 字符串。
 */
const RAW_H3YUN_CONTROL_TYPE_REFERENCE: readonly H3yunControlTypeMeta[] = [
  // 容器
  { typeCode: 'FormGridView', typeName: '子表', exampleName: '子表', notes: '明细行容器；子表内控件按子控件编码继续输出（同样遵守读取与选项值规则）', readMode: 'read', optionsMode: 'none' },
  // 输入类
  { typeCode: 'FormTextBox', typeName: '单行文本', exampleName: '单行文本', notes: '短文本输入；不输出选项值（关联属性也输出为该类型）', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormTextArea', typeName: '多行文本', exampleName: '多行文本', notes: '多行长文本；不输出选项值', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormDateTime', typeName: '日期', exampleName: '日期', notes: '日期或日期时间字段', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormNumber', typeName: '数字', exampleName: '数字', notes: '整数、小数、金额等数值输入', readMode: 'read', optionsMode: 'none' },
  // 选项类（唯一需要输出选项值的四类）
  { typeCode: 'FormRadioButtonList', typeName: '单选框', exampleName: '单选框', notes: '单选；输出预设选项值', readMode: 'read', optionsMode: 'items' },
  { typeCode: 'FormCheckboxList', typeName: '复选框', exampleName: '复选框', notes: '多选；输出预设选项值', readMode: 'read', optionsMode: 'items' },
  { typeCode: 'FormDropDownList', typeName: '下拉框', exampleName: '下拉框', notes: '下拉单选；输出预设选项值', readMode: 'read', optionsMode: 'items' },
  { typeCode: 'FormCheckbox', typeName: '是/否', exampleName: '是/否', notes: '布尔字段；选项值固定输出 true、false', readMode: 'read', optionsMode: 'boolean' },
  // 上传 / 选择类
  { typeCode: 'FormAttachment', typeName: '附件', exampleName: '附件', notes: '文件上传字段', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormPhoto', typeName: '图片', exampleName: '图片', notes: '图片上传字段（含「识别图片」）', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormAreaSelect', typeName: '地址', exampleName: '地址', notes: '省市区等区域地址选择', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormMap', typeName: '位置', exampleName: '位置', notes: '地图定位字段', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormUser', typeName: '人员单选', exampleName: '人员单选', notes: '选择一个组织人员；系统字段「拥有者」同为此类型', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormMultiUser', typeName: '人员多选', exampleName: '人员多选', notes: '选择多个组织人员', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormDepartment', typeName: '部门单选', exampleName: '部门单选', notes: '选择一个组织部门；系统字段「所属部门」同为此类型', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormMultiDepartment', typeName: '部门多选', exampleName: '部门多选', notes: '选择多个组织部门', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormHandSign', typeName: '手写签名', exampleName: '手写签名', notes: '签字板字段', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormEsign', typeName: '电子签章', exampleName: '电子签章', notes: '电子签章字段', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormOcr', typeName: 'AI 识别', exampleName: 'AI识别', notes: 'OCR 识别控件', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormQuery', typeName: '关联表单', exampleName: '关联表单', notes: '关联单选；输出关联表单编码', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormMultiQuery', typeName: '关联表单多选', exampleName: '关联表单多选', notes: '关联多选；输出关联表单编码', readMode: 'read', optionsMode: 'none' },
  // 只读 / 系统字段
  { typeCode: 'FormSeqNo', typeName: '流水号', exampleName: '流水号', notes: '系统流水号字段', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormLabel', typeName: '系统只读字段', exampleName: '创建人', notes: '创建人 / 创建时间 / 修改时间等系统字段', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormRollup', typeName: '汇总计算', exampleName: '汇总计算', notes: '只读汇总字段', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormFormula', typeName: '公式型控件', exampleName: '公式型控件', notes: '只读公式字段', readMode: 'read', optionsMode: 'none' },
  { typeCode: 'FormButton', typeName: '按钮', exampleName: '按钮', notes: '表单按钮控件', readMode: 'read', optionsMode: 'none' },
  // 不读取：布局 / 容器 / 说明
  { typeCode: '102', typeName: '一行多列', exampleName: '一行多列', notes: '布局容器，不读取（FromCode 中不出现）', readMode: 'ignore', optionsMode: 'none' },
  { typeCode: '101', typeName: '分组标题', exampleName: '分组标题', notes: '布局容器，不读取（FromCode 中不出现）', readMode: 'ignore', optionsMode: 'none' },
  { typeCode: 'FormDescription', typeName: '描述说明', exampleName: '描述说明', notes: '说明文字，不读取（FromCode 中不出现）', readMode: 'ignore', optionsMode: 'none' },
  { typeCode: 'FormTab', typeName: '标签页', exampleName: '标签页', notes: '布局容器，不读取（FromCode 中不出现）', readMode: 'ignore', optionsMode: 'none' },
];

/** 控件类型 → 元数据（键统一小写，兼容大小写差异） */
const H3YUN_CONTROL_TYPE_MAP = new Map<string, H3yunControlTypeMeta>(
  RAW_H3YUN_CONTROL_TYPE_REFERENCE.map((item) => [item.typeCode.toLowerCase(), item]),
);

function normalizeH3yunTypeCode(typeCode: unknown): string {
  return String(typeCode ?? '').trim().toLowerCase();
}

/** 获取氚云控件类型元数据（未登记的类型按「读取、不输出选项值」处理） */
export function getH3yunControlTypeMeta(typeCode: unknown): H3yunControlTypeMeta {
  return H3YUN_CONTROL_TYPE_MAP.get(normalizeH3yunTypeCode(typeCode)) ?? {
    typeCode: String(typeCode ?? '').trim(),
    typeName: '未归类控件',
    exampleName: '',
    notes: '未登记类型，按普通控件读取',
    readMode: 'read',
    optionsMode: 'none',
  };
}

/**
 * 不读取控件的显示名兜底清单。
 *
 * DOM 兜底抓取可能拿不到 ControlKey（类型码为空），此时用显示名识别布局 / 说明类控件。
 * 注意：仅在类型码缺失时启用，避免把用户自建的「分组标题」等同名文本控件误判为不读取。
 */
const IGNORED_CONTROL_DISPLAY_NAMES: readonly string[] = ['一行多列', '分组标题', '描述说明', '标签页'];

/**
 * 该控件是否需要读取。
 *
 * 不读取的仅限布局 / 容器 / 说明类：一行多列、分组标题、描述说明、标签页；
 * 已登记类型按类型判定，未登记 / 空类型码按「读取」处理（必要时用显示名兜底），
 * 避免因设计器新增类型而漏抓控件。
 */
export function isH3yunControlReadable(typeCode: unknown, displayName?: unknown): boolean {
  const normalized = normalizeH3yunTypeCode(typeCode);
  if (normalized) return getH3yunControlTypeMeta(normalized).readMode === 'read';
  return !IGNORED_CONTROL_DISPLAY_NAMES.includes(String(displayName ?? '').trim());
}

/** 该控件的选项值输出策略（none / items / boolean） */
export function resolveH3yunOptionsMode(typeCode: unknown): H3yunOptionsMode {
  return getH3yunControlTypeMeta(typeCode).optionsMode;
}

// ── 导出（冻结为只读） ─────────────────────────────────

export const CONTROL_TYPE_REFERENCE: readonly ControlTypeMeta[] = RAW_CONTROL_TYPE_REFERENCE;
export const H3YUN_CONTROL_TYPE_REFERENCE: readonly H3yunControlTypeMeta[] = RAW_H3YUN_CONTROL_TYPE_REFERENCE;

const CONTROL_TYPE_MAP = new Map<string, ControlTypeMeta>(
  CONTROL_TYPE_REFERENCE.map((item) => [item.tagName.toLowerCase(), item]),
);

function normalizeTagName(tagName: unknown): string {
  return String(tagName || '').trim().toLowerCase();
}

/** 获取云枢控件类型元数据（含兜底） */
export function getControlTypeMeta(tagName: string): ControlTypeMeta {
  const normalized = normalizeTagName(tagName);
  return CONTROL_TYPE_MAP.get(normalized) ?? {
    tagName: normalized,
    typeName: '未归类控件',
    exampleName: '',
    notes: '请根据页面 HTML 补充类型映射',
  };
}

/** 格式化控件类型标签 */
export function formatControlTypeLabel(tagName: string): string {
  const meta = getControlTypeMeta(tagName);
  return `${meta.tagName}（${meta.typeName}）`;
}

/** 控件是否支持自定义选项 */
export function supportsCustomOptions(tagName: string): boolean {
  return getControlTypeMeta(tagName).supportsOptions === true;
}

/** 控件是否支持关联单据元数据 */
export function supportsAssociationMetadata(tagName: string): boolean {
  return getControlTypeMeta(tagName).supportsAssociation === true;
}

/** 控件是否支持日期格式（data-format1） */
export function supportsDateFormat(tagName: string): boolean {
  return getControlTypeMeta(tagName).supportsDateFormat === true;
}
