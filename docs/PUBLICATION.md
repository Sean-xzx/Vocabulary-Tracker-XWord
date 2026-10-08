# Publication / 发布整理

## Scope / 范围

Publish the existing XWord 0.4.1 application as **Vocabulary-Tracker-XWord**.
Preserve existing application source, unit tests, resources, application identity and core data byte for byte.
Documentation, publication checks and CI are added. The E2E driver fixes its viewport and normal-motion
baseline so existing assertions also run on a smaller CI desktop; application behavior is unchanged.

将现有 XWord 0.4.1 以 Vocabulary-Tracker-XWord 仓库名发布；保留软件名称、核心源码、单元测试和资源。
窗口测试驱动固定测试视口和动画基准，以适配较小的 CI 桌面，不改变应用行为。

## Recovery and history / 恢复与历史

A private snapshot and Git bundle were created before changes. Their location is recorded in
the ignored `.test-tmp/publication-backup-location.txt`. Dependencies and compiled `out/` are
reproducible and excluded from that snapshot; original release results, raw dictionary,
Git metadata and previous test materials are preserved.

The original local `master` history is retained. The initial public `main` is a current-version
snapshot with a GitHub noreply identity, avoiding publication of personal commit email metadata.
No existing remote history is overwritten, and no force push is used.

修改前已建立私有文件快照和 Git bundle。恢复位置保存在被忽略的记录文件中，备份不上传。
原有 master 历史保留，公开 main 从当前版本快照开始，不公开个人提交邮箱，不强推。

Private assistant settings and prompt-context packaging stay local and are excluded from the
public tree. Maintained source, tests, design references, historical project notes and required
dictionary resources remain in the public tree. Generated dependencies, logs, books, backups,
test data and installers are not published as source files.

## Owner update procedure / 所有者更新步骤

These instructions do not grant anyone permission to use or modify the software.
Only the owner or a separately authorized person may follow the development procedures.

```powershell
git switch main
git pull --ff-only origin main
npm ci
npm run typecheck
npm run test
npm run lint
node scripts/verify-repository.mjs
npm run e2e
npm run build
git status --short
# Stage only reviewed files; never add .test-tmp, user data, secrets or dependencies.
git add README.md README.zh-CN.md docs .github scripts/verify-repository.mjs .gitignore .nvmrc NOTICE.md THIRD_PARTY_NOTICES.md
git commit -m "docs: update project documentation"
git push origin main
```

For intentional, separately authorized functional changes, review and stage the relevant source
files explicitly after meaningful tests. Do not publish the retained private `master` history.
Before any future public push, inspect both the staged files and new commit history.

上述命令面向所有者或另获授权者，不构成使用或修改许可。未来发布前检查实际文件和新增提交历史；
不要推送保留的私有 master，不要提交用户数据、备份和凭据。

See [verification](VERIFICATION.md), [architecture](ARCHITECTURE.md) and [rights](../NOTICE.md).
