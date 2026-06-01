# 开发助手平台标签实施计划
> 
**目标：** 将扩展从“云枢开发助手”调整为“开发助手”，把现有云枢能力收拢到“云枢”标签，并新增独立的“氚云”标签与页面探测入口。  
**设计：** 先在配置层加入平台识别，确保 `h3yun.com` 的 `form-design` 不再误走云枢表单逻辑；再在 popup 中加入平台标签，云枢标签承载现有抓取/回写，氚云标签只做独立页面探测和上下文复制，为后续适配沉淀依据。  
**技术栈：** Chrome MV3 原生扩展、ES Module、Chrome scripting/storage/nativeMessaging API、Node 内置 `assert` 测试。  
**注释计划：** 补充平台识别常量、`resolvePlatformKey`、云枢操作平台守卫、氚云页面探测函数的中文注释，说明业务边界、误判风险和失败影响。  
**文档同步：** 更新 `README.md`、`cloudpiovt-plugin/README.md`、`cloudpiovt-plugin/docs/architecture.md`、`cloudpiovt-plugin/docs/changelog-ai.md`，说明开发助手双平台入口、云枢既有能力和氚云探索阶段边界。  
---

### 任务 1：平台识别测试
**文件：**
- 创建：`cloudpiovt-plugin/tests/platform-config.test.mjs`
- 修改：无
- 测试：`cloudpiovt-plugin/tests/platform-config.test.mjs`
- 文档：无
- 注释：测试命名说明业务行为即可，无需额外注释
- [x] **第 1 步：编写失败测试**
```javascript
import assert from "node:assert/strict";
import { resolvePageTypeConfig, resolvePlatformKey } from "../lib/config.js";

const h3yunFormUrl = "https://www.h3yun.com/pc/form-designer.html#/form-design?appcode=D000772XTKFCS&id=D000772bdef015e8ca549ac9921b0ec1776682c&isBeta=true";
assert.equal(resolvePlatformKey(h3yunFormUrl), "h3yun", "氚云域名应识别为 h3yun 平台");
assert.equal(resolvePageTypeConfig(h3yunFormUrl).pageType, "h3yun-form", "氚云表单设计页应使用独立 pageType");

const cloudpivotFormUrl = "https://example.com/model/app001/form-design";
assert.equal(resolvePlatformKey(cloudpivotFormUrl), "cloudpivot", "非氚云页面继续保持云枢兼容平台");
assert.equal(resolvePageTypeConfig(cloudpivotFormUrl).pageType, "form", "云枢表单识别应保持旧 pageType，避免丢失已有目录配置");

console.log("platform config scenarios passed");
```
- [x] **第 2 步：运行测试以验证其失败**
运行命令：`node .\tests\platform-config.test.mjs`
预期结果：失败，提示 `resolvePlatformKey` 未导出或氚云 pageType 仍为 `form`。

### 任务 2：配置层平台拆分
**文件：**
- 修改：`cloudpiovt-plugin/lib/config.js`
- 测试：`cloudpiovt-plugin/tests/platform-config.test.mjs`
- 文档：无
- 注释：`PLATFORM_CONFIG`、`resolvePlatformKey`、`resolvePageTypeConfig` 中说明氚云和云枢 `form-design` 字符串冲突的原因
- [x] **第 1 步：编写最简实现**
```javascript
export const PLATFORM_CONFIG = {
  cloudpivot: { platformKey: "cloudpivot", platformLabel: "云枢" },
  h3yun: { platformKey: "h3yun", platformLabel: "氚云" }
};

export function resolvePlatformKey(pageUrl) {
  try {
    const hostname = new URL(pageUrl).hostname.toLowerCase();
    return hostname === "h3yun.com" || hostname.endsWith(".h3yun.com")
      ? PLATFORM_CONFIG.h3yun.platformKey
      : PLATFORM_CONFIG.cloudpivot.platformKey;
  } catch (_error) {
    return PLATFORM_CONFIG.cloudpivot.platformKey;
  }
}
```
- [x] **第 2 步：运行测试以验证通过**
运行命令：`node .\tests\platform-config.test.mjs`
预期结果：输出 `platform config scenarios passed`。

