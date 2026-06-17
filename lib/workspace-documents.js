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

/**
 * 生成 DESIGN.md 中"业务实现逻辑"子节，按文件类型（Java/氚云.C#）分节，
 * 避免前端和服务端逻辑杂糅在同一段数据中。
 */
function buildDesignBusinessLogicSections(input = {}) {
  const isH3yun = normalizePlatformKey(input.platformKey) === "h3yun";

  if (isH3yun) {
    return [
      "### 前端交互逻辑（JS）",
      "",
      "- 触发入口：",
      "- 参数来源：",
      "- 核心判断：",
      "- 数据处理：",
      "- Ajax 调用：",
      "- 返回结果：",
      "- 异常处理：",
      "",
      "### 后端服务逻辑（C#）",
      "",
      "- 触发入口：",
      "- 请求参数：",
      "- 核心判断：",
      "- 数据操作：",
      "- 返回结构：",
      "- 异常处理："
    ];
  }

  // 云枢：前端 JS/HTML/CSS + 服务端 Java 业务规则
  return [
    "### 前端交互逻辑（JS/HTML/CSS）",
    "",
    "- 触发入口：",
    "- 参数来源：",
    "- 核心判断：",
    "- 数据处理：",
    "- 返回结果：",
    "- 异常处理：",
    "",
    "### 服务端业务逻辑（Java）",
    "",
    "- 业务规则编码：",
    "- 入参说明：",
    "- 核心判断：",
    "- 数据查询/写入：",
    "- 校验逻辑：",
    "- 返回结构：",
    "- 异常处理：",
    "",
    "> 每个 Java 类的业务逻辑应独立成小节（### Java 类名），按类组织而非混写在一起。"
  ];
}

/**
 * 生成 DESIGN.md 中"响应示例与调用实例"子节，按平台区分 Ajax/业务规则调用方式，
 * 要求所有字段附带中文名称注释。
 */
function buildDesignExampleSections(input = {}) {
  const isH3yun = normalizePlatformKey(input.platformKey) === "h3yun";

  if (isH3yun) {
    return [
      "### 调用实例（前端 JS → 后端 C#）",
      "",
      "```js",
      "// Ajax 调用示例",
      "// TODO: 填写实际调用代码",
      "```",
      "",
      "**请求参数**：",
      "| 参数名 | 类型 | 必填 | 说明 |",
      "|--------|------|------|------|",
      "|  |  |  |  |",
      "",
      "### 响应示例（后端 C# → 前端 JS）",
      "",
      "```json",
      "{",
      "  // TODO: 填写实际返回 JSON，每个字段尾部加中文注释",
      "  \"fieldCode\": \"\"  // 字段中文名称",
      "}",
      "```",
      "",
      "**响应字段**：",
      "| 字段编码 | 类型 | 中文名称 | 说明 |",
      "|--------|------|----------|------|",
      "|  |  |  |  |"
    ];
  }

  // 云枢：前端 JS 通过业务规则传参调用服务端 Java
  return [
    "### 调用实例（前端 JS → 业务规则 → 服务端 Java）",
    "",
    "```js",
    "// 前端调用业务规则示例",
    "// TODO: 填写实际调用代码",
    "```",
    "",
    "**业务规则入参**：",
    "| 参数名 | 类型 | 必填 | 说明 |",
    "|--------|------|------|------|",
    "|  |  |  |  |",
    "",
    "### 响应示例（服务端 Java → 前端 JS）",
    "",
    "```json",
    "{",
    "  // TODO: 填写实际返回 JSON，每个字段尾部加中文注释",
    "  \"fieldCode\": \"\"  // 字段中文名称",
    "}",
    "```",
    "",
    "**响应字段**：",
    "| 字段编码 | 类型 | 中文名称 | 说明 |",
    "|--------|------|----------|------|",
    "|  |  |  |  |",
    "",
    "> 响应 JSON 中每个字段行尾必须使用 `// 中文名称` 标注业务含义，参数表也必须包含中文名称列。"
  ];
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
    "> 以下按文件类型分节，前端（JS/HTML/CSS）和服务端（Java/C#）逻辑各自独立，避免所有实现细节杂糅在同一个段落中。",
    "",
    ...buildDesignBusinessLogicSections(input),
    "",
    "## 响应示例与调用实例",
    "",
    "> 每个响应 JSON/对象的字段都必须附带中文名称注释，标注字段业务含义。",
    "",
    ...buildDesignExampleSections(input)
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
