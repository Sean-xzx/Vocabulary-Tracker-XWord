# Verification / 验证记录

Application version: **0.4.1**. Publication preparation date: **2026-10-08**.
This is functional verification, not a memory-learning study, security certification or a benchmark guarantee.
软件版本 0.4.1。以下是功能验证，不是记忆效果研究、安全认证或通用性能承诺。

## Local baseline / 本地原项目对照

Environment: Windows 11 x64 build 26200, Node.js 22.23.2, npm 10.9.8, Git 2.55.0.
Before publication edits, the existing application passed:

| Command             | Observed result / 实际结果                                       |
| ------------------- | ---------------------------------------------------------------- |
| `npm run typecheck` | Passed both main/web checks / 两套类型检查通过                   |
| `npm run test`      | 29 files, 213 tests passed / 全部通过                            |
| `npm run lint`      | Exit 0, one existing PDF Hooks warning / 通过，有一条原有警告    |
| `npm run e2e`       | 72 real-window scenarios passed, 0 failures / 真实窗口 72 项通过 |

The E2E suite exercises empty-library entry, 27-word pagination, dictionary senses, grading,
retries, undo, rapid keyboard input, library filtering/deletion/recovery, EPUB import/collection,
highlights, original-source jumps, PDF text and zoom, scanned-PDF rejection, restart persistence,
timezone changes and pronunciation controls. It uses isolated synthetic data and local service mocks.

场景覆盖空库录入、分页、选义、评分、重现、撤销、快速键盘操作、词库管理、阅读收词、
高亮、出处跳转、PDF、重启恢复、时区变化和朗读控件；使用隔离合成数据和本地模拟服务。

Local `npm run build` compiled the application and assembled the unpacked executable, but NSIS
installer generation failed: Windows reported **"An Application Control policy has blocked this file"**
when the tool tried to execute its temporary uninstaller generator. No system policy was changed.
This is not recorded as a successful local installer build. The original installer is retained from
the pre-edit backup; fresh packaging is checked separately by Windows CI.

本地构建完成应用编译及展开程序，但 NSIS 临时生成程序被 Windows 应用控制策略阻止。
未修改系统策略，不把本地打包记为成功；修改前安装包从备份保留，干净打包由 Windows CI 另行验证。

## Evidence and reproduction / 证据与复现

An independent checkout from the published GitHub `main` was installed with `npm ci`.
Repository/resource checks, type checks, 213 unit tests, lint and all 72 window cases passed again.
The README's actual `npm run dev` example was also exercised in that checkout with isolated data:
import `demo.txt`, collect `ability` with one source, grade the first review `3`, jump to the original
sentence, then restart and confirm that the word and grade remain saved.

从已发布的 GitHub main 重新获取独立副本并安装锁定依赖；仓库资源、类型、213 项单元测试、
规范检查及 72 项窗口场景再次通过。另实际启动开发模式，按 README 导入 demo.txt、
收录 ability 与一条出处、首次评分 3、跳回原句，重启后确认单词和评分保留。

Run the commands in [DEVELOPMENT](DEVELOPMENT.md) from a clean checkout after `npm ci`.
Unit tests print their totals. E2E prints `通过 72 项，失败 0 项`; screenshots and performance output
are written under ignored `.test-tmp/`. The [workflow](../.github/workflows/ci.yml) repeats the checks
on a Windows runner and builds the installer. CI outcomes are live evidence in the repository Actions tab.

干净获取代码并安装锁定依赖后执行开发文档命令。测试输出计数；截图与性能输出在被忽略的临时目录。
Windows 工作流会重复验证并打包，实际远程结果以 Actions 页面为准。

[Home](images/home.png), [notebook](images/wordbook.png) and [reader](images/reader.png) screenshots
were captured from the baseline E2E run with synthetic data. They are representative states,
not the exact expected state of a new empty installation or the minimal demo text.