### 任务 3：Popup 标签与氚云探测入口
**文件：**
- 修改：`cloudpiovt-plugin/popup.html`
- 修改：`cloudpiovt-plugin/popup.css`
- 修改：`cloudpiovt-plugin/popup.js`
- 测试：手工静态检查和最终扩展构建检查
- 文档：无
- 注释：`assertCloudpivotOperation`、`h3yunProbeMain`、`formatH3yunProbeResult` 需要中文注释说明平台边界、探测字段来源和失败影响
- [x] **第 1 步：调整 HTML**
将标题改为“开发助手”，新增“云枢 / 氚云”标签按钮；把现有云枢操作按钮包进 `cloudpivot` 面板；新增氚云面板，放置“页面探测”和“复制上下文”按钮。
- [x] **第 2 步：调整 CSS**
新增平台标签、面板、氚云状态卡样式，并保持弹窗宽度和现有卡片风格一致。
- [x] **第 3 步：调整 JS**
新增平台标签切换、云枢操作守卫、氚云页面探测、探测结果复制；初始化时按当前页面平台自动切换标签。
- [x] **第 4 步：静态验证**
运行命令：`node --check .\popup.js`
预期结果：无语法错误。

### 任务 4：品牌与设置页文案
**文件：**
- 修改：`cloudpiovt-plugin/manifest.json`
- 修改：`cloudpiovt-plugin/options.html`
- 修改：`cloudpiovt-plugin/lib/config.js`
- 测试：静态 JSON / JS 检查
- 文档：无
- 注释：`READONLY_SETTINGS` 中加入平台识别与氚云探索阶段说明
- [x] **第 1 步：更新 manifest**
将 `name`、`short_name`、`action.default_title` 改为“开发助手”，描述改为同时覆盖云枢和氚云。
- [x] **第 2 步：更新设置页标题**
将页面标题和主标题改为“开发助手”，保留 CloudPiOvt 历史目录名不改动。
- [x] **第 3 步：运行静态检查**
运行命令：`node --check .\options.js`
预期结果：无语法错误。

### 任务 5：文档同步与最终验证
**文件：**
- 修改：`README.md`
- 修改：`cloudpiovt-plugin/README.md`
- 修改：`cloudpiovt-plugin/docs/architecture.md`
- 修改：`cloudpiovt-plugin/docs/changelog-ai.md`
- 测试：全部现有 Node 测试
- 文档：上述四个文档
- 注释：无代码注释
- [x] **第 1 步：同步使用说明和架构说明**
说明“开发助手”下有云枢和氚云两个标签，云枢承载原抓取/回写，氚云当前提供页面探测和上下文复制。
- [x] **第 2 步：运行全部测试**
运行命令：`node .\tests\readme-parser.test.mjs; node .\tests\bizrule-constraints.test.mjs; node .\tests\recent-target-directories.test.mjs; node .\tests\platform-config.test.mjs`
预期结果：四个测试均输出对应 `scenarios passed`。
- [x] **第 3 步：检查工作区**
运行命令：`git status --short`
预期结果：只出现本次任务相关文件。

