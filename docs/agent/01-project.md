# 项目事实

> 本文件记录当前项目实现事实。项目结构、依赖、脚本、权限或配置发生变化时必须同步更新。

## 项目

* 项目名称：开发助手。
* 默认仅供用户个人本地使用。
* 项目类型：Chrome/Edge Manifest V3 扩展。
* 入口由 `manifest.json` 声明。
* 构建产物统一输出到 `dist/`。
* 测试目录为 `tests/`。
* 发布产物目录为 `releases/`。
* `dist/` 与 `releases/` 为生成目录，不手动编辑。

## 包管理

* 当前仓库以 `npm`、`package.json` 和 `package-lock.json` 为事实依据。
* 未完成包管理器迁移前，禁止混用 `pnpm`、`yarn` 或提交其他锁文件。
* 依赖声明以 `package.json` 为准。
* 依赖锁定以 `package-lock.json` 为准。

## 当前主要依赖

* `typescript`
* `esbuild`
* `vitest`
* `@types/chrome`
* `zod`

## 当前脚本

项目当前存在：

```text
npm run typecheck
npm run test
npm run build
npm run check
npm run dev
```

* `npm run dev` 通过 `scripts/build.mjs --watch` 监听构建。
* 当前不存在独立的 `lint`、`watch` 或覆盖率脚本，不得将不存在的脚本写入任务验收标准。

## 当前环境

* 当前没有应用运行时 `.env` 或 `process.env` 配置。
* `scripts/package.mjs` 仅使用 `process.env.SystemRoot` 定位 Windows 系统 `tar.exe`。

## Manifest

`manifest.json` 是扩展权限和入口的唯一事实来源。

当前使用：

```text
activeTab
scripting
storage
tabs
```

新增权限、`host_permissions`、入口或固定 `key` 时，必须同步更新本文件。