截图来自原项目此次真实窗口测试，使用合成数据，是代表性状态，不是首次启动或最小示例的逐字一致结果。

## Known warnings / 已知警告

- `PdfPages.tsx`: existing `useLayoutEffect` missing-dependency warning for `domPoint`; no core change made.
- Vite reports that pdf.js is both dynamically and statically imported; it stays in the main renderer bundle.
- Node reports implicit module-type detection for TypeScript PDF fixtures; tests still pass.
- Windows installers are unsigned. Build timestamps/tool output can change installer hashes.

上述警告如实保留；没有为了清除提示修改核心代码。不把警告当作失败，也不隐瞒它们。

## Not verified / 未验证

- Live DeepSeek answers, billing and external Gutenberg downloads: local mocks were used, no paid request made.
- Human listening quality or voice availability on other machines: control tests simulate speech events.
- macOS/Linux, ARM Windows, OCR/scanned PDFs, protected books and cloud sync: unsupported or unverified.
- Strict binary-identical installers and long-term memory outcomes: no such claim or experiment.

未验证真实收费服务、其他电脑的实际听感、其他平台以及严格字节一致性；没有记忆效果实验。

## Dependency audit / 依赖审计

`npm ci` and `npm audit --json` reported **12 vulnerable dependency entries: 4 high and 8 moderate**
on the preparation date. This count includes transitive/dependent entries, not 12 distinct exploits.
Electron and build-tool dependency chains are involved. The lockfile is preserved; suggested Electron
remediation includes a major-version change, which was not silently applied during documentation publication.
Functional tests passing does not mean these advisories are resolved or that the app is security-certified.

依赖审计发现 12 项受影响依赖记录，含 4 高、8 中；包含传递和关联项，不代表 12 个独立攻击漏洞。
涉及 Electron 和构建工具依赖链。此次保留锁文件，没有擅自进行大版本升级，告警尚未修复。
功能测试通过不代表安全问题已解决。

Reproduce with `npm audit --json`; advisory data changes over time. Examples:
[Electron sandbox advisory](https://github.com/advisories/GHSA-hq2x-r82h-9wj4),
[extract-zip advisory](https://github.com/advisories/GHSA-jmr9-qjv8-65gv).

## CI environment / CI 环境

The first Windows runner passed installation, resources, type checks, unit tests and lint, but
6 window cases failed under its smaller desktop/system animation preferences. The E2E driver
now uses a 1200×800 baseline viewport and explicit normal-motion preference; screenshot overrides
restore that baseline, while the reduced-motion scenario still explicitly tests reduced motion.
No assertion is removed or relaxed. The [subsequent run](https://github.com/Sean-xzx/Vocabulary-Tracker-XWord/actions/runs/37748875455)
passed all 72 window cases and generated the NSIS installer, but failed when electron-builder's
implicit CI publishing requested a release token. The workflow now explicitly passes `--publish never`;
it verifies packaging without publishing a Release or requiring write credentials.

首轮 CI 的 6 项窗口失败暴露了桌面尺寸和动画偏好假设。测试驱动现固定视口与默认动画偏好；
仍保留减少动态效果场景，未删除或放宽断言。上述后续运行的 72 项全部通过，NSIS 安装包已生成，
但构建工具在 CI 下自动尝试发布 Release，因为没有发布凭据而退出失败。
工作流现明确传入 `--publish never`，只验证打包，不发布 Release，也不提供写入凭据。

## Publication integrity / 发布完整性

Existing application source, unit tests, dictionary, icon, original design files and dependency/build configuration
are compared with pre-edit SHA-256 records. Private backups and original local history are not public artifacts.
Resource checksums are in [resources.json](resources.json). Original and public history handling is documented
in [PUBLICATION](PUBLICATION.md).

发布前按修改前 SHA-256 记录核对原有核心文件，窗口测试驱动的环境设置单独记录；
私有备份及原始本地历史不上传。
资源与历史处理分别见清单和发布文档。