### 任务 6：氚云后端代码文件名解析
**文件：**
- 创建：`cloudpiovt-plugin/lib/h3yun-code.js`
- 创建：`cloudpiovt-plugin/tests/h3yun-code.test.mjs`
- 测试：`cloudpiovt-plugin/tests/h3yun-code.test.mjs`
- 文档：无
- 注释：`resolveH3yunBackendFileName` 需要说明氚云后端源码、URL `id` 与兜底文件名的优先级
- [x] **第 1 步：编写失败测试**
```javascript
import assert from "node:assert/strict";
import { resolveH3yunBackendFileName } from "../lib/h3yun-code.js";

const pageUrl = "https://www.h3yun.com/pc/form-designer.html#/form-design?appcode=D000772XTKFCS&id=D000772bdef015e8ca549ac9921b0ec1776682c&isBeta=true";
const source = "public class D000772bdef015e8ca549ac9921b0ec1776682c: H3.SmartForm.SmartFormController {}";

assert.equal(resolveH3yunBackendFileName({ sourceContent: source, pageUrl }), "D000772bdef015e8ca549ac9921b0ec1776682c.cs");
assert.equal(resolveH3yunBackendFileName({ sourceContent: "", pageUrl }), "D000772bdef015e8ca549ac9921b0ec1776682c.cs");
assert.equal(resolveH3yunBackendFileName({ sourceContent: "", pageUrl: "https://www.h3yun.com/pc/form-designer.html" }), "h3yun-backend.cs");

console.log("h3yun code scenarios passed");
```
- [x] **第 2 步：运行测试以验证其失败**
运行命令：`node .\tests\h3yun-code.test.mjs`
预期结果：失败，提示 `lib/h3yun-code.js` 不存在。
- [x] **第 3 步：实现解析模块**
新增 `extractH3yunCSharpClassName`、`extractH3yunDesignerId`、`resolveH3yunBackendFileName`。
- [x] **第 4 步：运行测试以验证通过**
运行命令：`node .\tests\h3yun-code.test.mjs`
预期结果：输出 `h3yun code scenarios passed`。

### 任务 7：氚云后端代码抓取与回写
**文件：**
- 修改：`cloudpiovt-plugin/popup.html`
- 修改：`cloudpiovt-plugin/popup.js`
- 修改：`cloudpiovt-plugin/popup.css`
- 测试：`node --check .\popup.js`
- 文档：`cloudpiovt-plugin/docs/architecture.md` / `cloudpiovt-plugin/docs/changelog-ai.md`
- 注释：`handleH3yunBackendCaptureAndWrite`、`handleH3yunBackendWriteback`、`h3yunBackendProbeMain`、`h3yunBackendWritebackMain` 必须说明 `#CsCodeZone/#csText`、Monaco C# model 和失败影响
- [x] **第 1 步：更新氚云面板按钮**
新增“后端代码抓取写入”和“后端代码回写”按钮，保留“页面探测”和“复制上下文”。
- [x] **第 2 步：实现后端抓取**
通过 `chrome.scripting.executeScript` 注入 `h3yunBackendProbeMain`，优先读取 `#csText` 内 Monaco editor 的 model 内容，解析文件名后写入 `.cs` 文件。
- [x] **第 3 步：实现后端回写**
先探测当前页面对应 `.cs` 文件名，再从目标目录读取内容，调用页面内 Monaco `setValue` 回写。
- [x] **第 4 步：运行静态检查**
运行命令：`node --check .\popup.js`
预期结果：无语法错误。

### 任务 8：文档同步与最终验证补充
**文件：**
- 修改：`README.md`
- 修改：`cloudpiovt-plugin/README.md`
- 修改：`cloudpiovt-plugin/docs/architecture.md`
- 修改：`cloudpiovt-plugin/docs/changelog-ai.md`
- 测试：全部 Node 测试与语法检查
- 文档：上述四个文档
- 注释：无代码注释
- [x] **第 1 步：同步氚云后端说明**
说明氚云后端代码基于 `#CsCodeZone/#csText` 和 Monaco C# model，文件名优先取 C# 类名，其次取 URL `id`。
- [x] **第 2 步：运行全部验证**
运行命令：`node .\tests\readme-parser.test.mjs; node .\tests\bizrule-constraints.test.mjs; node .\tests\recent-target-directories.test.mjs; node .\tests\platform-config.test.mjs; node .\tests\h3yun-code.test.mjs`
预期结果：五个测试均输出对应 `scenarios passed`。
- [x] **第 3 步：检查语法和 diff**
运行命令：`node --check .\popup.js; node --check .\options.js; node --check .\background.js; node --check .\lib\config.js; node --check .\lib\h3yun-code.js; git diff --check`
预期结果：语法检查与 diff 检查均通过。
