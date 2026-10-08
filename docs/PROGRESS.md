# 进度

## 已完成（v0.1）

- M0（3c461ea）项目初始化；M1（5b3a64a）地基；M2（2c80f25）单词页；M3（52e37f3）今日复习；M4（b1e45c2）设置 + 安装包。

## 已完成（v0.2.0）

- A 清理检查（只读）：D:\WSL 只有一个空子文件夹 Ubuntu-22.04，删除被权限配置拦下，已跳过；~/.wslconfig 早于上一轮（2026-06-11），
  WSL 两个发行版都是 Stopped，均未改动。
- B（a5d0ffc）词典数据：ECDICT 下载与 SHA 校验（npm run dict:fetch）、裁剪生成 resources/dict/ecdict-lite.json.gz
  （npm run dict:build，671,871 条，14.99 MB）、释义解析 / 词形还原 / 考试标签（src/shared/domain/dict.ts）、
  主进程后台加载与二分查询（src/main/dict.ts，IPC dictLookup）、迁移 002 words.phonetic、v0.1 夹具迁移测试、设置页词典来源。
- C（339bf5e）录入时从词典选词义：义项面板、录入行键盘流程、空词义二次确认、批量录入自动填义项、卡片音标。
- D（7a40778）词库页：两栏 + 分隔条、搜索 / 筛选 / 排序 / 窗口化列表、详情编辑、迷你网格、复习历史、回收站、从词典选词义；Toast 避让。
- E（8a4c599）打包版忽略开发开关、electronFuses、NSIS 固定当前用户安装。
- 验证：typecheck、test（118 个）、lint 通过；e2e 38 项全过（搜索 3000 词约 6–12 ms）；截图 10 张（.test-tmp\screens）已自查并修正；
  打包 release\XWord-Setup-0.2.0.exe（109 MB），词典在包内、fuses 生效、安装方式页已去掉（编译期验证）；
  冒烟：打包版迁移 %APPDATA%\XWord 到 user_version 2、数据一致、词典加载 436 ms、日志无错误。
  %APPDATA%\XWord 的冒烟前备份在 .test-tmp\appdata-backup-20260923-221033\。

## 已完成（v0.2.1）

- 一（5853409）业务时区统一为北京时间：dates.ts 集中处理、audit 时区规则、跨午夜定时刷新、迁移 3 校正旧日期（迁移前备份、日志写条数）、
  四种系统时区一致性测试、洛杉矶 / 上海两份夹具。
- 二（e432cc3）新 Logo（XWordMark：default / mono / small / 动画）与应用图标（直接用 design-assets 的文件）。
- 三（7d08e04）界面 v2：设计变量合并、四层表面、侧栏（连续打卡）、PageHead、单词页 / 概览 / 复习中 / 词库 / 设置 / 统计按参考稿。
- 四（8170839）动效：motion 工具（sweep / draw / fadeSlide / flipFrom）、开屏、网格与录入、义项、复习卡片（按键不丢）、浮层、Toast、页面切换等。
- 验证（749aedf）：typecheck、test（126 个）、lint（含时区规则）通过；e2e 42 项全过（20 次连按 300ms 内全部正确写入、减少动态效果走完一轮、
  开屏跳过 1–3ms、开屏不拖慢）；视觉对照截图与四张参考稿逐项核对并修正（.test-tmp\screens、.test-tmp\ref）；
  打包 release\XWord-Setup-0.2.1.exe，fuses 生效；冒烟：%APPDATA%\XWord（空库）迁移到版本 3、改动 0 条、日期与日志正常。
  冒烟前备份在 .test-tmp\appdata-backup-20260924-092311\。

## 已完成（v0.3.0）

- 二（97dbd5c）日期跟随本地系统时间：dates.ts 改为本地时区、渲染进程每次 IPC 附带时区、日期检查（唤醒 / 解锁 / 焦点 / 可见 / 60 秒）、迁移 4、lint 规则、根因回归测试。
- 三（8bff673）图标全部换成 D1：build/icon.ico 与设计稿字节一致，NSIS 三个图标，窗口 icon，AppUserModelId 提前。
- 四 A（58a5354）侧栏两组、今日首页、打卡规则、迁移 5–7；B（c6bb2a7）书架、Gutendex、EPUB / TXT 导入与统一格式；
  C（08ac4b2）阅读页；D（8a24dfd）查词、收词、出处、熟词、高亮与笔记。
