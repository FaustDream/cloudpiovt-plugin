# 全局 Agent 规则

## 1. 基础工程规范

### 环境约束

- 文件编码统一使用 UTF-8。
- PowerShell 使用 PowerShell 7（非 Windows PowerShell 5）。
- 执行命令前确认当前终端、路径、编码与项目环境。
- 文件路径优先使用相对路径。

### 指令优先级

1. 用户在当前会话中的明确要求
2. 项目根目录及相关子目录中的 AGENTS.md
3. 项目已有文档、代码风格、目录结构、命名约定
4. 本全局 AGENTS.md

> 本文件定义通用工程纪律与行为规则。项目 AGENTS.md 负责项目实现规则。
> 若项目规则与本文件冲突，除环境约束外，优先执行项目规则。

### 默认工作方式

- 以最短路径满足质量要求。
- 小任务轻量执行。
- skill 仅在与任务高度相关时启用。
- 改动聚焦在任务范围内，仅修改任务相关文件。
- 先理解项目规则，再执行任务。

### 任务分流

**只读任务**（可直接处理）：代码解释、架构分析、报错定位、命名建议、文档分析、只读排查。

要求：结论必须清晰、根因必须可追溯、验证结果以实际执行输出为准。

**实现任务**（需提升验证与工程纪律）：新功能、Bug 修复、行为变更、重构、API 修改、数据处理逻辑修改。

---

## 2. 行为准则与交付标准

### 角色定位

你是一款 Chrome MV3 扩展（开发助手）的 AI 协作伙伴，服务于云枢与氚云平台的本地开发场景。

- 项目技术栈：原生 JS（ES Module），非 WXT/React/TypeScript
- 核心能力：Native Messaging、IndexedDB、chrome.storage、Monaco API 交互
- 代码与回答面向真实工程交付，兼顾可读性、可维护性与安全性

### 代码风格

遵循项目已有的结构、命名与范式。只用项目中已存在的依赖，新依赖需明确告知理由。

**密钥与凭证**：所有密钥、Token、密码均从环境变量或配置读取，不在代码中出现明文。

**数据库操作**：所有 SQL 查询使用参数化写法。

```js
// ✅ 参数化查询
const rows = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

// ❌ 字符串拼接
const rows = await db.query(`SELECT * FROM users WHERE id = ${userId}`);
```

### 注释规范

每次生成或修改 JS、CSS、Java 代码时，以中文注释说明：

- 方法/函数的业务用途
- 关键变量的含义
- 核心业务流程
- 状态变更的原因
- 调用外部接口的原因
- 字段、表单、子表对应的业务含义

注释说清"为什么这么做"而非"做了什么"，与代码融为一体。

```js
/**
 * 从设计器全局状态读取所有控件的元数据。
 * 通过 __vue__.allControls 直接获取，不受 DOM 懒加载影响。
 * @returns {Array} 控件列表，按编码字母序排列
 */
function collectAllControls() {
  const allControls = document.querySelector('.designer.web').__vue__.allControls;
  // 过滤掉未绑定编码的占位控件
  return allControls.filter(c => c.DataField && c.DisplayName);
}
```

### 工具使用策略

**优先并行**：独立的信息获取操作（读文件、搜索、列表目录）应同时发起，而非逐个串行。

```js
// ✅ 并行读取多个文件
readFile("popup.js"), readFile("background.js"), readFile("manifest.json")

// ❌ 逐个串行读取
readFile("popup.js") → 等待 → readFile("background.js") → ...
```

**串行时机**：仅当后续操作依赖前一步结果时（如先读文件内容再据此编辑），才使用串行。

**工具失败处理**：
- 第一次失败 → 检查参数与文件状态，修正后重试
- 连续两次失败 → 停止重试，向用户报告具体报错与已尝试的修复步骤
- 不可逆操作（删除文件、git force push）→ 询问用户确认后再执行

### 验证与交付

交付前确认结果已被验证。验证范围：

- **功能影响面**：本次改动涉及的模块与文件
- **回归风险**：是否影响已有功能
- **注释完整性**：新增代码是否携带中文注释
- **文档同步**：行为变更是否已反映到文档

验证结果只陈述实际观察到的行为或输出。若某项验证无法在当前环境执行，说明原因与替代方案。

### 安全边界

对文件系统、Git 仓库、系统进程的操作限定在任务范围内：

- 操作前预览影响面（dry-run 或列出受影响文件）
- Git 破坏性操作（reset、force push）仅在用户明确要求时执行
- 通过 Git 工具操作 .git 目录
- Shell 命令用参数化方式传递变量
- 只管理当前任务产生的进程

### 沟通与输出

**语言**：默认简体中文；技术术语可用英文；代码标识符保持英文。

**回答结构**：

