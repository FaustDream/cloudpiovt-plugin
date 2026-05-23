import assert from "node:assert/strict";
import {
  BIZ_RULE_MISSING_FILE_TROUBLESHOOTING_NOTICE,
  BIZ_RULE_USAGE_NOTICE,
  buildBizRuleMissingFileDetails,
  buildBizRuleMultiModelDetails
} from "../lib/bizrule-constraints.js";

const multiModelDetails = buildBizRuleMultiModelDetails([
  "AlphaRule.java",
  "BetaRule.java",
  "AlphaRule.java"
]);
assert.deepEqual(
  multiModelDetails,
  [
    "当前页面检测到多个业务规则文件：AlphaRule.java、BetaRule.java",
    BIZ_RULE_USAGE_NOTICE
  ],
  "多业务规则冲突提示应去重并包含使用限制"
);

const missingFileDetails = buildBizRuleMissingFileDetails("GammaRule.java");
assert.deepEqual(
  missingFileDetails,
  [
    "目标目录中不存在文件：GammaRule.java",
    BIZ_RULE_MISSING_FILE_TROUBLESHOOTING_NOTICE
  ],
  "目录缺少业务规则文件时应补充排查提示"
);

console.log("bizrule constraint scenarios passed");
