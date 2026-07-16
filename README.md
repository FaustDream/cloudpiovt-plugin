# 开发助手

一款 Chrome/Edge 浏览器扩展（Manifest V3），为**云枢（CloudPivot）**和**氚云（H3Yun）**两个低代码平台的在线开发页面提供本地代码抓取、回写和目录协作能力。

| 项目 | 说明 |
|------|------|
| 扩展名称 | 开发助手 |
| 版本 | 1.12.1 |
| 作者 | 凌致 |
| 平台支持 | 云枢（CloudPivot）、氚云（H3Yun） |
| 浏览器支持 | Chrome、Edge（Manifest V3） |

---

## 核心功能

### 云枢平台

- **前端代码**：抓取设计器 HTML/CSS/JS 源码写入本地目录，修改后可回写至平台
- **业务规则**：抓取 Monaco 编辑器中 Java 业务规则代码，支持回写
- **FromCode.md**：从 HTML 解析控件元数据（编码、类型、选项、关联表单），自动生成编码上下文文档
- **AI 协作文件**：按需补建 `README.md`、`AGENTS.md`、`DESIGN.md`

### 氚云平台

- **一键抓取**：同时抓取控件信息（FromCode.md）+ 前端 JS + 后端 C# 源码
- **一键回写**：顺序执行前端 JS 和后端 C# 回写，无需两步操作
- **表单/列表双模式**：自动识别表单设计和列表设计页面，生成对应后缀的文件名
- **子表编码诊断**：当子表控件编码缺失时自动捕获 DOM/Vue 状态快照，注入诊断包辅助排查

### 跨平台通用能力

- **目录管理**：按页面类型独立绑定本地目标目录，支持历史目录搜索切换（关键词模糊匹配 + 键盘导航），**跨标签页实时同步**
- **多编辑器打开**：顶部可用 VS Code、IntelliJ IDEA、File Explorer、Git Bash 或自定义命令打开当前绑定目录
- **预检诊断**：抓取、回写、打开编辑器和同步更新前自动预检，可导出结构化诊断 JSON
- **安全确认**：回写前展示目标文件当前大小/修改时间，同步更新前提示 Git 强制同步风险
- **写入前选择**：弹窗支持在写入前临时勾选本次需要生成的协作文件（README/AGENTS/DESIGN）
- **平台默认目录兜底**：设置页可为每个平台配置默认目录，无历史记录时自动透传使用

## 界面设计

- 基于心流鼠标（FlowMouse）设计规范 v2.2，融合 macOS 系统设置风格与 Ant Design 5.0 克制感
- 配色：#F0F2F5 页面 / #FFFFFF 卡片 / #1677FF 主色
- 弹窗自适应内容高度，状态栏空态压缩、成功单行、失败展开
- 设置页右侧滑出帮助抽屉（控件参考 / 推荐流程 / 版本更新）

## 自动更新

- Native Host 每日自动检查最新版本（`git fetch` + manifest.json 三段式版本号对比）
- 用户在设置页点击「同步更新」按钮一键执行 `git reset --hard origin/master`
- 同步后需在 `chrome://extensions` 重新加载扩展

## 技术栈

- **前端**：原生 JavaScript（ES Module）、无框架依赖
- **Native Host**：Rust（`native-host-rust/`），通过 Native Messaging 与扩展通信
- **存储**：`chrome.storage.local`（配置、历史目录）、IndexedDB（File System Access 目录句柄）
- **测试**：Vitest + @vitest/coverage-v8，L0-L7 分层测试体系，报告输出至 `tests/docs/`

## 项目结构

```
├── manifest.json          # 扩展清单 (MV3)
├── src/
│   ├── background/        # Service Worker
│   └── pages/             # popup.html / options.html + JS/CSS
├── lib/
│   ├── config.js          # 核心配置与 URL 解析
│   ├── release-notes.js   # 版本发布记录
│   ├── utils.js           # 通用工具函数
│   ├── platform/          # 平台专属逻辑
│   │   ├── h3yun-code.js          # 氚云代码处理
│   │   ├── control-metadata.js    # 控件类型元数据
│   │   ├── readme-parser.js       # 云枢 HTML 解析与文档生成
│   │   └── bizrule-constraints.js # 业务规则约束
│   ├── directory/         # 目录管理
│   │   ├── file-handle-db.js              # IndexedDB 文件句柄
│   │   └── recent-target-directories.js   # 最近目录记录
│   └── services/          # 后台服务
│       ├── native-host.js             # Native Messaging 通信
│       ├── workspace-documents.js     # 工作区文档补建
│       └── preflight-diagnostics.js   # 预检诊断
├── native-host-rust/      # Rust Native Host
├── scripts/               # 部署/构建脚本
├── assets/                # 图标等静态资源
├── tests/                 # 测试用例与报告（Git 忽略）
└── README.md
```

## 开发

```bash
# 安装依赖
npm install

# 静态检查
npm run check:js

# 运行测试
npm test

# 全量测试（含编排、覆盖率、报告生成）
npm run test:all
```

---

## 版本记录

详见 `lib/release-notes.js`，或设置页帮助抽屉中的版本更新面板。
