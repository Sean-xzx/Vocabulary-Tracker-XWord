# Development / 开发与运行

These instructions are for the owner or separately authorized users. They do not grant a license.
以下说明供所有者或另获授权者使用，不构成许可。见 [NOTICE](../NOTICE.md)。

## Environment / 环境

Verified locally: Windows 11 x64 (build 26200), Node.js 22.23.2, npm 10.9.8 and Git 2.55.0.
Use a normal PowerShell terminal from the repository root. `.nvmrc` records the tested Node version;
it does not install Node. `npm ci` uses the unchanged lockfile and installs project-local dependencies.
No global npm packages or external database server are required.

本地验证环境如上。命令在仓库根目录的 PowerShell 执行；.nvmrc 只是版本记录。
npm ci 按锁文件安装项目依赖，无需全局 npm 包或独立数据库服务。

```powershell
npm ci
node scripts/verify-repository.mjs
npm run dev
```

`npm run dev` starts the Chinese desktop UI. First startup creates an empty local database and
loads the included dictionary in the background. Import `docs/examples/demo.txt` from the bookshelf,
then click `ability`, select a sense and collect it. The notebook and library should contain the word;
its source sentence should navigate back to the book. Review and restart to verify persistence.

开发命令打开中文桌面界面，首次启动自动建库并后台加载词典。
导入附带 demo.txt，收集 ability；单词本和词库应有记录，出处应能跳回原文。
完成一次复习并重启后，应保留记录。

## Commands / 命令

| Command                              | Purpose / 用途                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `npm run dev`                        | Development UI with hot reload / 开发窗口                                           |
| `npm run typecheck`                  | Main/preload/shared and UI type checks / 类型检查                                   |
| `npm run test`                       | Node-based unit tests / 单元测试                                                    |
| `npm run lint`                       | ESLint plus color, emoji and date-rule checks / 规范检查                            |
| `node scripts/verify-repository.mjs` | Published files, links, bilingual commands and resource hashes / 发布内容与资源校验 |
| `npm run e2e`                        | Build then test a real Electron window with isolated data / 构建并测试真实窗口      |
| `npm run build`                      | Build and package Windows x64 NSIS installer / 打包安装程序                         |
| `npm run start`                      | Preview already compiled output / 预览编译结果                                      |
| `npm run icon`                       | Copy the original ICO byte for byte / 原样复制图标                                  |
| `npm run dict:fetch`                 | Optional upstream dictionary download / 可选词典下载                                |
| `npm run dict:build`                 | Optional dictionary rebuild / 可选词典重建                                          |

Tests do not initialize your normal learning database: unit tests use fixtures and E2E writes under
`.test-tmp/e2e-*`. E2E mocks Gutenberg/Gutendex and DeepSeek; it does not require an API key.
Window tests need a desktop session and a free localhost debugging port. They may take several minutes.

测试使用夹具或隔离目录，不写正常学习数据库；AI 和找书使用模拟服务。
窗口测试需要桌面会话和可用本地端口，可能耗时数分钟。

## Resources / 资源

The compressed ECDICT is already committed: 671,871 entries, 14,999,974 bytes.
[resources.json](resources.json) pins its SHA-256 and the application icon hash.
The upstream MIT license is preserved at [ECDICT-LICENSE.txt](../resources/dict/ECDICT-LICENSE.txt).
The dictionary is read-only; user vocabulary is stored separately.

压缩词典已提供，无需首次运行时下载；资源清单记录校验值，第三方 MIT 许可证保留。
只读词典与用户词库分开。

Normal reproduction uses the committed dictionary. Optional updates use:

```powershell
npm run dict:fetch
npm run dict:build
```

These commands fetch upstream `master`, which can change: they are maintenance operations, not a
guarantee of reproducing the committed file. The downloader checks upstream Git blob hashes when
the official API is available; otherwise it warns and only checks CSV headers/sample words.
Review provenance and refresh the resource manifest before publishing any update.

这两个命令会获取可变化的上游 master，用于维护，不保证重建当前词典的相同字节。
官方 API 不可用时，下载器会警告并退化为表头与词条抽查，不能当作完整校验。

PDF character maps/fonts are installed with the locked `pdfjs-dist` dependency and copied into
the installer; the worker is bundled. No separately downloaded model or training dataset is needed.
The included demo text and automated book fixtures are synthetic. User books are not published.

PDF 字体与字符映射来自依赖并随安装包分发；无需模型和训练数据。
示例与测试书籍为合成内容，不发布用户书籍。

## Configuration and data / 配置与数据

- Development data: `%APPDATA%\XWord-dev`; installed app: `%APPDATA%\XWord`.
- The database is `xword.db`; book files are under `books/`; logs are `xword.log`.
- Set theme and daily new-word limit in the Settings page. Default new-word limit is 20, range 5–100.
- Set the optional DeepSeek key in Settings → AI translation, not in an `.env` file.
  It is encrypted using Electron safeStorage; model settings are managed in the UI.
- A local English voice is required for pronunciation. Voice availability and sound vary by system.
- Back up the whole user-data directory for complete recovery. Daily automatic backups cover only SQLite.

开发与安装版数据分开。主题、新词上限和 AI 在设置页配置；不提交 .env 或真实密钥。
朗读取决于本地英语音色。完整备份应包含整个用户数据目录。

Installation needs network access to npm/Electron mirrors configured in `.npmrc`.
The local core then works offline. Book discovery/download uses Gutendex/Gutenberg;
AI uses DeepSeek and may incur charges. Neither optional service is required for the demo or tests.
Test-only service URLs/data overrides are disabled in packaged builds.

依赖安装需联网，本地核心之后可离线。找书和 AI 是可选联网能力；AI 可能产生费用。
发布验证没有调用收费接口，打包版禁用测试覆盖开关。

## Packaging and troubleshooting / 打包与常见问题

On machines with restrictive Windows Application Control, NSIS packaging may be blocked when
electron-builder runs its temporary uninstaller generator. That occurred on the preparation machine;
do not disable system security to work around it. Check the Windows CI result for a separate build.

严格的 Windows 应用控制可能阻止 NSIS 临时程序，准备机器发生了此限制。
不要为此关闭系统安全控制；另行查看 Windows CI 打包结果。

`npm run build` produces `release/XWord-Setup-0.4.1.exe`, with current-user installation and a
selectable install location. Uninstall preserves app data. The installer is unsigned, so Windows may
show a reputation warning. Installer bytes may differ across builds; functional reproduction is the goal.

安装包按当前用户安装，允许选择目录，卸载保留数据。未签名，Windows 可能提示信誉警告。
构建复现指功能和资源，不保证安装包字节完全相同。

- **Window does not start:** inspect the terminal and the applicable `xword.log`; confirm the Node version
  and successful `npm ci`. Only one XWord instance may access each data directory.
- **PowerShell blocks npm.ps1:** use `npm.cmd` for the same commands; no system policy change is required.
- **Dictionary loading:** wait for background loading; run the repository check for missing/corrupt resources.
- **No sound:** check the OS local English voices and audio output. Tests of control events are not a listening test.
- **PDF cannot be imported:** image-only scans/OCR and protected books are unsupported; use a text-bearing PDF.
- **AI fails:** configure a valid key and check provider/network availability; do not post credentials in Issues.

窗口问题查看日志并确认环境；PowerShell 脚本策略限制时可用 npm.cmd，无需改系统策略。
无声检查本地音色与输出；扫描 PDF 暂不支持；AI 错误先检查配置，反馈时不附密钥。

See [verification](VERIFICATION.md) for known warnings and [publication](PUBLICATION.md) for owner updates.
