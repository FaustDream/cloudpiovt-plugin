# 架构说明

## 目标目录状态

目标目录分为两层：

- 全局默认值：按页面类型保存在 `chrome.storage.local.targetDirectoryPaths` 与 IndexedDB 默认句柄中，供后续新页面建立初始目录。
- 页面快照：按 `tabId + pageType + pageUrlHash` 保存在 `chrome.storage.session` 与 IndexedDB 页面级句柄中，供已经打开的页面继续使用自己的目录。

`background.js` 在扩展启动时先为已打开标签页建立基线快照，并继续监听标签页创建、跳转和关闭。创建或跳转时会调用 `ensureTargetDirectorySnapshot` 从当前全局默认值复制快照；关闭时按 tab scope 清理页面快照。用户在弹窗中重新选择目录时，会同时更新当前页面快照和全局默认值，因此新打开页面继承新目录，旧页面不会被覆盖。

## 自动生成文档

前端抓取写入会同时生成 `README.MD` 和 `FromCode.md`。`README.MD` 面向人工阅读，只保留页面类型、表单名称、链接名称、控件名称和子表名称；`FromCode.md` 承接编码类信息，包括页面地址、应用编码、表单编码、主表编码、控件编码和子表编码。
