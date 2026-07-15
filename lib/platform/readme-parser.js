import {
  formatControlTypeLabel,
  supportsAssociationMetadata,
  supportsCustomOptions
} from "./control-metadata.js";
import { buildMissingWorkspaceDocumentFiles } from "../services/workspace-documents.js";
import { cleanInlineText } from "../utils.js";

function stripHtmlTags(value) {
  return cleanInlineText(String(value || "").replace(/<[^>]+>/g, " "));
}

function getAttributeValue(source, attributeName) {
  const pattern = new RegExp(`(?:^|\\s)${attributeName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  const match = String(source || "").match(pattern);
  return cleanInlineText(match?.[2] || "");
}

// 统一挑选控件选项的中文展示名称，缺失中文时再回退到原始 value 或 code。
function normalizeOptionLabel(option) {
  const normalizedOption = option && typeof option === "object" ? option : {};
  return cleanInlineText(
    normalizedOption.name_i18n?.zh ||
    normalizedOption.value ||
    normalizedOption.label ||
    normalizedOption.code ||
    ""
  );
}

// 解析 data-options 中的自定义选项，仅处理当前已支持的选项类控件。
function extractControlOptions(tagName, attrs) {
  if (!supportsCustomOptions(tagName)) {
    return [];
  }

  const rawOptions = getAttributeValue(attrs, "data-options");
  if (!rawOptions) {
    return [];
  }

  try {
    // 下拉框、单选框的自定义选项会挂在 data-options.custom，文档中优先保留中文名称。
    const parsedOptions = JSON.parse(rawOptions.replace(/&quot;/g, "\""));
    if (parsedOptions?.optionsType !== "custom" || !Array.isArray(parsedOptions.custom)) {
      return [];
    }

    const seenLabels = new Set();
    return parsedOptions.custom.reduce((options, option) => {
      const label = normalizeOptionLabel(option);
      if (label && !seenLabels.has(label)) {
        seenLabels.add(label);
        options.push(label);
      }
      return options;
    }, []);
  } catch {
    return [];
  }
}

function extractAssociationMetadata(tagName, attrs) {
  if (!supportsAssociationMetadata(tagName)) {
    return {
      relationFormCode: "",
      relationFormName: ""
    };
  }

  return {
    relationFormCode: cleanInlineText(
      getAttributeValue(attrs, "data-schema-code") || getAttributeValue(attrs, "data-query-code")
    ),
    relationFormName: ""
  };
}

function buildMainControlScopeKey() {
  return "main";
}

function buildSubtableControlScopeKey(subtableCode) {
  return `subtable:${cleanInlineText(subtableCode) || ""}`;
}

function buildAssociationValueKey(scopeKey, controlCode) {
  return `${cleanInlineText(scopeKey) || buildMainControlScopeKey()}|${cleanInlineText(controlCode)}`;
}

export function parseModelCodesFromPageUrl(pageUrl) {
  const fallback = {
    applicationCode: "",
    formCode: ""
  };
  const normalized = String(pageUrl || "");
  if (!normalized) {
    return fallback;
  }

  const decoded = decodeURIComponent(normalized);
  const parts = decoded
    .split(/[/?#&=]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const modelIndex = parts.findIndex((item) => item.toLowerCase() === "model");
  if (modelIndex < 0) {
    return fallback;
  }

  return {
    applicationCode: parts[modelIndex + 1] || "",
    formCode: parts[modelIndex + 2] || ""
  };
}

function extractLinksFromHtml(htmlSource) {
  const links = [];
  const seenLinks = new Set();
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = linkPattern.exec(htmlSource);
  while (match) {
    const href = cleanInlineText(match[1]);
    if (href && !seenLinks.has(href)) {
      seenLinks.add(href);
      links.push({
        href,
        linkText: stripHtmlTags(match[2]),
        applicationCode: "",
        applicationName: "",
        formCode: "",
        formName: ""
      });
    }
    match = linkPattern.exec(htmlSource);
  }
  return links;
}

function extractControlsFromBlock(blockHtml, scopeKey = buildMainControlScopeKey()) {
  const controls = [];
  const seenControls = new Set();
  // 允许属性值中的 > 留在引号内部，避免 data-options 的 JSON 被提前截断。
  const controlPattern = /<([a-z0-9-]+)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi;
  let match = controlPattern.exec(blockHtml);
  while (match) {
    const tagName = String(match[1] || "").toLowerCase();
    if (tagName === "a-title" || tagName === "a-sheet" || tagName === "a-sheet-action") {
      match = controlPattern.exec(blockHtml);
      continue;
    }

    const attrs = match[2] || "";
    const code = getAttributeValue(attrs, "key");
    const name = getAttributeValue(attrs, "data-name");
    if (code && name) {
      const uniqueKey = `${code}|${name}`;
      if (!seenControls.has(uniqueKey)) {
        seenControls.add(uniqueKey);
        controls.push({
          code,
          name,
          scopeKey,
          tagName,
          typeLabel: formatControlTypeLabel(tagName),
          options: extractControlOptions(tagName, attrs),
          ...extractAssociationMetadata(tagName, attrs)
        });
      }
    }
    match = controlPattern.exec(blockHtml);
  }
  return controls;
}

export function extractReadmeMetadataFromHtml(htmlSource, pageUrl) {
  const html = String(htmlSource || "");
  const modelCodes = parseModelCodesFromPageUrl(pageUrl);
  const links = extractLinksFromHtml(html);

  const titleMatch = html.match(/<a-title\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a-title>/i);
  const formName = cleanInlineText(
    getAttributeValue(titleMatch?.[1] || "", "data-name") || stripHtmlTags(titleMatch?.[2] || "")
  );

  const subtables = [];
  const subtablePattern = /<a-sheet\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a-sheet>/gi;
  let subtableMatch = subtablePattern.exec(html);
  while (subtableMatch) {
    const attrs = subtableMatch[1] || "";
    const body = subtableMatch[2] || "";
    const code = getAttributeValue(attrs, "key");
    const name = getAttributeValue(attrs, "data-name") || code;
    if (code) {
      subtables.push({
        code,
        name,
        controls: extractControlsFromBlock(body, buildSubtableControlScopeKey(code))
      });
    }
    subtableMatch = subtablePattern.exec(html);
  }

  const htmlWithoutSubtables = html.replace(subtablePattern, " ");
  const mainControls = extractControlsFromBlock(htmlWithoutSubtables, buildMainControlScopeKey());

  return {
    applicationCode: modelCodes.applicationCode,
    applicationName: "",
    formCode: modelCodes.formCode,
    formName,
    mainTableCode: modelCodes.formCode,
    links,
    mainControls,
    subtables
  };
}

// 关联控件的手填信息需要跨多次抓取保留，因此在生成新文档前先从旧文档中回收。
function extractExistingAssociationValues(existingFromCodeContent) {
  const associationValues = new Map();
  let currentScopeKey = buildMainControlScopeKey();
  let currentControlCode = "";

  for (const rawLine of String(existingFromCodeContent || "").split(/\r?\n/)) {
    const line = String(rawLine || "");
    if (line === "主表控件") {
      currentScopeKey = buildMainControlScopeKey();
      currentControlCode = "";
      continue;
    }

    if (line === "子表信息") {
      currentScopeKey = "";
      currentControlCode = "";
      continue;
    }

    if (line.startsWith("子表编码: ")) {
      currentScopeKey = buildSubtableControlScopeKey(line.slice("子表编码: ".length));
      currentControlCode = "";
      continue;
    }

    if (line.startsWith("控件编码: ")) {
      currentControlCode = cleanInlineText(line.slice("控件编码: ".length));
      continue;
    }

    if (!currentControlCode) {
      continue;
    }

    if (line.startsWith("关联表单编码: ")) {
      const relationFormCode = cleanInlineText(line.slice("关联表单编码: ".length));
      const associationKey = buildAssociationValueKey(currentScopeKey, currentControlCode);
      const previousValue = associationValues.get(associationKey) || {};
      associationValues.set(associationKey, {
        ...previousValue,
        relationFormCode
      });
      continue;
    }

    if (line.startsWith("关联表单名称: ")) {
      const relationFormName = cleanInlineText(line.slice("关联表单名称: ".length));
      const associationKey = buildAssociationValueKey(currentScopeKey, currentControlCode);
      const previousValue = associationValues.get(associationKey) || {};
      associationValues.set(associationKey, {
        ...previousValue,
        relationFormName
      });
    }
  }

  return associationValues;
}

function resolveAssociationValues(control, existingAssociationValues) {
  const associationKey = buildAssociationValueKey(control.scopeKey, control.code);
  const existingValue = existingAssociationValues.get(associationKey) || {};
  return {
    relationFormCode: cleanInlineText(existingValue.relationFormCode) || cleanInlineText(control.relationFormCode),
    relationFormName: cleanInlineText(existingValue.relationFormName) || cleanInlineText(control.relationFormName)
  };
}

function appendControlLines(lines, control, includeCodes, existingAssociationValues) {
  lines.push(`控件名称: ${cleanInlineText(control.name) || ""}`);
  if (!includeCodes) {
    return;
  }

  lines.push(`控件编码: ${control.code || ""}`);
  lines.push(`控件类型: ${control.typeLabel || ""}`);
  if (Array.isArray(control.options) && control.options.length) {
    lines.push(`控件选项: ${control.options.join("、")}`);
  }

  if (supportsAssociationMetadata(control.tagName)) {
    const associationValues = resolveAssociationValues(control, existingAssociationValues);
    lines.push(`关联表单编码: ${associationValues.relationFormCode || ""}`);
    lines.push(`关联表单名称: ${associationValues.relationFormName || ""}`);
  }
}

function appendLinkSection(lines, links, includeCodes) {
  lines.push("全部链接");
  if (!links.length) {
    lines.push("无");
    return;
  }

  for (const link of links) {
    lines.push(`链接地址: ${link.href || ""}`);
    lines.push(`链接中文: ${cleanInlineText(link.linkText) || ""}`);
    if (includeCodes) {
      lines.push(`应用编码: ${link.applicationCode || ""}`);
      lines.push(`应用中文: ${cleanInlineText(link.applicationName) || ""}`);
      lines.push(`表单编码: ${link.formCode || ""}`);
      lines.push(`表单中文: ${cleanInlineText(link.formName) || ""}`);
    }
    lines.push("");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
}

function appendControlSection(lines, title, controls, includeCodes, existingAssociationValues) {
  lines.push("", title);
  if (!controls.length) {
    lines.push("无");
    return;
  }

  for (const control of controls) {
    appendControlLines(lines, control, includeCodes, existingAssociationValues);
  }
}

function appendSubtableSection(lines, subtables, includeCodes, existingAssociationValues) {
  lines.push("", "子表信息");
  if (!subtables.length) {
    lines.push("无");
    return;
  }

  for (const table of subtables) {
    lines.push(`子表名称: ${cleanInlineText(table.name) || ""}`);
    if (includeCodes) {
      lines.push(`子表编码: ${table.code || ""}`);
    }
    const controls = Array.isArray(table.controls) ? table.controls : [];
    if (!controls.length) {
      lines.push("无子表控件");
      continue;
    }
    for (const control of controls) {
      appendControlLines(lines, control, includeCodes, existingAssociationValues);
    }
    lines.push("");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
}

function buildMetadataDocumentContent(metadata, pageTypeConfig, pageUrl, includeCodes, existingFromCodeContent = "") {
  const appCode = cleanInlineText(metadata?.applicationCode) || "";
  const appName = cleanInlineText(metadata?.applicationName) || "";
  const formCode = cleanInlineText(metadata?.formCode) || "";
  const formName = cleanInlineText(metadata?.formName) || "";
  const mainTableCode = cleanInlineText(metadata?.mainTableCode) || formCode;
  const existingAssociationValues = extractExistingAssociationValues(existingFromCodeContent);
  const lines = [
    `页面类型: ${pageTypeConfig.pageLabel}`
  ];

  if (includeCodes) {
    lines.push(`页面地址: ${pageUrl || ""}`);
    lines.push(`应用编码: ${appCode}`, `应用中文: ${appName}`, `表单编码: ${formCode}`);
  }

  lines.push(`表单名称: ${formName}`);
  if (includeCodes) {
    lines.push(`主表编码: ${mainTableCode}`);
  }
  lines.push("");

  const links = Array.isArray(metadata?.links) ? metadata.links : [];
  const mainControls = Array.isArray(metadata?.mainControls) ? metadata.mainControls : [];
  const subtables = Array.isArray(metadata?.subtables) ? metadata.subtables : [];
  appendLinkSection(lines, links, includeCodes);
  appendControlSection(lines, "主表控件", mainControls, includeCodes, existingAssociationValues);
  appendSubtableSection(lines, subtables, includeCodes, existingAssociationValues);

  return `${lines.join("\n")}\n`;
}

export function buildReadmeContent(metadata, pageTypeConfig, pageUrl) {
  // README.md 现在是用户业务需求入口，保留函数兼容旧调用，实际写入由协作文件模板统一生成。
  return buildMissingWorkspaceDocumentFiles(
    buildCloudpivotWorkspaceDocumentInput(metadata, pageTypeConfig, pageUrl),
    { hasReadme: false, hasAgents: true, hasDesign: true }
  )[0]?.content || "";
}

export function buildFromCodeContent(metadata, pageTypeConfig, pageUrl, existingFromCodeContent = "") {
  // FromCode.md 承接原 README 中的编码类信息，方便排查表单和控件映射。
  return buildMetadataDocumentContent(metadata, pageTypeConfig, pageUrl, true, existingFromCodeContent);
}

function buildCloudpivotWorkspaceDocumentInput(metadata, pageTypeConfig, pageUrl) {
  // 云枢协作文件要同时说明前端文件和业务规则调用边界，避免 AI 误按 Ajax 模式生成代码。
  return {
    platformKey: pageTypeConfig?.platformKey,
    platformLabel: pageTypeConfig?.platformLabel,
    pageLabel: pageTypeConfig?.pageLabel,
    pageUrl,
    applicationCode: metadata?.applicationCode,
    applicationName: metadata?.applicationName,
    formCode: metadata?.formCode,
    formName: metadata?.formName,
    mainTableCode: metadata?.mainTableCode,
    codeFiles: [
      ...(Array.isArray(pageTypeConfig?.fileMappings)
        ? pageTypeConfig.fileMappings.map((item) => item.fileName)
        : []),
      "业务规则 .java 文件（通过业务规则抓取写入后生成）"
    ]
  };
}

export function buildReadmeWriteFiles(metadata, pageTypeConfig, pageUrl, options = {}) {
  const files = [];

  // FromCode.md 是编码上下文的唯一真源，始终生成（不受开关控制）。
  const shouldGenerateFromCode = options?.generatedFiles?.fromCode !== false;
  if (shouldGenerateFromCode) {
    files.push({
      fileName: "FromCode.md",
      content: buildFromCodeContent(metadata, pageTypeConfig, pageUrl, options?.existingFromCodeContent || "")
    });
  }

  // README.md / AGENTS.md / DESIGN.md 按 generatedFiles 开关 + extraDocs 一次性覆写门控，已有内容不覆盖。
  files.unshift(...buildMissingWorkspaceDocumentFiles(
    buildCloudpivotWorkspaceDocumentInput(metadata, pageTypeConfig, pageUrl),
    {
      hasReadme: Boolean(options?.hasReadme),
      hasAgents: Boolean(options?.hasAgents),
      hasDesign: Boolean(options?.hasDesign)
    },
    {
      generatedFiles: options?.generatedFiles || {},
      extraDocs: options?.extraDocs || {}
    }
  ));

  return files;
}
