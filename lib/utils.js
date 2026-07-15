/**
 * 通用工具函数 —— 跨模块复用，避免各文件重复定义相同逻辑。
 * 所有函数均为纯函数，不依赖外部状态。
 */

/**
 * 清洗内联文本：合并空白字符为单个空格，去除首尾空白。
 * @param {*} value
 * @returns {string}
 */
export function cleanInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * 清洗多行文本：统一换行符为 \n，去除首尾空白。
 * @param {*} value
 * @returns {string}
 */
export function cleanMultilineText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

/**
 * 清洗路径字符串：去除首尾空白。
 * @param {*} value
 * @returns {string}
 */
export function normalizePath(value) {
  return String(value || "").trim();
}

/**
 * 清洗页面类型字符串，空值回退为 "default"。
 * @param {*} pageType
 * @returns {string}
 */
export function normalizePageType(pageType) {
  const normalized = String(pageType || "").trim();
  return normalized || "default";
}
