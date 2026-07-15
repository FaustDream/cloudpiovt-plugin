import { cleanInlineText, cleanMultilineText } from "../utils.js";

export const WORKSPACE_DOCUMENT_FILE_NAMES = {
  readme: "README.md",
  agents: "AGENTS.md",
  design: "DESIGN.md",
  fromCode: "FromCode.md"
};

export const LEGACY_WORKSPACE_DOCUMENT_FILE_NAMES = {
  readme: ["README.MD"],
  design: ["design.md"]
};



function normalizePlatformKey(value) {
  return value === "h3yun" ? "h3yun" : "cloudpivot";
}

function resolvePlatformLabel(input = {}) {
  const platformLabel = cleanInlineText(input.platformLabel);
  if (platformLabel) {
    return platformLabel;
  }

  return normalizePlatformKey(input.platformKey) === "h3yun" ? "氚云" : "云枢";
}

function appendOptionalLine(lines, label, value) {
  const normalizedValue = cleanInlineText(value);
  if (normalizedValue) {
    lines.push(`- ${label}：${normalizedValue}`);
  }
}

function buildBasicInfoLines(input = {}) {
  const lines = [
    `- 平台：${resolvePlatformLabel(input)}`,
    `- 页面类型：${cleanInlineText(input.pageLabel) || "未识别"}`
  ];

  appendOptionalLine(lines, "页面地址", input.pageUrl);
  appendOptionalLine(lines, "应用编码", input.appCode || input.applicationCode);
  appendOptionalLine(lines, "应用名称", input.appName || input.applicationName);
  appendOptionalLine(lines, "表单编码", input.formCode);
  appendOptionalLine(lines, "表单ID", input.formId);
  appendOptionalLine(lines, "表单名称", input.formName);
  appendOptionalLine(lines, "主表编码", input.mainTableCode);

  return lines;
}

function buildCodeFileLines(input = {}) {
  const codeFiles = Array.isArray(input.codeFiles)
    ? input.codeFiles.map(cleanInlineText).filter(Boolean)
    : [];

  if (!codeFiles.length) {
    return ["- 待 AI 根据 `README.md`、`FromCode.md` 和当前平台规则确认。"];
  }

  // 按文件类型分组：前端文件（JS/HTML/CSS）与服务端文件（Java/C#）
  const frontendFiles = [];
  const backendFiles = [];
  for (const fileName of codeFiles) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".java") || lower.endsWith(".cs")) {
      backendFiles.push(`- \`${fileName}\``);
    } else {
      frontendFiles.push(`- \`${fileName}\``);
    }
  }

  const lines = [];
  if (frontendFiles.length) {
    lines.push("**前端文件**", ...frontendFiles);
  }
  if (backendFiles.length) {
    if (lines.length) lines.push("");
    lines.push("**服务端文件**", ...backendFiles);
  }
  return lines.length ? lines : codeFiles.map((fileName) => `- \`${fileName}\``);
}

// 1.7.0 DESIGN.md 精简后，以下平台通信模型/业务实现逻辑/响应示例章节已从 DESIGN.md 移除。
// 这些内容由 AI 在 README + FromCode 上下文中按需补充，不再由插件模板预填。

function buildPlatformAgentsRules(input = {}) {
  if (normalizePlatformKey(input.platformKey) === "h3yun") {
    return [
      "- 氚云代码包含前端 `.js` 与后端 `.cs`；涉及跨端逻辑时必须同时检查两端。",
      "- 前端 JS 通过 Ajax 与后端 C# 互通，参数名、返回字段和错误信息必须在 `DESIGN.md` 中写清楚。",
      "- 只改前端展示且不需要服务端数据时，可以不改 C#，但要在 `DESIGN.md` 标注原因。"
    ];
  }

  return [
    "- 云枢代码包含前端 HTML/CSS/JS 和业务规则 Java；两类文件通过业务规则传参协作。",
    "- 云枢 JS 不写 Ajax 直连后端，需要服务端逻辑时先设计业务规则入参、返回值和异常提示。",
    "- 业务规则 Java 改动必须说明数据查询、写入、校验或状态流转原因。",
    " - 本文件夹下面的java代码都需要增加每次调用往本文件夹对应的表单写入一条日志数据。 ",
    "- java文件代码每次新增的java文件都是向DESIGN.md追加业务逻辑 ",
    "- 响应示例的编码都要加上中文名称注释 ",
    " - **Java 注释**：只写业务逻辑含义，禁止出现参见 DESIGN.md 某章节等跨文档引用。",
    "- **DESIGN.md**：按 Java 类或功能模块分章节组织，每个类/模块独立成节，避免所有实现逻辑杂糅在一起。"
  ];
}

// README.md 是用户需求入口；模板只提供填写结构，后续抓取不会覆盖用户写入内容。
export function buildWorkspaceReadmeContent(input = {}) {
  return "# 需求文档\n";
}


