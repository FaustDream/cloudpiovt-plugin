# 项目记忆

## 项目概述

开发助手（Chrome MV3 扩展），为云枢和氚云开发页面提供本地协作能力。

## 平台隔离

- **云枢**：前端 HTML/CSS/JS 抓取写入/回写，业务规则（Java/Monaco）抓取写入/回写
- **氚云**：页面探测、控件信息读取、前端 JS/后端 C# 代码抓取写入/回写
- 两个平台的代码路径在 `popup.js` 中完全隔离，通过 `PLATFORM_CONFIG` 和平台标签切换

## 氚云代码编辑器读取方式

- **主路径**：Monaco API（`window.monaco.editor.getEditors()` / `getModels()`）
- **兜底路径**：`.view-lines .view-line` DOM 读取（2026-05-29 新增）
- 兜底限制：受 Monaco 虚拟滚动影响，大文件只能读取视口内行

## 技术栈

- 原生 JS（ES Module），非 WXT/React/TypeScript
- Native Messaging 与本地 .NET 程序通信
- IndexedDB 存储 File System Access 目录句柄
- chrome.storage.local 存储配置和历史
