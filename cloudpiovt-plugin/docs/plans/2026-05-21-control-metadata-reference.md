# 控件元数据增强实施计划
>
**目标：** 让 `FromCode.md` 在控件名称、编码之外，补充控件类型、四类选项控件的选项数据，以及关联控件的关联表单信息；同时在设置页展示 HTML 标签与控件类型参考，方便用户理解抓取结果。  
**设计：** 抽离共享控件类型映射，供 `readme-parser` 和设置页共同使用；关联控件默认展示 HTML 中已有的 `data-schema-code`，并在后续抓取时尽量保留用户在 `FromCode.md` 中手工补充的关联表单编码与名称。  
**技术栈：** Chrome Extension、ES Module、原生文件读写桥接。  
**注释计划：** 为控件类型映射、关联控件手填信息保留逻辑、设置页控件参考渲染补充中文注释。  
**文档同步：** 更新 `cloudpiovt-plugin/README.md`、`cloudpiovt-plugin/docs/architecture.md`、`cloudpiovt-plugin/docs/changelog-ai.md`。  
---

### 任务 1：补充解析与保留逻辑测试
**文件：**
- 修改：`cloudpiovt-plugin/tests/readme-parser.test.mjs`

- [x] **第 1 步：覆盖控件类型与选项控件**
  - 使用全控件 HTML 验证 `a-text`、`a-radio`、`a-checkbox`、`a-dropdown`、`a-dropdown-multi` 的类型和选项输出。
- [x] **第 2 步：覆盖关联控件字段**
  - 验证 `a-association-form`、`a-relevance-form-multi` 会输出关联表单编码和名称。
- [x] **第 3 步：覆盖手填值保留**
  - 验证旧 `FromCode.md` 中手填的关联表单编码/名称在后续抓取时仍会保留。

### 任务 2：实现共享控件类型映射与文档输出增强
**文件：**
- 创建：`cloudpiovt-plugin/lib/control-metadata.js`
- 修改：`cloudpiovt-plugin/lib/readme-parser.js`
- 修改：`cloudpiovt-plugin/popup.js`

- [x] **第 1 步：抽离共享控件类型映射**
  - 用统一常量维护 HTML 标签、中文控件类型、示例名称和特殊能力标记。
- [x] **第 2 步：增强控件解析**
  - 输出控件类型。
  - 只对四类选项控件提取 `data-options.custom`。
  - 对关联控件输出关联表单编码和名称。
- [x] **第 3 步：保留关联控件手填信息**
  - 抓取前读取现有 `FromCode.md`，将关联控件的手填编码和名称合并回新文档。

### 任务 3：更新设置页控件参考
**文件：**
- 修改：`cloudpiovt-plugin/options.html`
- 修改：`cloudpiovt-plugin/options.js`
- 修改：`cloudpiovt-plugin/options.css`

- [x] **第 1 步：增加控件类型参考区域**
  - 展示 HTML 标签、中文控件类型、示例字段名和特殊说明。
- [x] **第 2 步：接入共享映射渲染**
  - 避免设置页和解析逻辑分别维护两份控件类型表。

### 任务 4：同步文档并完成验证
**文件：**
- 修改：`cloudpiovt-plugin/README.md`
- 修改：`cloudpiovt-plugin/docs/architecture.md`
- 修改：`cloudpiovt-plugin/docs/changelog-ai.md`

- [x] **第 1 步：运行定向测试**
  - 运行命令：`node cloudpiovt-plugin/tests/readme-parser.test.mjs`
- [x] **第 2 步：执行功能验证**
  - 用用户提供的全控件 HTML 校验 `FromCode.md` 中的控件类型、控件选项和关联控件字段。
- [x] **第 3 步：同步显式上下文**
  - 更新 README、架构文档和 AI 变更记录。
