function cleanInlineText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlTags(value) {
  return cleanInlineText(String(value || "").replace(/<[^>]+>/g, " "));
}

function getAttributeValue(source, attributeName) {
  const pattern = new RegExp(`${attributeName}\\s*=\\s*["']([^"']*)["']`, "i");
  const match = String(source || "").match(pattern);
  return cleanInlineText(match?.[1] || "");
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

function extractControlsFromBlock(blockHtml) {
  const controls = [];
  const seenControls = new Set();
  const controlPattern = /<([a-z0-9-]+)\b([^>]*)>/gi;
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
        controls.push({ code, name });
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

  const titleMatch = html.match(/<a-title\b([^>]*)>([\s\S]*?)<\/a-title>/i);
  const formName = cleanInlineText(
    getAttributeValue(titleMatch?.[1] || "", "data-name") || stripHtmlTags(titleMatch?.[2] || "")
  );

  const subtables = [];
  const subtablePattern = /<a-sheet\b([^>]*)>([\s\S]*?)<\/a-sheet>/gi;
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
        controls: extractControlsFromBlock(body)
      });
    }
    subtableMatch = subtablePattern.exec(html);
  }

  const htmlWithoutSubtables = html.replace(subtablePattern, " ");
  const mainControls = extractControlsFromBlock(htmlWithoutSubtables);

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

function appendControlSection(lines, title, controls, includeCodes) {
  lines.push("", title);
  if (!controls.length) {
    lines.push("无");
    return;
  }

  for (const control of controls) {
    lines.push(`控件名称: ${cleanInlineText(control.name) || ""}`);
    if (includeCodes) {
      lines.push(`控件编码: ${control.code || ""}`);
    }
  }
}

function appendSubtableSection(lines, subtables, includeCodes) {
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
      lines.push(`控件名称: ${cleanInlineText(control.name) || ""}`);
      if (includeCodes) {
        lines.push(`控件编码: ${control.code || ""}`);
      }
    }
    lines.push("");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
}

function buildMetadataDocumentContent(metadata, pageTypeConfig, pageUrl, includeCodes) {
  const appCode = cleanInlineText(metadata?.applicationCode) || "";
  const appName = cleanInlineText(metadata?.applicationName) || "";
  const formCode = cleanInlineText(metadata?.formCode) || "";
  const formName = cleanInlineText(metadata?.formName) || "";
  const mainTableCode = cleanInlineText(metadata?.mainTableCode) || formCode;
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
  appendControlSection(lines, "主表控件", mainControls, includeCodes);
  appendSubtableSection(lines, subtables, includeCodes);

  return `${lines.join("\n")}\n`;
}

export function buildReadmeContent(metadata, pageTypeConfig, pageUrl) {
  // README.MD 只生成空白文件，控件名称、表名称等明细统一沉淀到 FromCode.md。
  return "";
}

export function buildFromCodeContent(metadata, pageTypeConfig, pageUrl) {
  // FromCode.md 承接原 README 中的编码类信息，方便排查表单和控件映射。
  return buildMetadataDocumentContent(metadata, pageTypeConfig, pageUrl, true);
}
