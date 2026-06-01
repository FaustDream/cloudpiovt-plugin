# 开发助手

弹窗按平台拆成“云枢”和“氚云”两个标签。现有抓取写入、回写、业务规则和编辑器打开能力都属于云枢标签；氚云标签独立扫描图形控件、前端 JS 和后端 C#，不会复用云枢抓取逻辑。

## 云枢

![](C:\Users\Lynn\AppData\Roaming\marktext\images\2026-05-15-17-23-11-image.png)

1、点击选择文件存放地址。使用idea开发，方便业务规则和js一起进行开发使用。例如：

目录选择会同时保存为“当前页面快照”和“后续新页面默认值”：重新选择目录后，新打开的页面默认使用新目录，已经打开过并建立快照的旧页面继续使用原目录。

弹窗中的“当前路径”区域支持展开 / 收起。摘要和最近路径都只展示最终目标文件夹名称；展开后仍可按绝对路径方式复制完整路径，并点击最近路径直接切换；移除历史记录只会删除快捷入口，不会清空当前页面已经绑定的目标目录。

【前端抓取写入】会按需补建 `README.MD` 和 `FromCode.md`。`README.MD` 只作为人工说明占位文件，存在时不会覆盖已有内容；`FromCode.md` 会在每次抓取时同步应用编码、表单编码、控件编码、控件类型、子表编码，以及单选框 / 复选框 / 下拉单选框 / 下拉多选框从 `data-options` 提取出的中文控件选项。遇到关联单选、关联多选控件时，还会额外保留“关联表单编码 / 关联表单名称”两行，方便继续补充。

设置页新增了“控件类型参考”，会展示常见 HTML 标签、对应中文控件类型、示例字段名和特殊说明，便于核对 `FromCode.md` 中的“控件类型”输出。

2、【前端抓取写入】需要在【在线开发】页面上使用。

3、【前端抓取写入】也可以抓取【视图设计】的代码，但是需要在【视图设计】的在线开发页面。

4、【业务规则抓取写入】需要在业务规则开发页面进行使用，一次只能抓取一个业务规则代码。

同一页面同时只支持一个业务规则编辑器；若同时打开了多个不同表单或多个业务规则，请先关闭多余业务规则后再抓取或回写。若日志提示当前文件夹没有对应的 `.java` 文件，也请优先检查是否命中了错误的业务规则页面。

![](C:\Users\Lynn\AppData\Roaming\marktext\images\2026-05-15-17-31-41-image.png)

![](C:\Users\Lynn\AppData\Roaming\marktext\images\2026-05-15-17-32-01-image.png)

## 氚云

氚云和云枢设计器结构不同，当前不会复用云枢的 `data.codes` 或 Monaco 业务规则抓取逻辑。打开氚云表单设计器后，可在“氚云”标签执行“页面探测”，插件会读取页面地址、hash 路由参数、`appcode`、对象 ID、`isBeta`、框架线索和少量 DOM 命名线索。

氚云一键抓取会扫描当前已挂载的三类区域：图形设计页 `.designer.web .control-container[data-code]` 写入 `FromCode.md`，前端代码编辑器 `#jsText` 写入同表单 ID 的 `.js` 文件，后端代码编辑器 `#csText` 写入 C# 类名对应的 `.cs` 文件。弹窗不再提供控件、前端、后端的单独抓取按钮，统一通过一键抓取写入；前端和后端仍保留独立回写按钮。若某个区域是懒加载且当前未挂载，一键抓取会跳过该项并写入已抓到的内容。

## Edge 原生助手

Edge 使用本扩展时也需要注册 Native Messaging Host。默认安装脚本会同时写入 Chrome 和 Edge 注册表项：

```powershell
pwsh .\scripts\install-native-host.ps1 -Browser all
```

如果 Edge 中显示“原生助手未连接”，先在 `edge://extensions` 打开开发人员模式，复制当前扩展 ID，然后重新安装并把 Edge 的扩展 ID 传给脚本：

```powershell
pwsh .\scripts\install-native-host.ps1 -Browser edge -ExtensionId <Edge扩展ID>
```

脚本会把 manifest key 推导出的 ID 和手动传入的 Edge ID 一起写入 `.native-host/com.cloudpiovt.editor_helper.json` 的 `allowed_origins`。
