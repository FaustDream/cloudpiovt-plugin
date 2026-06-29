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
