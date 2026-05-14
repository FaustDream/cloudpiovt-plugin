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
  "网页抓取范围：使用代码默认范围，不在设置中额外配置",
  "读取策略：visible-first",
  "输出模式：codes-multi-file-export",
  "页面识别：form-design -> 表单在线开发，list-design -> 列表在线开发",
  "表单文件映射：html -> form-index.html，css -> form-style.css，javascript -> form-script.js",
  "列表文件映射：html -> list-index.html，css -> list-style.css，javascript -> list-script.js",
  "README 解析规则：页面地址中 model 后第一段是应用编码，下一段是表单编码，表单编码同时作为主表编码",
  "README HTML 规则：a-title 表示表单名称，只读取名称",
  "README HTML 规则：普通控件使用 data-name 作为控件名称，key 作为控件编码",
  "README HTML 规则：a-sheet 表示子表，key 作为子表编码，data-name 作为子表名称，子表内控件归属该子表",
  "打开方式：只支持 VS Code 和 IDEA",
  "README.MD：仅在抓取并写入时生成或更新"
];

export const DEFAULT_CONFIG = {
  vscodeExecutablePath: "",
  ideaExecutablePath: ""
};

function normalizePath(value) {
  return String(value || "").trim();
}

export async function loadConfig() {
  const stored = await chrome.storage.local.get(DEFAULT_CONFIG);
  return {
    vscodeExecutablePath: normalizePath(stored.vscodeExecutablePath),
    ideaExecutablePath: normalizePath(stored.ideaExecutablePath)
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
      : currentConfig.ideaExecutablePath
  };

  await chrome.storage.local.set(nextConfig);
  return nextConfig;
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
