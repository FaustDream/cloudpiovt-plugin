# AI 变更记录

## 2026-06-08

- 合并弹窗顶部 VS Code / IDEA 固定按钮为 `customLaunchers` 打开方式体系，默认内置 VS Code、IntelliJ IDEA、File Explorer、Git Bash，新安装仅 File Explorer 可用。
- 新增 `lib/custom-launchers.js` 与 `scripts/verify-custom-launchers.mjs`，覆盖配置 normalize、排序、默认启动器选择、`launcherId/iconKey` 生成和检测结果合并。
- Native Host 新增 `discover_launchers`、`extract_executable_icon`、`save_launcher_icon`、`delete_launcher_icon` 命令；上传图标生成 16/48/128 PNG，自定义启动器删除时同步删除三尺寸图标。
- 设置页“应用路径”改为“打开方式”配置区，支持新增、编辑、启用/禁用、删除自定义、上移/下移、HTML5 拖拽排序、恢复默认参数和检测内置软件。
- 弹窗打开失败诊断切换为 `operationId=native.openCustomLauncher`，预检结果记录 `launcherId/iconKey/executablePath/argumentsTemplate`。
- 增加失败排查闭环：弹窗抓取、回写、打开编辑器、更新目录和设置页同步更新前自动输出预检结果，字段使用 `operationId/checkId/severity/errorCode/evidence/nextAction`。
- 新增 `lib/preflight-diagnostics.js` 和 `scripts/verify-preflight-diagnostics.mjs`，诊断 JSON 保存文本日志、页面探测快照、目标目录文件清单、预检结果和 Native Host / Git 同步状态，不保存源码或文档正文。
- Native Host 新增 `stat_directory_files` 命令，只返回文件名、存在状态、大小和修改时间，避免诊断包为了目录清单读取代码正文。
- 增强误操作风险提示：回写前记录本地文件大小和修改时间，同步更新前记录 `git reset --hard origin/master` 风险，设置页显示最近诊断状态并支持复制诊断摘要。
- 新增根 `package.json`，提供 `check:js`、`verify:preflight`、`verify` 验证入口。
- 发布 1.3.1：云枢和氚云抓取目录统一按需补建 `README.md`、`AGENTS.md`、`DESIGN.md`，并继续刷新 `FromCode.md` 作为编码文件。
- 设置页“应用路径”从竖排启动器卡片改为导航栏切换详情；移除上移/下移和拖拽排序入口，新增单一 `pinned` 置顶默认打开规则。
- 新增 `lib/workspace-documents.js`：集中生成 AI 协作文件模板，定义 `README.md` 为用户需求入口、`DESIGN.md` 为 AI 实现设计入口、`AGENTS.md` 为当前目录文件规范。
- 云枢协作模板明确平台互通模型：前端 JS 通过业务规则传参协作，服务端查询、写入、校验和状态流转应放在业务规则 Java 中实现。
- 氚云协作模板明确平台互通模型：前端 JS 与后端 C# 通过 Ajax 传参互通，`DESIGN.md` 必须维护请求参数、返回结构、错误提示和涉及代码文件。
- 文件兼容策略：新目录使用标准 `README.md` / `DESIGN.md`，检测到旧版 `README.MD` 或 `design.md` 时视为已有人工文件，不重复生成、不覆盖。

## 2026-06-05

- 更新机制改为 Git 直连：Native Host 新增 `git_sync` 命令，从自身 exe 路径定位扩展仓库根目录，执行 `git fetch` + `origin/master:manifest.json` 版本比较 + `git reset --hard origin/master` 强制同步。
- 移除 `update.json` 拉取方案和「更新配置地址」UI 字段；设置页新增「同步更新」按钮，仅在检测到远程版本更高时显示。
- 自动检查（`chrome.alarms` 每日触发）仅 fetch + 比较，不动本地文件；用户手动点击同步按钮时执行强制拉取，之后提示在 `chrome://extensions` 重新加载。
- 新增 Rust helper `compare_versions()`、`parse_manifest_version()`、`git_sync()`；`HostResponse` 新增 `currentVersion`/`latestVersion`/`updateAvailable`/`synced` 字段。

## 2026-06-02

