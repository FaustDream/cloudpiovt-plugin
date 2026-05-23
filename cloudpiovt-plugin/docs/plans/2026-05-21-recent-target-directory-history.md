# 最近目标路径实施计划
> 
**目标：** 为弹窗增加可折叠的绝对路径区域和最近 5 条 Native 目标路径快捷切换能力。  
**设计：** 新增独立的最近路径存储模块，只记录 Native Host 返回的绝对路径；点击历史路径时复用现有 `saveNativeTargetDirectorySelection(...)`，保持页面快照与默认目录的既有语义不变。弹窗把绝对路径改为摘要 + 折叠面板，面板内承载复制、最近路径、移除与重新选择。  
**技术栈：** Chrome Extension、ES Module、chrome.storage.local、Native Host。  
**注释计划：** 为最近路径存储模块中的去重/裁剪逻辑、Native 路径保存流程、弹窗折叠面板状态与历史路径点击流程补充中文注释。  
**文档同步：** 更新 `cloudpiovt-plugin/README.md`、`cloudpiovt-plugin/docs/architecture.md`、`cloudpiovt-plugin/docs/changelog-ai.md`；新增 `cloudpiovt-plugin/docs/specs/2026-05-21-recent-target-directory-history-design.md` 记录设计。  
---

### 任务 1：补齐设计与计划文档
**文件：**
- 创建：`cloudpiovt-plugin/docs/specs/2026-05-21-recent-target-directory-history-design.md`
- 创建：`cloudpiovt-plugin/docs/plans/2026-05-21-recent-target-directory-history.md`
- 注释：无需代码注释，本任务只沉淀设计与执行边界

- [x] **第 1 步：写入设计文档**
  - 记录“最近路径只保存 Native 绝对路径”“历史记录只是快捷入口”“点击历史路径仍复用现有保存流程”等关键决策。
- [x] **第 2 步：写入实施计划**
  - 把存储、UI、验证、文档同步拆成独立任务，作为后续执行断点。

### 任务 2：新增最近路径存储模块并接入 Native 路径保存
**文件：**
- 创建：`cloudpiovt-plugin/lib/recent-target-directories.js`
- 修改：`cloudpiovt-plugin/lib/target-directory-state.js`
- 测试：`cloudpiovt-plugin/tests/recent-target-directories.test.mjs`
- 注释：最近路径去重与裁剪函数、Native 路径保存后写入历史的调用点

- [x] **第 1 步：实现最近路径存储模块**
  - 提供读取、追加、删除最近路径记录的接口。
  - 记录字段至少包含 `path`、`pageType`、`lastUsedAt`。
  - 去重规则按路径去重，容量上限 5。
- [x] **第 2 步：为纯逻辑补充测试**
  - 验证路径去重、最近项前置、容量裁剪、非法值过滤。
- [x] **第 3 步：接入 Native 路径保存流程**
  - 在 `saveNativeTargetDirectorySelection(...)` 中写入最近路径，确保所有 Native 选目录入口都自动更新历史。
- [x] **第 4 步：运行定向测试**
  - 运行命令：`node --experimental-default-type=module cloudpiovt-plugin/tests/recent-target-directories.test.mjs`
  - 预期结果：输出测试通过信息

### 任务 3：改造弹窗路径面板与最近路径交互
**文件：**
- 修改：`cloudpiovt-plugin/popup.html`
- 修改：`cloudpiovt-plugin/popup.css`
- 修改：`cloudpiovt-plugin/popup.js`
- 注释：折叠面板状态、当前路径高亮逻辑、点击历史路径直接切换的流程

- [x] **第 1 步：改造弹窗 HTML 结构**
  - 把“绝对路径”改为可点击的折叠入口。
  - 在展开区增加完整路径、复制按钮、最近路径列表和“重新选择”按钮。
- [x] **第 2 步：补齐 CSS**
  - 为折叠面板、最近路径列表、当前项高亮、移除按钮和辅助文案补样式。
- [x] **第 3 步：实现弹窗逻辑**
  - 读取最近路径列表并渲染。
  - 点击历史路径时直接调用 `saveNativeTargetDirectorySelection(...)` 切换。
  - 点击移除按钮时删除历史项但不影响当前绑定目录。
  - 重新选择目录后刷新列表，并自动展开路径面板。
- [x] **第 4 步：执行基础静态验证**
  - 运行命令：`node --experimental-default-type=module --check cloudpiovt-plugin/popup.js`
  - 预期结果：无语法错误

### 任务 4：同步用户文档与架构文档
**文件：**
- 修改：`cloudpiovt-plugin/README.md`
- 修改：`cloudpiovt-plugin/docs/architecture.md`
- 修改：`cloudpiovt-plugin/docs/changelog-ai.md`
- 注释：无需代码注释，本任务只同步显式上下文

- [x] **第 1 步：更新 README**
  - 说明绝对路径区域支持展开/收起、最近路径快捷切换和移除。
- [x] **第 2 步：更新架构文档**
  - 说明最近路径的存储边界与“点击历史路径仍走 Native 路径保存流程”。
- [x] **第 3 步：更新 AI 变更记录**
  - 记录本次历史路径与折叠路径面板改动。

### 任务 5：完成前验证
**文件：**
- 验证：`cloudpiovt-plugin/tests/recent-target-directories.test.mjs`
- 验证：`cloudpiovt-plugin/popup.js`
- 验证：`cloudpiovt-plugin/lib/recent-target-directories.js`
- 文档：`cloudpiovt-plugin/README.md`、`cloudpiovt-plugin/docs/architecture.md`、`cloudpiovt-plugin/docs/changelog-ai.md`
- 注释：复查新增或修改逻辑的中文注释是否足够

- [x] **第 1 步：复跑定向测试**
  - 运行命令：`node --experimental-default-type=module cloudpiovt-plugin/tests/recent-target-directories.test.mjs`
  - 预期结果：通过
- [x] **第 2 步：复跑语法检查**
  - 运行命令：`node --experimental-default-type=module --check cloudpiovt-plugin/popup.js`
  - 预期结果：通过
- [x] **第 3 步：检查文档与注释**
  - 确认最近路径去重、点击切换、折叠面板状态等关键逻辑已有中文注释。
  - 确认 README、架构文档与 AI 变更记录已同步。
