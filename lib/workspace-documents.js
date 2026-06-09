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

function cleanInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanMultilineText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

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

  return codeFiles.map((fileName) => `- \`${fileName}\``);
}

function buildPlatformCommunicationLines(input = {}) {
  if (normalizePlatformKey(input.platformKey) === "h3yun") {
    return [
      "- 氚云前端 JS 和后端 C# 需要成对设计，前端通过 Ajax 向后端传参并接收返回值。",
      "- Ajax 调用必须明确请求参数、返回结构、失败提示和权限/数据校验责任。",
      "- 修改前端交互时同步检查后端 C# 是否需要新增或调整接口逻辑。"
    ];
  }

  return [
    "- 云枢前端 JS 与服务端业务规则通过业务规则传参协作。",
    "- 云枢 JS 不直接编写 Ajax 直连后端；需要服务端能力时，在业务规则中实现并由 JS 传参调用。",
    "- 业务规则负责服务端数据查询、写入、校验和状态流转，前端负责页面交互、参数收集和结果提示。"
  ];
}

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
    "- 业务规则 Java 改动必须说明数据查询、写入、校验或状态流转原因。"
  ];
}

// README.md 是用户需求入口；模板只提供填写结构，后续抓取不会覆盖用户写入内容。
export function buildWorkspaceReadmeContent(input = {}) {
  return `${[
    "# 业务需求",
    "",
    "> 文件用途：用户在这里填写业务背景、业务需求、字段规则、页面交互和验收标准。AI 生成或修改代码前必须先读取本文件，再结合 `FromCode.md` 与 `DESIGN.md` 工作。",
    "",
    "## 基本信息",
    "",
    ...buildBasicInfoLines(input),
    "",
    "## 业务背景",
    "",
    "- ",
    "",
    "## 业务逻辑",
    "",
    "- 触发时机：",
    "- 判断条件：",
    "- 处理动作：",
    "- 失败提示：",
    "",
    "## 字段说明",
    "",
    "- 字段编码和控件类型以 `FromCode.md` 为准，在这里补充业务含义。",
    "",
    "## 验收标准",
    "",
    "- [ ] "
  ].join("\n")}\n`;
}

// AGENTS.md 约束当前目录的 AI 协作规则，帮助后续代理稳定识别文件职责和平台差异。
export function buildWorkspaceAgentsContent(input = {}) {
  return `${[
    "# 当前目录 Agent 规则",
    "",
    "## 文件职责",
    "",
    "- `README.md`：用户维护业务需求的入口，AI 开发前必须先读取。",
    "- `DESIGN.md`：AI 根据 `README.md` 和 `FromCode.md` 维护详细业务实现逻辑、代码逻辑、涉及文件、参数传递和验证点。",
    "- `FromCode.md`：编码文件，由插件抓取刷新字段、控件、表单和页面编码；人工只补充明确业务含义或关联说明。",
    "- `AGENTS.md`：当前目录下的文件规范和 AI 执行规则。",
    "",
    "## 执行顺序",
    "",
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

// DESIGN.md 是 AI 实现设计入口，连接用户需求、编码上下文和实际代码文件。
export function buildWorkspaceDesignContent(input = {}) {
  return `${[
    "# 实现设计",
    "",
    "> 文件用途：AI 根据 `README.md` 中的用户需求和 `FromCode.md` 中的编码上下文，生成并维护对应代码逻辑、详细业务实现逻辑、涉及文件、参数传递和验证方式。插件只在文件缺失时创建本模板。",
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
    "## 平台通信模型",
    "",
    ...buildPlatformCommunicationLines(input),
    "",
    "## 涉及代码文件",
    "",
    ...buildCodeFileLines(input),
    "",
    "## 业务实现逻辑",
    "",
    "- 触发入口：",
    "- 参数来源：",
    "- 核心判断：",
    "- 数据处理：",
    "- 返回结果：",
    "- 异常处理：",
    "",
    "## 验证清单",
    "",
    "- [ ] 已核对 `README.md` 需求。",
    "- [ ] 已核对 `FromCode.md` 字段编码和控件类型。",
    "- [ ] 已验证关键交互、边界条件和失败提示。"
  ].join("\n")}\n`;
}

export function buildMissingWorkspaceDocumentFiles(input = {}, state = {}) {
  const files = [];
  if (!state.hasReadme) {
    files.push({
      fileName: WORKSPACE_DOCUMENT_FILE_NAMES.readme,
      content: buildWorkspaceReadmeContent(input)
    });
  }

  if (!state.hasAgents) {
    files.push({
      fileName: WORKSPACE_DOCUMENT_FILE_NAMES.agents,
      content: buildWorkspaceAgentsContent(input)
    });
  }

  if (!state.hasDesign) {
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
