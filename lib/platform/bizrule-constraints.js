// 业务规则抓取与回写依赖页面内只保留一个有效业务规则编辑器，多开会让文件名匹配失真。
export const BIZ_RULE_USAGE_NOTICE =
  "业务规则限制：同一页面同时只支持一个业务规则编辑器；若同时打开了多个不同表单或多个业务规则，请先关闭多余业务规则后再抓取或回写。";

// “当前文件夹没有这个 java 文件” 往往不是目录真缺文件，而是页面命中了别的业务规则 model。
export const BIZ_RULE_MISSING_FILE_TROUBLESHOOTING_NOTICE =
  "若日志提示当前文件夹没有对应的 .java 文件，请检查当前页面是否同时打开了多个不同表单或多个业务规则，导致本次操作命中了非预期业务规则。";

function normalizeFileNames(fileNames) {
  if (!Array.isArray(fileNames)) {
    return [];
  }

  return Array.from(
    new Set(
      fileNames
        .map((fileName) => String(fileName || "").trim())
        .filter(Boolean)
    )
  );
}

export function buildBizRuleMultiModelDetails(fileNames = []) {
  const normalizedFileNames = normalizeFileNames(fileNames);
  const summary = normalizedFileNames.length
    ? `当前页面检测到多个业务规则文件：${normalizedFileNames.join("、")}`
    : "当前页面检测到多个业务规则 Monaco model";

  return [summary, BIZ_RULE_USAGE_NOTICE];
}

export function buildBizRuleMissingFileDetails(fileName = "") {
  const normalizedFileName = String(fileName || "").trim();
  const summary = normalizedFileName
    ? `目标目录中不存在文件：${normalizedFileName}`
    : "目标目录中不存在待回写的 .java 文件";

  return [summary, BIZ_RULE_MISSING_FILE_TROUBLESHOOTING_NOTICE];
}