- 五（142df2c）DeepSeek 句子翻译（safeStorage、流式、缓存、中文错误）。
- 验证：typecheck、test（177 个）、lint 通过；e2e 61 项全过（原有 42 项 + 阅读器 19 项，mock Gutendex / DeepSeek、可注入时钟、改时区）；
  性能与联网冒烟见 DECISIONS；浅深两套截图（.test-tmp\screens\v3-*）已自查并修正（章节标题衬线、变化形式显示原形义项）；
  打包 release\XWord-Setup-0.3.0.exe，exe / 安装 / 卸载 / 窗口四处图标都是 D1；win-unpacked 冒烟通过。

## 已完成（v0.4.0）

- A（5c7d13e）阅读外壳、翻页与锚点定位：CSS 多栏书页、单双页、翻页键 / 点击 / 滚轮、页码按排版临时算、迁移 8。
- B（2c7b3b1）EPUB / TXT 按原书结构重新解析：两个根因的回归测试、结构与样式白名单、拆章与分组、图片、旧书重新解析与锚点换算。
- C（f2f4a10）PDF 原版页面：导入与扫描版识别、画布 + 文字层、缩放、书签目录、离线的 worker / cMap / 标准字体。
- 验证：typecheck、test（205 个）、lint 通过；e2e 68 项全过（原有用例改成书页选择器 + 新增 EPUB / PDF / 扫描版用例）；
  打包 release\XWord-Setup-0.4.0.exe（111 MB）；win-unpacked 冒烟：迁移 7 → 8、日志无错误（详见 DECISIONS）。
  浅深两套截图（.test-tmp\screens\v4-*）已自查并修正（PDF 文字层字体、章名标题字体）；性能见 DECISIONS。

## 当前状态

- v0.4.1 完成：全软件单词朗读与复习自动朗读。

## 已完成（v0.4.1，2026-10-05）

- 新增共用本地英语朗读服务与按钮，接入阅读查词、词典义项/原形、单词本、录入、批量预览、词库列表/详情/熟词、今日队列、首页收词和复习卡片；原阅读 speech 入口保留转发。
- 复习默认自动朗读，可开关并记住选择；英译中出卡时读，中译英翻面后才读，R 重播；快速切词、跳过、撤销和退出取消旧播放。按钮不误触评分、编辑或选行。未改变目录分层、数据库版本 8、IPC、依赖或复习算法。
- typecheck 通过；29 个测试文件、213 个测试通过（新增语音服务 8 个）；lint 无错误，仅 PdfPages 原有 domPoint 依赖警告；electron-vite 构建通过。
- 完整真实窗口 E2E 72 项通过、0 失败，主进程无 ERROR：包括 4 个语音专项，既有 EPUB/PDF 查词也检查发音文本，PDF 连字符断词读完整单词。浅深语音截图在 .test-tmp/screens/speech-*，已自查。
- 真人听感未验收；另外在无语音替身的隔离开发窗口点击录入行朗读 ability，使用本机 Microsoft David - English (United States)，真实引擎触发 start/end，无播放错误，记录在 .test-tmp/native-speech-result.json。音量、扬声器输出和音质仍需用户试听。
- 安装包 release/XWord-Setup-0.4.1.exe 已生成（111,033,962 字节）；原 0.4.0 安装包保留。检查 app.asar 版本与朗读代码、无测试语音替身、窗口图标与 PDF 资源正确，记录 .test-tmp/speech-package-result.json。本轮未启动或安装打包版：用户已打开的安装版继续运行。测试只用项目内隔离目录，未操作安装版用户数据，也未安装或修改系统语音。

## 下一轮（候选）

- 书籍文件的导出 / 导入与备份；扫描版 PDF（OCR）。
- 统计页（每日复习量、记忆保持率、难词列表；动效规范已写进 ui-spec）。
- 记忆窗口位置与大小（处理多显示器、分辨率变化）。
- lapsed（需要重学）词的重新学习入口（在词库里做）。
