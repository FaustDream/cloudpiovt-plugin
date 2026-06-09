# 图标来源

本目录保存扩展图标和启动器图标的 PNG 产物。运行时只读取 PNG；SVG/源图仅作为生成输入，不随第一版保留。

## 扩展图标

- `assets/icons/extension/icon-16.png`
- `assets/icons/extension/icon-48.png`
- `assets/icons/extension/icon-128.png`
- 来源：仓库既有 `assets/ztdh-logo.png`，保留原文件作为兼容入口。

## 内置启动器图标

- `vscode-*`：Wikimedia Commons `Visual Studio Code 1.35 icon.svg`
  - 来源：https://commons.wikimedia.org/wiki/File:Visual_Studio_Code_1.35_icon.svg
- `intellij-idea-*`：Simple Icons `intellijidea.svg`
  - 来源：https://github.com/simple-icons/simple-icons/blob/develop/icons/intellijidea.svg
- `file-explorer-*`：Wikimedia Commons `Windows Explorer.svg`
  - 来源：https://commons.wikimedia.org/wiki/File:Windows_Explorer.svg
- `git-bash-*`：Simple Icons `git.svg`
  - 来源：https://github.com/simple-icons/simple-icons/blob/develop/icons/git.svg

## 生成规则

- 每个图标固定生成 `16`、`48`、`128` 三个 PNG。
- 自定义启动器图标由 Native Host 的 `save_launcher_icon` 生成。
- 自定义图标第一版只接受 `png/webp` 上传，不接受 SVG。
