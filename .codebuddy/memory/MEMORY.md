# 项目记忆

## 项目概述

开发助手（Chrome MV3 扩展），为云枢和氚云开发页面提供本地协作能力。

## 平台隔离

- **云枢**：前端 HTML/CSS/JS 抓取写入/回写，业务规则（Java/Monaco）抓取写入/回写
- **氚云**：页面探测、控件信息读取、前端 JS/后端 C# 代码抓取写入/回写
- 两个平台的代码路径在 `popup.js` 中完全隔离，通过 `PLATFORM_CONFIG` 和平台标签切换

## 自动更新机制

- Native Host (`cloudpiovt_native_host.exe`) 新增 `git_sync` 命令，从 exe 路径定位扩展根目录（exe 在 `.native-host/publish/`，往上 3 级即仓库根目录）
- 检查 `.git` 是否存在 → `git fetch origin` → 对比本地与 `origin/master:manifest.json` 的 version 字段（三段式 semver）
- 自动检查（`chrome.alarms` 每日触发）仅 fetch + 比较，不动本地文件
- 用户点击「同步更新」按钮时执行 `git reset --hard origin/master` 强制同步，之后需在 `chrome://extensions` 重新加载
- `autoCheckUpdates` 默认 `false`，不再依赖 `update.json` 或 GitHub raw 文件

## 氚云控件信息获取方式

- **主路径（allControls）**：通过 `document.querySelector(".designer.web").__vue__.allControls` 读取设计器全局状态，获取所有控件的完整元数据（DisplayName、ControlKey、DefaultItems、DisplayRule、DefaultValue、DataField/编码、type、BOSchemaCode）。该方式直接读取设计器状态，不受 DOM 懒加载影响，编码最完整，但字段按编码顺序排序（非表单控件顺序）
- **兜底路径（DOM 扫描）**：通过 `.designer.web [data-code]` 扫描 DOM 元素的 `data-code`、`data-controlkey`、`data-displayname` 等属性，结合 Vue 状态遍历和编码目录回填。适用于 allControls 不可用的情况
- **FromCode 输出字段**：控件名称、控件编码、控件类型、默认值、关联表单、隐藏规则（始终输出，空值也保留行）、选项值（含子表控件的子字段输出）

- **主路径**：Monaco API（`window.monaco.editor.getEditors()` / `getModels()`）
- **兜底路径**：`.view-lines .view-line` DOM 读取（2026-05-29 新增）
- 兜底限制：受 Monaco 虚拟滚动影响，大文件只能读取视口内行

## 子表控件编码缺失诊断

- 当氚云一键抓取遇到子表控件编码缺失时，自动捕获 DOM/Vue 状态快照注入诊断包
- 快照包含：`sheetFieldCatalog` 全局编码目录、`[data-sheet='true']` 容器的 DOM 结构、每个 `.sheet-control` 的属性和 Vue 状态 key
- 诊断 JSON 新增 `designerDomSnapshot` 字段（通常为 null，仅缺失时注入）
- 用户可通过「导出诊断 JSON」按钮导出后分析根因

## 技术栈

- 原生 JS（ES Module），非 WXT/React/TypeScript
- Native Messaging 与本地 .NET 程序通信
- IndexedDB 存储 File System Access 目录句柄
- chrome.storage.local 存储配置和历史

## 平台默认目录兜底 (1.5.0)

- 配置 key: `fallbackDirectoryPaths: { cloudpivot: string, h3yun: string }`
- 设置页「默认目录」区块，平台标签切换，每个平台有文本输入 + 「选择目录」按钮
- 兜底链路：`getStoredTargetDirectorySelection` 和 `ensureTargetDirectorySnapshot` 在所有现有目录源为空时，根据 pageType（以 "h3yun" 开头则为氚云，否则云枢）读取对应平台的 `fallbackDirectoryPaths`
- 兜底为自动透明，不持久化到 scope 快照，用户可随时点刷新按钮重选