// AGENTS.md 约束当前目录的 AI 协作规则，帮助后续代理稳定识别文件职责和平台差异。
export function buildWorkspaceAgentsContent(input = {}) {
  return `${[
    "# 当前目录 Agent 规则",
    "",
    "## 文件职责",
    "",
    "- **README.md**：用户写业务需求，AI 只读不写。",
    "- **FromCode.md**：插件抓取字段/控件/表单编码，人工只补业务含义，AI 只读不写。",
    "- **DESIGN.md**：AI 根据 README + FromCode 自动生成和维护技术实现方案。",
    "- **AGENTS.md**：用户写本目录的 AI 执行规则和约束，AI 执行前必读。",
    "",
    "## 执行顺序",
    "",
    "0. 先读根目录的 `AGENTS.md`，确认根目录整个项目的 Agent 规则。",
    "1. 先读 `README.md`，确认用户业务需求和验收标准。",
    "2. 再读 `FromCode.md`，确认字段编码、控件名称、控件类型和表单上下文。",
    "3. 在 `DESIGN.md` 中整理实现方案、状态流转、参数传递、涉及文件和验证方式。",
    "4. 按本目录平台约束修改代码文件，避免改动无关文件。",
    "",
    "## 平台约束",
    "",
    ...buildPlatformAgentsRules(input),
    "",
    "## 注释与验证",
    "",
    "- 修改 JS、CSS、Java 或 C# 时补充有业务价值的中文注释，说明用途、关键变量、状态流转和外部调用原因。",
    "- 未实际执行验证时，不得声称已经通过；无法验证时在 `DESIGN.md` 或交付说明中写明原因。"

    
  ].join("\n")}\n`;
}

// DESIGN.md 是 AI 实现设计入口，精简为仅保留需求来源、基本信息（页面地址、应用编码、表单ID）、涉及代码文件。
// 1.7.0 精简：移除平台通信模型、业务实现逻辑、响应示例与调用实例等冗长节，这些由 AI 按需补充。
export function buildWorkspaceDesignContent(input = {}) {
  return `${[
    "# 实现设计",
    "",
    "> 文件用途：AI 根据 `README.md` 中的用户需求和 `FromCode.md` 中的编码上下文，生成并维护对应代码逻辑。插件只在文件缺失时创建本模板。",
    "",
    "## 需求来源",
    "",
    "- 用户需求：读取并引用 `README.md`。",
    "- 编码上下文：读取并引用 `FromCode.md`。",
    "",
    "## 基本信息",
    "",
    ...buildBasicInfoLines(input),
    "",
    "## 涉及代码文件",
    "",
    ...buildCodeFileLines(input)
  ].join("\n")}\n`;
}

/**
 * 按生成开关门控生成协作文件。
 *
 * **注意**：调用时务必传入 `options.generatedFiles`，否则所有协作文件都将被跳过。
 * generatedFiles 应从当前平台配置中获取（如 `currentConfig.generatedFiles[platformKey]`）。
 *
 * @param {object} input - 页面上下文（platformKey、pageLabel、pageUrl 等）
 * @param {object} state - 当前目录中已有文件状态
 * @param {object} options - 门控选项（若不传则所有协作文件默认不生成）
 * @param {object} options.generatedFiles - 平台生成开关（如 { readme: false, agents: false, design: false }）
 * @param {object} options.extraDocs - 本次写入一次性额外生成的协作文件（如 { readme: true }），不回写持久配置
 * @returns {Array<{fileName: string, content: string}>}
 */
export function buildMissingWorkspaceDocumentFiles(input = {}, state = {}, options = {}) {
  // extraDocs 仅作用于本次写入，不回写持久配置；允许用户临时勾选本次额外生成。
  const extraDocs = options.extraDocs || {};
  const generatedFiles = options.generatedFiles || {};

  const shouldGenerate = (key) => {
    // 1. 先看本次一次性覆写
    if (typeof extraDocs[key] === "boolean") {
      return extraDocs[key];
    }
    // 2. 持久开关（在 setting 中配置）
    if (typeof generatedFiles[key] === "boolean") {
      return generatedFiles[key];
    }
    // 3. 无配置时默认不生成协作文件（保持对老用户无影响）
    return false;
  };

  const files = [];
  if (!state.hasReadme && shouldGenerate("readme")) {
    files.push({
      fileName: WORKSPACE_DOCUMENT_FILE_NAMES.readme,
      content: buildWorkspaceReadmeContent(input)
    });
  }

  if (!state.hasAgents && shouldGenerate("agents")) {
    files.push({
      fileName: WORKSPACE_DOCUMENT_FILE_NAMES.agents,
      content: buildWorkspaceAgentsContent(input)
    });
  }

  if (!state.hasDesign && shouldGenerate("design")) {
    files.push({
      fileName: WORKSPACE_DOCUMENT_FILE_NAMES.design,
      content: buildWorkspaceDesignContent(input)
    });
  }

  return files.map((file) => ({
    fileName: file.fileName,
    content: `${cleanMultilineText(file.content)}\n`
  }));
}
