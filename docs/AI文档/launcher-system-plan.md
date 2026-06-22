# 可配置软件启动器计划

## 目标

将弹窗顶部旧 VS Code / IDEA 按钮合并为统一“打开方式”启动器体系。主按钮优先打开置顶的可用启动器，置顶项不可用时顺延到下一个可用启动器，三角按钮展开深色菜单。该功能隔离于抓取、回写、目录快照、预检诊断和更新同步逻辑。

## 数据结构

配置字段为 `customLaunchers`，每项包含：

- `launcherId`：系统生成的稳定 ID，用户不可编辑。
- `iconKey`：图标文件名前缀，用户不可编辑。
- `name`：显示名称。
- `executablePath`：应用可执行文件路径。
- `argumentsTemplate`：启动参数模板，第一版只支持当前目标目录。
- `enabled`：是否启用。
- `pinned`：是否置顶；同一时间只允许一个启动器置顶，决定弹窗主按钮默认打开项。
- `sortOrder`：内部稳定顺位，第一版不再暴露移动或拖拽排序入口。
- `builtin`：是否内置。

内置启动器只包含 `VS Code`、`IntelliJ IDEA`、`File Explorer`、`Git Bash`。新安装默认只有 `File Explorer` 启用并置顶；其余内置项只有配置路径或检测成功后启用。

## UI 行为

设置页“应用路径”区域改为“打开方式”配置区，用导航栏切换当前软件详情，支持新增、编辑、启用/禁用、自定义删除、置顶默认打开、恢复默认参数、一键检测内置软件和上传图标。

弹窗顶部最右侧显示启动器按钮组。点击主图标直接启动置顶优先的第一个可用启动器；点击三角符号展开菜单。菜单只显示 `enabled=true` 且路径已配置的启动器。

## Native Host

打开动作继续调用 `launch_native_editor`，不拼接 shell 命令。新增命令：

- `discover_launchers`：只检测 4 个内置启动器常见安装路径。
- `extract_executable_icon`：保留协议，第一版不可用时返回可诊断失败，设置页要求上传图标。
- `save_launcher_icon`：保存用户上传 `png/webp` 并生成 16/48/128 PNG。
- `delete_launcher_icon`：删除自定义启动器对应三尺寸 PNG。

## 图标

图标路径固定为：

- `assets/icons/extension/icon-16.png`
- `assets/icons/extension/icon-48.png`
- `assets/icons/extension/icon-128.png`
- `assets/icons/launchers/{iconKey}-16.png`
- `assets/icons/launchers/{iconKey}-48.png`
- `assets/icons/launchers/{iconKey}-128.png`

保留 `assets/ztdh-logo.png` 作为兼容文件，manifest 和新 UI 使用 `assets/icons/extension/*` 与 `assets/icons/launchers/*`。

## 验证

- `npm run verify`：JS 语法、预检诊断和启动器纯函数验证。
- `cargo test`：Native Host 新命令、图标保存/删除、路径发现和参数模板解析。
- 手工验收：新安装默认 File Explorer 可用；检测内置软件后启用已找到项；主按钮直接启动；三角菜单展开；新增自定义软件需要图标；删除自定义软件删除三尺寸图标。
