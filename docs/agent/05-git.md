# Git 与发布规范

## 工作区

开始任务前：

```bash
git status --short --branch
```

先区分：

* 用户已有未提交修改。
* 当前任务修改。
* 生成文件。

不得覆盖、撤销、格式化或提交与当前任务无关的用户修改。

修改前确认目标文件是否已被修改。

禁止未经授权使用：

```bash
git reset --hard
git checkout --
git clean -fd
```

避免执行可能丢失用户修改的命令。

## 变更范围

* 默认只修改完成当前任务所必需的文件。
* 发现与当前任务无关的问题时记录问题，不顺手修改。
* 重构应服务于当前需求。
* 不以“顺便优化”为由扩大修改范围。

涉及以下内容时才扩大变更范围：

* 跨模块契约。
* 存储 schema。
* 目录 scope。
* Manifest 权限。
* 版本发布。
* 构建入口。

扩大前确认：

* 受影响文件。
* 数据迁移影响。
* 兼容影响。
* 验证命令。
* 不改动边界。

## Commit

* 每次完整改动完成并通过必要验证后创建 Git commit。
* 高风险修改前，先提交已验证版本作为回滚点。
* 每个 commit 对应一个完整、可独立回退的逻辑变更。
* 避免混入无关修改。
* 使用 Conventional Commit：

```text
feat
fix
refactor
style
test
docs
chore
perf
```

## 暂存

只暂存本次任务相关文件。

提交前检查：

* 无无关文件。
* 无临时文件。
* 无敏感信息。
* 无错误生成物。

## Push / PR / Release

未经用户授权：

* 不执行 `git push`。
* 不创建 PR。
* 不创建 GitHub Release。
* 不修改远端权限。
* 不执行其他对外发布操作。

获得授权后，按照项目实际发布流程执行。

版本发布至少核对：

```text
manifest.json
package.json
package-lock.json
构建产物
发布压缩包
Git tag
```

版本号、锁文件和发布说明不一致时，不宣称已发布。
