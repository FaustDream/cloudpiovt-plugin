import assert from "node:assert/strict";
import { resolvePageTypeConfig, resolvePlatformKey } from "../lib/config.js";

const h3yunFormUrl = "https://www.h3yun.com/pc/form-designer.html#/form-design?appcode=D000772XTKFCS&id=D000772bdef015e8ca549ac9921b0ec1776682c&isBeta=true";
const h3yunConfig = resolvePageTypeConfig(h3yunFormUrl);

assert.equal(resolvePlatformKey(h3yunFormUrl), "h3yun", "氚云域名应识别为 h3yun 平台");
assert.equal(h3yunConfig.platformKey, "h3yun", "氚云页面配置应带平台标识");
assert.equal(h3yunConfig.platformLabel, "氚云", "氚云页面配置应带中文平台名称");
assert.equal(h3yunConfig.pageType, "h3yun-form", "氚云表单设计页应使用独立 pageType");
assert.equal(h3yunConfig.pageLabel, "氚云表单设计", "氚云表单设计页应使用独立页面标签");

const cloudpivotFormUrl = "https://example.com/model/app001/form-design";
const cloudpivotConfig = resolvePageTypeConfig(cloudpivotFormUrl);

assert.equal(resolvePlatformKey(cloudpivotFormUrl), "cloudpivot", "非氚云页面继续保持云枢兼容平台");
assert.equal(cloudpivotConfig.platformKey, "cloudpivot", "云枢页面配置应带平台标识");
assert.equal(cloudpivotConfig.platformLabel, "云枢", "云枢页面配置应带中文平台名称");
assert.equal(cloudpivotConfig.pageType, "form", "云枢表单识别应保持旧 pageType，避免丢失已有目录配置");

console.log("platform config scenarios passed");
