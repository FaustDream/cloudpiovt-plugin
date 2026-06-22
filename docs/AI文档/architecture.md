# 架构说明

## 平台入口

扩展对外名称为“开发助手”，弹窗按平台拆成“云枢”和“氚云”两个标签。`lib/config.js` 负责先识别平台，再识别页面类型：`h3yun.com` 和其子域名统一归为氚云，其余页面继续保持云枢兼容逻辑。这样可以避免氚云链接中的 `form-design` 被误判成云枢表单在线开发。

云枢继续沿用历史 `pageType`：`form`、`list`、`default`，避免用户已有目标目录配置失效。氚云使用独立 `pageType`：`h3yun-form`、`h3yun-default`，后续适配时可以拥有独立目录快照、文件命名和页面探测策略。

氚云当前使用独立抓取策略：页面探测读取当前页面地址、hash 路由参数、`appcode`、对象 ID、`isBeta`、框架线索和 DOM 命名线索；一键抓取会扫描当前已挂载的图形控件、前端 JS 和后端 C#，弹窗不再提供这三类资源的单独抓取按钮。云枢抓取 / 回写入口在执行前会校验平台，防止把氚云页面套进云枢 `data.codes` 或 Monaco 业务规则模型。

氚云图形控件来自 `.designer.web .control-container[data-code]`，输出到 `FromCode.md`，字段包含控件编码、控件类型和中文名称；子表控件来自 `FormGridView` 内部的 `[data-sheet='true'] .sheet-control`。氚云前端代码来自 `#jsText` 的 Monaco model，写入表单对象 ID 对应的 `.js` 文件；后端代码来自 `#csText` 的 Monaco model，优先按 C# 类名写入 `.cs` 文件，源码未加载时回退到 URL `id`。氚云 Monaco `languageId` 可能为空且会残留模板 model，抓取时先按内容特征区分 JS/C#，多个 model 命中时再按容器挂载、Monaco 版本号、创建顺序和长度评分，优先读取当前编辑内容。如果氚云页面采用懒加载，未挂载的编辑器或图形区无法仅凭当前 DOM 读取，一键抓取会跳过缺失项并保留已抓到的内容。

设置页按“云枢 / 氚云”两个标签隔离平台说明：云枢标签展示云枢内置规则、推荐流程和基于在线开发 HTML 标签的字段控件说明；氚云标签展示氚云内置规则、推荐流程和基于 `FromCode.md` 的氚云控件类型参考。两套控件说明分别维护，避免把云枢 HTML 标签和氚云 `Form*` 控件类型混用。

Native Host 承载绝对路径历史、系统文件选择器、可配置打开方式启动和自定义图标保存能力。弹窗顶部启动器读取 `customLaunchers`，主按钮直接启动置顶优先的第一个可用项，菜单只显示已启用且已配置路径的软件；设置页应用路径区用导航栏切换软件详情，`pinned` 字段决定默认打开项，同一时间只允许一个启动器置顶。内置项为 VS Code、IntelliJ IDEA、File Explorer、Git Bash，自定义项通过 `launcherId/iconKey` 隔离配置和图标。发布流程通过 `scripts/package-extension-release.ps1` 编译 Rust Native Host，并把运行 exe 复制到 `.native-host/publish/cloudpiovt_native_host.exe`；普通用户只需双击 `scripts/install-native-host.cmd` 注册当前用户的 host manifest，不需要安装 Rust / Cargo。Chrome 与 Edge 分别从 `HKCU\Software\Google\Chrome\NativeMessagingHosts` 与 `HKCU\Software\Microsoft\Edge\NativeMessagingHosts` 查找 host manifest；Edge 若使用不同扩展 ID，发布构建时需要追加 `-ExtensionId <Edge扩展ID>`。

更新检查由 `lib/update-check.js` 通过 Native Host 执行 Git 命令。Native Host (`cloudpiovt_native_host.exe`) 从自身可执行文件路径向上 3 级定位扩展根目录，检查 `.git` 是否存在；若为 Git 仓库则执行 `git fetch origin`，对比本地与远程 `origin/master:manifest.json` 的 version 字段。版本比较使用三段式 semver。自动检查（`chrome.alarms` 每日触发）仅 fetch + 比较结果并写入 `lastUpdateCheckResult`；用户点击"同步更新"按钮时 Native Host 执行 `git reset --hard origin/master` 完成强制同步。同步后扩展目录文件已更新，需要在 `chrome://extensions` 手动重新加载扩展。

## 目标目录状态

目标目录分为两层：