- 修复 Rust Native Host 迁移回归：恢复 Native Messaging camelCase 协议、拆分编辑器启动参数模板、将运行产物注册路径收敛到 `.native-host/publish/cloudpiovt_native_host.exe`。
- 修复 Native Host 文件夹弹窗实现异常导致"更新目标目录失败"的兜底逻辑：原生目录选择报错且浏览器支持目录句柄时，自动退回 `showDirectoryPicker` 保存当前页面快照。
- 调整氚云一键抓取设计文档规则：仅在缺失时新建大写 `DESIGN.md`，存在 `DESIGN.md` 或旧版 `design.md` 时都不覆盖、不重复生成。
- 增强氚云子表字段抓取：子表控件编码优先读 DOM 属性，缺失时按标题/序号从 Vue 组件数据补齐，并在一键写入状态提示剩余缺失数量。
- 修正氚云子表字段编码匹配：子表字段编码按设计器全局状态中的 `子表编码.F字段编码` 顺序回填，兼容字段名称与编码不在同一 DOM 元素的结构。
- 发布 1.3.0：FromCode.md 子表控件编码改为只输出 `F...` 字段编码；弹窗和设置页按钮新增运行中旋转提示；设置页新增版本更新记录并重构为状态总览优先。
- 设置页保留单页面形态，但取消长网页堆叠：顶部快速导航顺序调整为状态总览、应用路径、运行日志、控件参考、推荐流程、版本更新；控件参考、推荐流程和版本更新收敛到「说明中心」标签面板，云枢/氚云在对应说明内独立切换。
- 增强弹窗执行状态日志：自动附带平台、页面、目录、错误级别、处理建议，新增复制日志和导出日志按钮，便于用户发给作者排查插件适配问题。
- 发布脚本排除 Cargo `target` 构建缓存，`.cmd` 安装入口转发参数，开发联调可通过 `scripts\install-native-host.cmd -Build` 在 Windows PowerShell 5 入口下触发构建。
- 将 `scripts/install-native-host.cmd` 改为调用 `powershell.exe`，兼容 Windows PowerShell 5，普通用户安装原生助手不再依赖 PowerShell 7；README 和使用手册同步补充安装/排查说明。
- 将扩展版本调整为 `1.2.0`，同步 manifest、使用文档和发布包默认版本。
- 将 Native Host 安装改为自包含用户级方案：开发维护人员通过 `scripts/package-extension-release.ps1` 生成 win-x64 原生助手运行目录和发布 zip，普通用户双击 `scripts/install-native-host.cmd` 注册，不需要 .NET SDK / Runtime。
- 同步 README 和使用手册：绝对路径历史、选择应用和一键打开编辑器作为必须能力保留，安装入口改成双击 `.cmd`，Edge ID 差异由发布构建时的 `-ExtensionId` 处理。
- 设置页"选择应用"在未启用 Native Host 时改为提示手动粘贴路径，避免普通用户被缺少 .NET / 注册表环境阻断。

## 2026-05-29

- 恢复设置页云枢字段控件说明：云枢标签展示 HTML 标签控件参考，氚云标签展示 `Form*` 控件类型参考，两套说明独立维护。
- 增强 Edge 原生助手兼容：Native Host 安装脚本新增 `-ExtensionId` 参数，允许把 Edge 当前扩展 ID 写入 `allowed_origins`，并补充 Edge 复测说明。
- 重做设置页平台说明：改为"云枢 / 氚云"双标签，平台规则、推荐流程分开展示；控件类型参考改为氚云专属，并按 `FromCode.md` 样例整理氚云控件类型。
- 收敛氚云弹窗抓取入口：保留"一键抓取写入"和前后端回写按钮，移除控件信息、前端代码、后端代码的单独抓取按钮。
- 修复氚云前端代码抓取写入仍读到模板 model 的问题：多个 JS model 同时命中时不再取最长内容，改为按容器挂载、Monaco 版本号、创建顺序和长度评分，优先读取用户当前编辑后的 model。
- 修复前端代码抓取仍写入 C# 代码的 bug：JS 正则中的 `GetValue`/`SetValue`/`OnLoad` 等 API 同时出现在 C# 代码中导致误匹配。改为先排除 C# 特征（`using System`/`namespace`/`public class`）再匹配 JS 特征。
- 再次恢复一键抓取写入：并行抓取控件信息 + 前端 JS + 后端 C#，未挂载项标注跳过，design.md 仅首次创建。
- 再次移除一键抓取写入（前端/后端/控件各自独立操作）。
- 控件信息抓取写入时自动新建 `design.md`（用户设计/任务模板），已存在时保留不覆盖。