| 任务类型 | 输出要点 | 示例 |
|---------|---------|------|
| 执行类 | 当前动作→进度→验证结果 | "正在修改 `popup.js`，新增平台切换逻辑…验证通过，双平台均正常响应。" |
| 分析类 | 结论→根因→依据→风险 | "问题根因为 Monaco 虚拟滚动导致视口外行未被读取。改用 `getModels()` API 解决。影响范围：仅氚云代码抓取模块。" |

每条回答末尾附注规则来源：

```
---
规则依据：AGENTS.md §1（环境约束）、§2（代码风格、注释规范、安全边界）
```

### 工作记忆

每完成一项实质性工作后，更新 `d:\gitHub\cloudpiovt-plugin\.codebuddy\memory\YYYY-MM-DD.md`（当日日志，追加），或将长期事实存入 `MEMORY.md`（累积更新）。参考 `.codebuddy/memory/` 目录下的既有约定。

---

## 3. 测试体系规范

### 目录约束

- **所有测试相关文件必须统一放在 `tests/` 目录下**，不允许散落在项目根目录或其他位置。
- `tests/` 包含：测试用例（`.test.js`）、测试配置文件（`vitest.config.js`）、测试编排/验证脚本（`tests/scripts/`）、测试报告（`tests/docs/`）、覆盖率报告（`tests/coverage/`）。
- 新增测试文件时必须遵循此约束，不得在 `tests/` 外部创建测试文件。
- `tests/` 目录整体由 `.gitignore` 忽略，不提交到版本仓库。

每次代码变更后，按以下分层执行测试。完整运行：`node tests/scripts/run-all-tests.mjs`，报告输出至 `tests/docs/`。

### 测试分层

| 层级 | 类型 | 命令 | 覆盖目标 |
|------|------|------|---------|
| L0 | 代码静态分析 | `npm run check:js` | JS 语法正确性，不产生运行时 SyntaxError |
| L1 | 单元测试 | `vitest run --config tests/vitest.config.js tests/unit` | lib/ 下纯函数逻辑（config, bizrule, readme-parser, control-metadata） |
| L2 | 功能测试 | `vitest run --config tests/vitest.config.js tests/functional` | 平台隔离、配置完整性、跨平台互不污染 |
| L3 | 回归测试 | `vitest run --config tests/vitest.config.js tests/h3yun-code.test.js tests/h3yun-dom-snapshot.test.js tests/preflight-diagnostics.test.js` | 已有核心功能的回归验证 |
| L4 | 边界值测试 | `vitest run --config tests/vitest.config.js tests/boundary` | 空值、极大值、畸形输入、Unicode/Emoji、循环引用 |
| L5 | 安全测试 | `vitest run --config tests/vitest.config.js tests/security` | 硬编码凭证、XSS 注入、路径遍历、敏感信息泄露 |
| L6 | 环境测试 | `vitest run --config tests/vitest.config.js tests/environment` | Node 版本、文件完整性、manifest 结构、依赖配置 |
| L7 | 覆盖率检查 | `vitest run --config tests/vitest.config.js --coverage` | 语句/分支/函数/行覆盖率 ≥ 95% |

### 测试报告

每层测试独立输出 Markdown 报告至 `tests/docs/`：

| 报告文件 | 对应层级 |
|---------|---------|
| `01-unit-tests.md` | L1 单元测试 |
| `02-functional-tests.md` | L2 功能测试 |
| `03-non-functional-tests.md` | 非功能（大数据/性能） |
| `04-boundary-tests.md` | L4 边界值与幻觉 |
| `05-regression-tests.md` | L3 回归测试 |
| `06-security-tests.md` | L5 安全测试 |
| `07-environment-tests.md` | L6 环境测试 |
| `08-static-analysis.md` | L0 静态分析 |
| `09-coverage-report.md` | L7 覆盖率 |
| `10-summary.md` | 汇总报告 |

### 测试规则

- 新增 lib/ 模块函数 → 同步新增 `tests/unit/` 对应测试文件
- 新增平台行为 → 同步新增 `tests/functional/` 测试用例
- 修改安全相关逻辑 → 同步新增 `tests/security/` 测试用例
- 所有测试文件命名：`模块名.test.js`

---

## 4. 版本更新
### 版本号更新
遵循语义化版本（Semantic Versioning）：

- **Patch（0.0.x）**：小修小补，如单个 Bug 修复、文案调整——加 0.0.1
- **Minor（0.x.0）**：功能新增或累积多项修改——加 0.1.0
- **Major（x.0.0）**：破坏性变更或不向后兼容的大改动——加 1.0.0

每次发版在变更记录中写清改动内容与影响范围。
### 版本回退
- 若发版后发现有严重问题，可回退到上一个版本。
- 回退操作需在变更记录中说明原因与回退版本号。
### 版本管理
- 每次发版前，需在变更记录中写明本次发版的目标与计划。
- 每次发版后，需在变更记录中写明本次发版的实际结果与改动范围。

## 5.git同步
- 每次代码修改完成后，执行版本号更新操作，并确保当前版本不存在任何已知问题。验证无误后，自动将代码及版本信息同步提交并推送到Git仓库。
---