- 全局默认值：按页面类型保存在 `chrome.storage.local.targetDirectoryPaths` 与 IndexedDB 默认句柄中，供后续新页面建立初始目录。
- 页面快照：按 `tabId + pageType + pageUrlHash` 保存在 `chrome.storage.session` 与 IndexedDB 页面级句柄中，供已经打开的页面继续使用自己的目录。

`background.js` 在扩展启动时先为已打开标签页建立基线快照，并继续监听标签页创建、跳转和关闭。创建或跳转时会调用 `ensureTargetDirectorySnapshot` 从当前全局默认值复制快照；关闭时按 tab scope 清理页面快照。用户在弹窗中重新选择目录时，会同时更新当前页面快照和全局默认值，因此新打开页面继承新目录，旧页面不会被覆盖。

最近路径额外保存在 `chrome.storage.local.recentTargetDirectories`。这份历史只记录 Native Host 返回的绝对路径，不记录 File System Access 目录句柄；点击历史路径时，仍然统一走 `saveNativeTargetDirectorySelection(...)` 更新当前页面快照和后续新页面默认值，因此最近路径只是快捷入口，不是新的目录状态源。

## 自动生成文档

抓取写入会按需补建 `README.md`、`AGENTS.md`、`DESIGN.md`，并继续刷新 `FromCode.md`。`README.md` 是用户业务需求入口，`AGENTS.md` 约束当前目录的 AI 执行顺序和平台规则，`DESIGN.md` 由 AI 维护详细业务实现逻辑、参数传递、涉及文件和验证点；这三类人工/AI 协作文件只在缺失时创建，已存在时不会覆盖。旧版 `README.MD` 或 `design.md` 存在时会被视为已有人工文件，避免重复生成标准大小写文件。

`FromCode.md` 承接编码类信息，包括页面地址、应用编码、表单编码、主表编码、控件编码、控件类型和子表编码，并会在每次抓取写入时同步刷新。单选框、复选框、下拉单选框、下拉多选框若存在 `data-options.custom`，则会优先提取 `name_i18n.zh` 中的中文选项，并以“控件选项”写在对应控件下面。关联单选、关联多选控件会额外输出“关联表单编码 / 关联表单名称”；若旧 `FromCode.md` 中已经手工填写过这两项，刷新时会按主表 / 子表作用域分别保留已有值，避免同编码控件串值。若旧 `FromCode.md` 临时读取失败，则本次抓取仍继续写入代码文件和新文档，只放弃旧值保留。

云枢协作文件会明确前端 JS 与服务端业务规则通过业务规则传参协作，服务端查询、写入、校验和状态流转应放在 Java 业务规则中实现。氚云协作文件会明确前端 JS 与后端 C# 通过 Ajax 传参互通，`DESIGN.md` 需要同步维护请求参数、返回结构、错误提示和两端涉及文件。

设置页中的“控件类型参考”与文档解析复用同一份控件类型映射，统一维护 HTML 标签、中文控件类型、示例字段名和特殊说明，避免解析结果与页面说明脱节。

## 业务规则回写限制

业务规则抓取与回写依赖页面内只存在一个有效业务规则 Monaco model。若用户在同一页面同时打开了多个不同表单或多个业务规则，插件会先拒绝抓取 / 回写，并提示关闭多余业务规则后重试；若目标目录中缺少当前解析出的 `.java` 文件，也会同步提示优先排查这个多开场景。

## 预检与诊断

弹窗操作通过 `runOperationWithPreflight(operationId, checks, task)` 统一执行预检，`severity=blocker` 会自动阻断，`severity=warning` 写入日志但允许继续，`severity=info` 记录上下文。第一版覆盖云枢前端抓取/回写、业务规则抓取/回写、氚云一键抓取/回写、打开方式启动、更新目录和设置页同步更新。

诊断 JSON 由 `lib/preflight-diagnostics.js` 生成，顶级字段包含 `logs`、`pageProbe`、`directorySnapshot`、`preflightResults`、`nativeHost` 和 `updateSync`。页面探测快照只记录 URL、平台、页面类型和 Monaco 结构状态，不保存源码片段；目录清单只记录文件名、存在状态、大小和修改时间，不保存 `README.md`、`DESIGN.md`、`FromCode.md` 或代码正文。最近一次诊断包保存到 `chrome.storage.local.lastDiagnosticPackage`，设置页可导出。

回写类操作在读取本地文件后会追加 `writeback.localFileRisk` warning，记录待回写文件名、大小和修改时间；Git 同步更新会追加 `update.gitResetRisk` warning，明确 Native Host 会执行 `git reset --hard origin/master`。设置页显示最近诊断生成时间和 `operationId`，并支持复制摘要给开发者快速判断问题类型。
