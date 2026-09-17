# 架构规范

> 本文件描述当前架构和模块职责。架构调整、目录迁移或模块职责变化时必须同步更新。

## 目录职责

```text
src/
├── background/
├── pages/
├── injection/
├── services/
├── lib/
│   ├── platform/
│   ├── directory/
│   ├── utils.ts
│   ├── semver.ts
│   └── release-notes.ts
└── types/
```

### `src/background/`

Service Worker。

负责：

* 扩展启动。
* 标签页生命周期。
* 目录快照清理。

不得通过模块级可变状态假设 Service Worker 永久存活。

### `src/pages/`

Popup、Options 页面及其 HTML/CSS。

负责：

* UI 事件。
* 页面状态。
* 业务编排。

Popup 当前直接调用：

```ts
chrome.scripting.executeScript
```

不要擅自引入消息中心或 Native Host 架构。

### `src/injection/`

目标页面主世界执行的注入函数。

注入函数必须：

* 可以被 `executeScript` 序列化。
* 不依赖文件外部闭包状态。
* 不依赖 DOM 引用作为跨执行上下文状态。
* 不依赖 `chrome.runtime`。
* 只返回可结构化克隆的数据。

### `src/services/`

运行时服务，包括：

* 浏览器存储。
* File System Access API。
* 目录状态。
* 产物。
* 预检诊断。
* 更新检查。

涉及 `chrome.*` 或浏览器 API 的代码优先放在：

```text
src/services/
src/pages/
src/background/
```

### `src/lib/platform/`

云枢、氚云适配及相关纯逻辑。

### `src/lib/utils.ts`

纯逻辑工具。

### `src/lib/semver.ts`

版本处理逻辑。

### `src/lib/release-notes.ts`

现有运行时依赖属于历史例外，不得继续扩大该例外。

### `src/lib/directory/`

IndexedDB 目录句柄存储。

`FileSystemDirectoryHandle` 不能当作普通路径字符串处理。

### `src/types/`

跨模块类型契约。

新增平台、页面类型、产物或注入返回值时，先更新对应类型，再实现业务逻辑。

## 当前不存在的架构

当前没有：

```text
src/shared/
src/pages/injected/
native-host/
src/styles/
```

除非用户明确批准架构迁移：

* 不新增上述目录。
* 不引入消息协议。
* 不引入 Native Messaging。
* 不引入全局状态中心。
* 不把 vanilla-extract 等未使用方案写成实现要求。

## UI

UI 当前使用：

* 原生 HTML。
* 静态 CSS。
* CSS 自定义属性。

除非明确进行技术路线迁移，不引入运行时 CSS 框架。

## 目录语义

* 页面 scope 句柄优先于当前平台默认句柄。
* 云枢和氚云默认目录分开。
* 页面展示、选择器 `startIn`、权限检查和文件读写必须使用同一解析结果。
* 不恢复已退役的全局 `pageType` 共享目录槽。

## 产物

产物配置由：

```text
src/services/artifacts.ts
```

负责归一化。

规则：

* 旧 `generatedFiles` 仅允许用于一次性迁移。
* 静态模板采用“补建缺失、不覆盖已有文件”。
* 空文件名表示只建目录。
* 同平台启用产物的最终相对路径不得重复。
* 相对路径不得通过 `..` 逃逸。
