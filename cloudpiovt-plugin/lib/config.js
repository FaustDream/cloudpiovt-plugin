import {
  BIZ_RULE_MISSING_FILE_TROUBLESHOOTING_NOTICE,
  BIZ_RULE_USAGE_NOTICE
} from "./bizrule-constraints.js";

export const DEFAULT_ALLOWED_ORIGINS = [];
export const DEFAULT_SELECTION_STRATEGY = "visible-first";
export const DEFAULT_OUTPUT_MODE = "codes-multi-file-export";

export const PAGE_TYPE_CONFIG = {
  form: {
    pageType: "form",
    pageLabel: "表单在线开发",
    componentName: "editor",
    fileMappings: [
      { key: "html", fileName: "form-index.html" },
      { key: "css", fileName: "form-style.css" },
      { key: "javascript", fileName: "form-script.js" }
    ]
  },
  list: {
    pageType: "list",
    pageLabel: "列表在线开发",
    componentName: "ListEditor",
    fileMappings: [
      { key: "html", fileName: "list-index.html" },
      { key: "css", fileName: "list-style.css" },
      { key: "javascript", fileName: "list-script.js" }
    ]
  },
  default: {
    pageType: "default",
    pageLabel: "默认页面",
    componentName: "editor",
    fileMappings: [
      { key: "html", fileName: "index.html" },
      { key: "css", fileName: "style.css" },
      { key: "javascript", fileName: "script.js" }
    ]
  }
};

export const READONLY_SETTINGS = [
  "网页抓取范围：使用代码内置范围，不在设置页额外开放选择器开关",
  "读取策略：visible-first，默认优先命中当前可见编辑区域",
  "输出模式：codes-multi-file-export，前端代码会按页面类型拆分写入固定文件名",
  "页面识别：form-design -> 表单在线开发，list-design -> 列表在线开发，其余页面走默认类型",
  "目标目录：点击“更新目标目录”后会同步更新当前页面快照和后续新页面默认值，旧页面快照不会被自动覆盖",
  "最近路径：只记录 Native Host 返回的绝对路径；点击历史路径会复用当前目录保存流程，移除历史不会清空当前绑定",
  "表单文件映射：html -> form-index.html，css -> form-style.css，javascript -> form-script.js",
  "列表文件映射：html -> list-index.html，css -> list-style.css，javascript -> list-script.js",
  "业务规则文件：抓取时按 Monaco model URI 或 Java 类名解析 .java 文件名，回写时优先匹配同名 model",
  BIZ_RULE_USAGE_NOTICE,
  BIZ_RULE_MISSING_FILE_TROUBLESHOOTING_NOTICE,
  "FromCode 解析规则：页面地址中 model 后第一段是应用编码，下一段是表单编码，表单编码同时作为主表编码",
  "文档 HTML 规则：a-title 表示表单名称，只读取名称；普通控件使用 data-name 和 key；a-sheet 表示子表并归组控件；四类选项控件会从 data-options.custom 提取中文控件选项；关联控件会额外保留关联表单信息",
  "控件类型参考：设置页会展示 HTML 标签、中文控件类型和示例字段名，便于核对 FromCode.md 中的控件类型输出",
  "打开方式：只支持 VS Code 和 IDEA；点击弹窗顶部按钮时会直接打开当前页面绑定的目标目录",
  "README.MD / FromCode.md：README.MD 会在前端抓取写入时按需补建，存在时保留人工内容；FromCode.md 会在每次前端抓取写入时同步更新，前端回写与业务规则回写不会改动文档"
];

export const DEFAULT_CONFIG = {
  vscodeExecutablePath: "",
  ideaExecutablePath: "",
  targetDirectoryPaths: {}
};

function normalizePath(value) {
  return String(value || "").trim();
}

function normalizePageType(pageType) {
  const normalized = String(pageType || "").trim();
  return normalized || "default";
}

function normalizeTargetDirectoryPaths(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((result, [pageType, directoryPath]) => {
    const normalizedPath = normalizePath(directoryPath);
    if (normalizedPath) {
      result[normalizePageType(pageType)] = normalizedPath;
    }
    return result;
  }, {});
}

export async function loadConfig() {
  const stored = await chrome.storage.local.get(DEFAULT_CONFIG);
  return {
    vscodeExecutablePath: normalizePath(stored.vscodeExecutablePath),
    ideaExecutablePath: normalizePath(stored.ideaExecutablePath),
    targetDirectoryPaths: normalizeTargetDirectoryPaths(stored.targetDirectoryPaths)
  };
}

export async function saveConfig(partialConfig) {
  const currentConfig = await loadConfig();
  const nextConfig = {
    vscodeExecutablePath: Object.prototype.hasOwnProperty.call(partialConfig, "vscodeExecutablePath")
      ? normalizePath(partialConfig.vscodeExecutablePath)
      : currentConfig.vscodeExecutablePath,
    ideaExecutablePath: Object.prototype.hasOwnProperty.call(partialConfig, "ideaExecutablePath")
      ? normalizePath(partialConfig.ideaExecutablePath)
      : currentConfig.ideaExecutablePath,
    targetDirectoryPaths: Object.prototype.hasOwnProperty.call(partialConfig, "targetDirectoryPaths")
      ? normalizeTargetDirectoryPaths(partialConfig.targetDirectoryPaths)
      : currentConfig.targetDirectoryPaths
  };

  await chrome.storage.local.set(nextConfig);
  return nextConfig;
}

export function getTargetDirectoryPathByPageType(config, pageType) {
  return normalizePath(
    config?.targetDirectoryPaths?.[normalizePageType(pageType)]
  );
}

export async function saveTargetDirectoryPathByPageType(pageType, targetDirectoryPath) {
  const config = await loadConfig();
  const targetDirectoryPaths = {
    ...config.targetDirectoryPaths
  };
  const normalizedPageType = normalizePageType(pageType);
  const normalizedPath = normalizePath(targetDirectoryPath);

  if (normalizedPath) {
    targetDirectoryPaths[normalizedPageType] = normalizedPath;
  } else {
    delete targetDirectoryPaths[normalizedPageType];
  }

  const nextConfig = await saveConfig({ targetDirectoryPaths });
  return getTargetDirectoryPathByPageType(nextConfig, normalizedPageType);
}

export function isOriginAllowed(pageUrl, allowedOrigins = DEFAULT_ALLOWED_ORIGINS) {
  try {
    const origin = new URL(pageUrl).origin;
    return !allowedOrigins.length || allowedOrigins.includes(origin);
  } catch (_error) {
    return false;
  }
}

export function resolvePageTypeConfig(pageUrl) {
  const normalizedUrl = String(pageUrl || "").toLowerCase();
  if (normalizedUrl.includes("list-design")) {
    return PAGE_TYPE_CONFIG.list;
  }
  if (normalizedUrl.includes("form-design")) {
    return PAGE_TYPE_CONFIG.form;
  }
  return PAGE_TYPE_CONFIG.default;
}
