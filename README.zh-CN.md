简体中文 · [English](README.md)

# Vocabulary-Tracker-XWord

**把英文阅读、收词和定期复习连接起来的 Windows 桌面软件。**
软件名称保留为 **XWord**，本仓库展示 **0.4.1** 版本。

## 项目价值

查到一个词不难，保留它的语境并在之后复习更难。
XWord 把书籍、原句和复习记录连接在本地工作流里：
**阅读 → 收词 → 复习 → 回到书中再次遇见**。
这是面向英文阅读和单词练习的个人软件项目，界面使用中文。

## 项目贡献

我的实现工作基于 Electron、React 和 TypeScript，把以下功能连接成桌面产品：

- EPUB/TXT 阅读和可选择文字的 PDF 支持，包括翻页、高亮和笔记。
- 离线查词、义项选择、保留原句的收词，以及跳回书中出处。
- 每页 27 词的单词本网格与定期复习：拖欠、重现、撤销和难词标记。
- 共用本地英文朗读、可选流式翻译、本地保存与 Windows 安装包。

这些实现体现了桌面与界面开发、文档解析、业务规则建模、跨进程校验和自动验证能力。
这里的贡献指软件实现；没有宣称提出新的学习算法，也没有实验验证记忆保持率提升。

## 关键方法

- **稳定阅读定位：**EPUB/TXT 使用正文锚点；PDF 注释使用归一化页面坐标，缩放后保持位置。
- **规则与存储分离：**纯函数计算复习结果，主进程校验并保存。
- **区分两套队列：**今日任务从记录生成，本轮重现不覆盖正式复习结果。
- **受控文档处理：**导入内容转换为受控结构，联网和文件访问集中在主进程。

[架构与数据流](docs/ARCHITECTURE.md)说明了模块关系和存储边界。

## 成果证据

发布准备期间，未改动的应用在 Windows 上通过 **29 个测试文件中的 213 项单元测试**，
以及 **72 项真实窗口场景**：收词、评分与撤销、EPUB/PDF 阅读、注释、数据恢复和朗读控件。
AI 与网络场景使用本地模拟服务；朗读控件测试不能证明实际听感。
具体命令与边界见[验证记录与限制](docs/VERIFICATION.md)。

![XWord 单词本与朗读控件](docs/images/wordbook.png)

[阅读截图](docs/images/reader.png) · [首页截图](docs/images/home.png)

截图来自运行中的软件和合成测试数据，不是静态设计稿。

## 快速开始

**使用条件：**仓库公开供查看，原创项目保留所有权利，没有开源许可证，也未授予使用或修改许可。
以下命令供所有者及另获授权者使用。使用前阅读[权利声明](NOTICE.md)。

已验证：**Windows 11 x64、Node.js 22.23.2、npm 10.9.8、Git 和 PowerShell**。
本地核心不需要 Python、Rust、C++ 工具链、API key 或数据库服务器。
窗口测试需要可交互桌面；其他平台尚未验证。

```powershell
git clone https://github.com/Sean-xzx/Vocabulary-Tracker-XWord.git
cd Vocabulary-Tracker-XWord
npm ci
node scripts/verify-repository.mjs
npm run dev
```

预期：打开中文 XWord 窗口并进入首页，首次使用没有书籍和单词。
词典已随仓库提供，软件自动初始化数据库。

**最小示例：**在书架导入 [demo.txt](docs/examples/demo.txt)，打开后点击 `ability`，
选择义项并收词。应得到一个带原句与出处的单词，点击出处能跳回原文。
开始今日复习、显示答案并评分，应产生第 1 遍记录；重启后确认数据仍在。
朗读需要系统提供本地英文音色。

## 开发与复现

```powershell
npm run typecheck
npm run test
npm run lint
npm run e2e
npm run build
```

预期：检查成功、窗口测试 `72` 项通过，并生成 `release/XWord-Setup-0.4.1.exe`。
安装包未签名，不保证构建产物逐字节一致。
[Windows CI](.github/workflows/ci.yml)执行上述检查及仓库和资源校验。
数据路径、隔离测试、可选 DeepSeek 配置和联网要求见[开发与常见问题](docs/DEVELOPMENT.md)；
[资源清单](docs/resources.json)记录校验值。

## 项目结构

| 路径                      | 职责                                               |
| ------------------------- | -------------------------------------------------- |
| `src/main/`               | 启动、IPC 校验、数据库、书籍、词典、联网与加密密钥 |
| `src/preload/`            | 类型化的 window.xword 桥接                         |
| `src/shared/`             | API 类型、复习、日期和文档文本算法                 |
| `src/renderer/src/`       | React 功能页、Zustand 状态、公共控件与朗读         |
| `scripts/`                | 窗口测试、词典工具、仓库及设计检查                 |
| `resources/`、`build/`    | 词典及许可证、Windows 打包资源                     |
| `docs/`、`design-assets/` | 文档、示例、证据与设计参考                         |

运行入口：[主进程](src/main/index.ts)、[预加载](src/preload/index.ts)、
[界面](src/renderer/src/main.tsx)。协作过程见[架构说明](docs/ARCHITECTURE.md)。

## 状态与限制

个人项目，不承诺发布周期或服务等级。统计页面是占位页。
暂未实现扫描 PDF/OCR、DRM 书籍、云同步和自动更新。
英文音色是否可用取决于系统。此次发布未重新验证真实 DeepSeek 计费与回答、真实 Gutenberg 下载；
DeepSeek 可能向你的账户收费。每日备份只包含数据库，不包含书籍及全部偏好。
原有 PDF Hooks 及构建、运行警告见[验证记录](docs/VERIFICATION.md)。
严格的 Windows 应用控制可能阻止本地 NSIS 打包。
现有依赖审计报告 12 项受影响记录（4 高、8 中），尚未修复。

通过 [Issues](https://github.com/Sean-xzx/Vocabulary-Tracker-XWord/issues)反馈可复现问题，
不要附密钥、私人书籍和学习数据库。授权申请联系 [Sean-xzx](https://github.com/Sean-xzx)。
反馈问题不构成修改许可。

## 权利与致谢

原创材料**保留所有权利，不添加开源许可证**。
GitHub 平台的查看与 fork 权利仍适用，公开可见性无法阻止复制。
第三方许可证完整保留，包括随附 ECDICT 的 MIT 声明。
参见[权利声明](NOTICE.md)、[第三方来源](THIRD_PARTY_NOTICES.md)、
[版本记录](docs/CHANGELOG.md)和[设计决定](docs/DECISIONS.md)。