## 2026-05-28

- 将扩展对外名称调整为"开发助手"，弹窗新增"云枢 / 氚云"平台标签；现有前端抓取写入、前端回写、业务规则抓取写入、业务规则回写仍归属云枢标签。
- 新增平台识别：`h3yun.com` 及其子域名识别为氚云，并使用独立 `h3yun-form` / `h3yun-default` 页面类型，避免氚云 URL 中的 `form-design` 误走云枢表单逻辑。
- 新增氚云页面探测入口：读取页面标题、地址、hash 参数、`appcode`、对象 ID、`isBeta`、框架线索和 DOM 命名线索，并支持复制探测上下文；该入口不执行抓取或回写。
- 为云枢抓取 / 回写增加平台守卫：当前页面识别为氚云时直接提示使用氚云探测，避免复用尚未验证的云枢 `data.codes` / Monaco 假设。
- 扩展氚云抓取能力：新增一键抓取写入、控件信息抓取写入、前端 JS 抓取 / 回写、后端 C# 抓取 / 回写。图形控件读取 `.designer.web .control-container[data-code]`，前端读取 `#jsText`，后端读取 `#csText`。
- 新增氚云文件命名规则：后端优先使用 C# 类名生成 `.cs` 文件，前端使用 URL `id` 生成 `.js` 文件，控件信息写入 `FromCode.md`。

## 2026-05-20

- 修复目标目录重选后的默认继承逻辑：新增页面级目录快照，重选目录会影响当前页面和后续新页面，不覆盖已打开页面。
- 新增 `background.js` 在扩展启动时为已打开标签页建立基线快照，并监听后续标签页生命周期。
- 调整前端抓取写入文档生成：`README.MD` 不再写入编码类字段，应用/表单/控件/子表编码改写入 `FromCode.md`。

## 2026-05-21

- 增强前端 HTML 控件解析：当下拉框、单选框控件存在 `data-options` 且 `optionsType=custom` 时，`FromCode.md` 会在对应控件下新增"控件选项"，优先写入 `name_i18n.zh` 的中文值。
- 调整前端抓取写入的 README 策略：`README.MD` 在抓取时若缺失会自动补建，已存在时保留已有人工内容，只继续同步 `FromCode.md`。
- 增加业务规则单页限制提示：设置页、README 与架构文档明确"同一页面同时只支持一个业务规则编辑器"。
- 调整业务规则回写诊断：页面检测到多个业务规则 model 时会直接阻止抓取 / 回写；若目录中找不到目标 `.java` 文件，会额外提示优先检查是否因为同页多开业务规则导致命中错误文件。
- 弹窗新增可折叠的当前路径面板：摘要和最近路径只展示最终目标文件夹名称，仍支持按绝对路径复制完整路径、点击历史路径直接切换，并允许单条移除历史记录而不影响当前目录绑定。
- 增强 `FromCode.md` 的控件元数据：新增控件类型字段；单选框、复选框、下拉单选框、下拉多选框会提取控件选项；关联单选、关联多选会输出并保留"关联表单编码 / 关联表单名称"。
- 设置页新增控件类型参考区：直接展示 HTML 标签、中文控件类型、示例字段名和特殊说明，便于核对抓取结果。
- 重写设置页说明内容：将重点更新为目录快照、最近路径、README / FromCode 生成策略、业务规则单页限制，并补充推荐流程与常见排查。
- 调整设置页信息架构：移除"当前版本重点"区块，新增左侧快速导航，支持直接跳转到应用路径、内置规则、控件参考、推荐流程、常见排查和运行状态。
- 继续精简设置页文案：移除页首、应用路径、内置规则、推荐流程与常见排查的说明段落，只保留导航、标题、配置项和具体内容。
- 修复关联控件旧值保留串值问题：主表与子表即使复用了同一个控件编码，也会按作用域分别保留旧的关联表单编码 / 名称。
- 调整旧 `FromCode.md` 读取失败的容错策略：读取旧文档失败时不再让整次前端抓取写入报失败，只退化为不保留旧值。