## 1.7.0 综合重构 (2026-07-14)

### 文件生成按平台配置化
- `lib/config.js` 新增 `DEFAULT_GENERATED_FILES`（按平台定义开关：云枢=fromCode+css+js+html，氚云=fromCode+js+cs；readme/agents/design 默认关闭）
- `lib/config.js` 新增 `resolveH3yunDesignMode(pageTypeConfig)` 判断列表/表单模式
- `lib/config.js` 新增 `h3yunOneClickWriteback` 开关（默认 true）
- `loadConfig/saveConfig` 增加 `generatedFiles` 和 `h3yunOneClickWriteback` 的 normalize 和持久化
- `PAGE_TYPE_CONFIG` 新增 `h3yunList`（`resolvePageTypeConfig` 优先匹配 `list-designer.html`/`list-design`）
- `lib/workspace-documents.js` `buildWorkspaceDesignContent` 精简为仅保留"需求来源""基本信息""涉及代码文件"三节
- `buildMissingWorkspaceDocumentFiles` 新增 `{generatedFiles, extraDocs}` 门控参数
- `lib/h3yun-code.js` `resolveH3yunFrontendFileName`/`resolveH3yunBackendFileName` 增加 `designMode` → `-list` 后缀
- `lib/readme-parser.js` `buildReadmeWriteFiles` 传递 `generatedFiles`/`extraDocs`

### Popup 重构
- 平台标签自动识别后隐藏（`platform-tabs.is-hidden`），unknown/default 时显示
- 状态栏：空态压缩到约 28px 一行灰色；成功单行绿色条；失败展开红色日志区
- "导出日志""导出诊断"合并为"导出 ▾"下拉按钮
- 当前路径展示真实值 + 📋 复制图标
- 历史目录平铺展示前 3 条（圆点+路径+✕），超出显示"更多 (N个)"按钮
- 操作按钮改为 ⬇抓取 / ⬆回写 图标+文字
- 新增写入前「选择生成文件」弹层（readme/agents/design 复选框，仅本次生效）
- 氚云列表设计模式跳过图形控件生成逻辑
- 新增氚云一键回写按钮（顺序执行前端+后端回写）

### Options 重构
- 主标签 5→4：应用路径/默认目录/更新设置（移除运行日志和说明中心标签）
- 右上角「? 帮助」按钮 → 右侧滑出抽屉（控件参考/推荐流程/版本更新）
- 运行日志合并到更新设置底部折叠面板
- 980px 单栏 → 双栏 Grid：左栏 60% 设置表单，右栏 40% 状态/帮助/快捷入口
- 新增按平台文件生成开关（`genfiles-grid` 渲染）和氚云一键回写开关

### 跨页面历史目录同步
- `popup.js` 初始化时 `setupCrossPageSync()` 注册 `chrome.tabs.onActivated` 监听器
- 弹窗关闭时 `teardownCrossPageSync()` 移除监听器避免泄漏
- 每次选择/更新目录调用 `addRecentTargetDirectory` 即时落库

## 测试体系 (2026-07-14)

- 测试框架：Vitest + @vitest/coverage-v8
- 运行命令：`npm run test:all`（全量编排）或 `npm test`（仅 vitest）
- 测试分层：L0（静态分析）→ L1（单元）→ L2（功能）→ L3（回归）→ L4（边界值）→ L5（安全）→ L6（环境）→ L7（覆盖率）
- **目录约束**：所有测试相关文件统一放在 `tests/` 目录下（含测试用例、vitest.config.js、测试脚本、报告、覆盖率），`tests/` 整体 Git 忽略
- 报告输出：`tests/docs/` 下 10 份独立 Markdown 报告（01-unit-tests.md ~ 10-summary.md）
- `control-metadata.js` 使用云枢标签名体系（a-text, a-dropdown 等），非氚云 Form* typeCode
- 新增 lib/ 模块必须同步新增 `tests/unit/` 对应测试文件
