export const DEFAULT_ALLOWED_ORIGINS = [];
export const DEFAULT_SELECTION_STRATEGY = "visible-first";
export const DEFAULT_OUTPUT_MODE = "codes-multi-file-export";

export const PLATFORM_CONFIG = {
  cloudpivot: {
    platformKey: "cloudpivot",
    platformLabel: "云枢"
  },
  h3yun: {
    platformKey: "h3yun",
    platformLabel: "氚云"
  }
};

export const PAGE_TYPE_CONFIG = {
  form: {
    ...PLATFORM_CONFIG.cloudpivot,
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
    ...PLATFORM_CONFIG.cloudpivot,
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
    ...PLATFORM_CONFIG.cloudpivot,
    pageType: "default",
    pageLabel: "默认页面",
    componentName: "editor",
    fileMappings: [
      { key: "html", fileName: "index.html" },
      { key: "css", fileName: "style.css" },
      { key: "javascript", fileName: "script.js" }
    ]
  },
  h3yunForm: {
    ...PLATFORM_CONFIG.h3yun,
    pageType: "h3yun-form",
    pageLabel: "氚云表单设计",
    componentName: "",
    fileMappings: []
  },
  h3yunDefault: {
    ...PLATFORM_CONFIG.h3yun,
    pageType: "h3yun-default",
    pageLabel: "氚云页面",
    componentName: "",
    fileMappings: []
  }
};

export const CLOUDPIVOT_READONLY_SETTINGS = [
  "前端抓取写入：按页面类型写入固定文件名（form-index.html / form-style.css / form-script.js 等）",
  "前端回写：将本地 HTML / CSS / JS 通过 data.codes 同步回在线编辑器",
  "业务规则抓取写入：通过 Monaco API 读取 Java 源码，按 model URI 或类名写入 .java 文件",
  "业务规则回写：同页多开业务规则时按同名 model 回写，单页仅支持一个业务规则编辑器",
  "页面类型：form-design → 表单在线开发，list-design → 列表在线开发，其余 → 默认页面",
  "文档同步：前端抓取会按需补建 README.MD / FromCode.md，回写不会覆盖说明文档",
  "目录规则：更新目标目录会同步当前页面快照和后续新页面默认值，旧页面保持原绑定",
  "原生助手：绝对路径历史、选择应用和一键打开编辑器依赖 Native Host；发布包内置自包含运行目录"
];

export const H3YUN_READONLY_SETTINGS = [
  "一键抓取写入：读取控件信息、#jsText 前端 JS、#csText 后端 C#，分别写入 FromCode.md、{表单ID}.js、C# 类名 .cs",
  "design.md：首次一键抓取时自动创建模板（基本信息+设计思路+任务），已存在时保留不覆盖",
  "前端代码回写：将本地 {表单ID}.js 通过 Monaco model API 回写到 #jsText",
  "后端代码回写：将本地 C# 类名 .cs 通过 Monaco model API 回写到 #csText",
  "模型匹配：氚云 Monaco model 语言 ID 为 undefined，先按内容正则区分 JS/C#，多 model 命中时按容器挂载、Monaco 版本号、创建顺序和长度评分，避免读到残留模板",
  "懒加载处理：图形区、前端或后端编辑器未挂载时，一键抓取会跳过缺失项并保留已抓到的文件",
  "目录规则：h3yun.com 使用独立页面类型和目录快照，不复用云枢 form-design 规则",
  "原生助手：绝对路径历史、选择应用和一键打开编辑器依赖 Native Host；发布包内置自包含运行目录"
];

export const READONLY_SETTINGS = [
  ...CLOUDPIVOT_READONLY_SETTINGS,
  ...H3YUN_READONLY_SETTINGS
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

export function resolvePlatformKey(pageUrl) {
  try {
    const hostname = new URL(pageUrl).hostname.toLowerCase();
    // 氚云页面的 hash 中也包含 form-design，必须先按域名切开平台，避免误命中云枢表单逻辑。
    if (hostname === "h3yun.com" || hostname.endsWith(".h3yun.com")) {
      return PLATFORM_CONFIG.h3yun.platformKey;
    }
  } catch (_error) {
    // 无法解析的页面继续沿用旧云枢兼容分支，避免扩展弹窗在 chrome:// 等页面初始化失败。
  }

  return PLATFORM_CONFIG.cloudpivot.platformKey;
}

export function resolvePageTypeConfig(pageUrl) {
  const normalizedUrl = String(pageUrl || "").toLowerCase();
  if (resolvePlatformKey(pageUrl) === PLATFORM_CONFIG.h3yun.platformKey) {
    if (normalizedUrl.includes("form-designer.html") || normalizedUrl.includes("form-design")) {
      return PAGE_TYPE_CONFIG.h3yunForm;
    }
    return PAGE_TYPE_CONFIG.h3yunDefault;
  }

  if (normalizedUrl.includes("list-design")) {
    return PAGE_TYPE_CONFIG.list;
  }
  if (normalizedUrl.includes("form-design")) {
    return PAGE_TYPE_CONFIG.form;
  }
  return PAGE_TYPE_CONFIG.default;
}
