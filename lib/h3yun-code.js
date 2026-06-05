export const H3YUN_BACKEND_FALLBACK_FILE_NAME = "h3yun-backend.cs";
export const H3YUN_FRONTEND_FALLBACK_FILE_NAME = "h3yun-frontend.js";

const H3YUN_CSHARP_PATTERN = /using\s+System|namespace\s+\w+|public\s+class\s+\w+|H3\.SmartForm/;
const H3YUN_FRONTEND_PATTERN = /\/\*|\$\..*extend|function\s*\(|控件接口/;

function cleanInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripH3yunSheetCodePrefix(value) {
  // FromCode.md 面向用户核对字段编码，子表控件行只展示 F 字段编码；D 子表编码已在“子表编码”行单独输出。
  const normalizedValue = cleanInlineText(value);
  const match = normalizedValue.match(/^[A-Za-z0-9]+\.(F[A-Za-z0-9]+)$/);
  return match ? match[1] : normalizedValue;
}

function sanitizeCSharpFileBaseName(value) {
  return cleanInlineText(value).replace(/[<>:"/\\|?*]/g, "");
}

function safeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function snapshotSource(snapshot) {
  return String(snapshot?.sourceContent ?? snapshot?.content ?? snapshot?.value ?? "");
}

function snapshotLength(snapshot) {
  const explicitLength = Number(snapshot?.length);
  return Number.isFinite(explicitLength) ? explicitLength : snapshotSource(snapshot).length;
}

function compareModelSnapshots(left, right) {
  const priorityKeys = [
    "isContainerModel",
    "isAttached",
    "versionId",
    "alternativeVersionId",
    "index",
    "length"
  ];

  for (const key of priorityKeys) {
    const leftValue = safeNumber(left[key], key === "index" ? -1 : 0);
    const rightValue = safeNumber(right[key], key === "index" ? -1 : 0);
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

export function isH3yunCodeKindMatch(sourceContent, codeKind) {
  // 氚云 Monaco 未稳定提供 languageId，只能用源码特征区分前端 JS 与后端 C#。
  const snippet = String(sourceContent || "").substring(0, 2000);
  const isCSharp = H3YUN_CSHARP_PATTERN.test(snippet);
  if (codeKind === "frontend") {
    return !isCSharp && H3YUN_FRONTEND_PATTERN.test(snippet);
  }
  return isCSharp;
}

export function selectH3yunCodeModelSnapshot(snapshots = [], codeKind = "frontend") {
  // 多个 JS model 同时存在时，模板代码可能更长；优先选择挂载且版本更新的当前编辑 model。
  const candidates = snapshots
    .filter((snapshot) => isH3yunCodeKindMatch(snapshotSource(snapshot), codeKind))
    .map((snapshot) => ({
      ...snapshot,
      isContainerModel: snapshot?.isContainerModel ? 1 : 0,
      isAttached: snapshot?.isAttached ? 1 : 0,
      versionId: safeNumber(snapshot?.versionId),
      alternativeVersionId: safeNumber(snapshot?.alternativeVersionId),
      index: safeNumber(snapshot?.index, -1),
      length: snapshotLength(snapshot)
    }));

  if (!candidates.length) {
    return null;
  }

  return candidates.reduce((best, current) => (
    compareModelSnapshots(best, current) >= 0 ? best : current
  ));
}

export function extractH3yunCSharpClassName(sourceContent) {
  const source = String(sourceContent || "");
  const classMatch = source.match(/\b(?:public\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
  return classMatch ? classMatch[1] : "";
}

export function extractH3yunDesignerId(pageUrl) {
  try {
    const url = new URL(pageUrl);
    const searchId = cleanInlineText(url.searchParams.get("id"));
    if (searchId) {
      return searchId;
    }

    const hashQuery = url.hash.includes("?") ? url.hash.slice(url.hash.indexOf("?") + 1) : "";
    return cleanInlineText(new URLSearchParams(hashQuery).get("id"));
  } catch (_error) {
    return "";
  }
}

export function resolveH3yunBackendFileName(input = {}) {
  // 氚云后端文件优先跟随 C# 类名，页面还没加载源码时再回退到 URL 对象 ID，最后使用稳定兜底名。
  const fileBaseName =
    sanitizeCSharpFileBaseName(extractH3yunCSharpClassName(input.sourceContent))
    || sanitizeCSharpFileBaseName(extractH3yunDesignerId(input.pageUrl))
    || H3YUN_BACKEND_FALLBACK_FILE_NAME.replace(/\.cs$/i, "");

  return fileBaseName.toLowerCase().endsWith(".cs") ? fileBaseName : `${fileBaseName}.cs`;
}

export function resolveH3yunFrontendFileName(input = {}) {
  // 氚云前端 JS 没有稳定类名，优先使用表单对象 ID，便于和同表单的 C# 文件配对。
  const fileBaseName =
    sanitizeCSharpFileBaseName(extractH3yunDesignerId(input.pageUrl))
    || H3YUN_FRONTEND_FALLBACK_FILE_NAME.replace(/\.js$/i, "");

  return fileBaseName.toLowerCase().endsWith(".js") ? fileBaseName : `${fileBaseName}.js`;
}

export function buildH3yunFromCodeContent(metadata = {}) {
  const controls = Array.isArray(metadata.controls) ? metadata.controls : [];
  const lines = [
    `页面地址: ${cleanInlineText(metadata.pageUrl)}`,
    "平台: 氚云",
    `应用编码: ${cleanInlineText(metadata.appCode)}`,
    `表单ID: ${cleanInlineText(metadata.formId)}`,
    "",
    "主表控件"
  ];

  for (const control of controls) {
    lines.push(`控件名称: ${cleanInlineText(control.displayName)}`);
    lines.push(`控件编码: ${cleanInlineText(control.code)}`);
    lines.push(`控件类型: ${cleanInlineText(control.controlKey)}`);

    if (Array.isArray(control.children) && control.children.length) {
      const sheetCode = cleanInlineText(control.sheetCode) || cleanInlineText(control.code);
      lines.push("", "子表信息");
      lines.push(`子表名称: ${cleanInlineText(control.displayName)}`);
      lines.push(`子表编码: ${sheetCode}`);
      for (const child of control.children) {
        lines.push(`子表控件名称: ${cleanInlineText(child.displayName)}`);
        lines.push(`子表控件编码: ${stripH3yunSheetCodePrefix(child.code)}`);
        lines.push(`子表控件类型: ${cleanInlineText(child.controlKey)}`);
      }
    }

    lines.push("");
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
