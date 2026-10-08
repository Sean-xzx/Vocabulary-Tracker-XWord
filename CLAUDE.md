# XWord

XWord = 英文原著阅读器 + 艾宾浩斯单词本（两部分并列），闭环：读 → 收 → 背 → 再读时遇见。单词本是纸质单词本的软件版：
按页录入，用检查格网格记录第1遍、1天、2天、6天、14天、30天的复习。Windows 桌面软件，只依赖 Node.js（不需要 Rust / C++），
除找书（Gutendex / Gutenberg）和 AI 翻译（DeepSeek）外完全离线。
界面全部中文；代码标识符用英文；和用户用中文交流。

## 技术栈与依赖白名单
- Electron + electron-vite（react-ts 模板）+ electron-builder（NSIS，x64，currentUser）
- React（模板自带版本，不降级）+ TypeScript strict；纯 CSS + CSS 变量（不用 Tailwind / CSS-in-JS，不加载网络资源）
- 数据库 sql.js（WASM SQLite，无原生模块）
- 运行时只允许：模板自带 + sql.js、lucide-react、@floating-ui/react、zustand、fflate（解压 EPUB）、pdfjs-dist（legacy 版，渲染 PDF）；
  HTML 结构优先在渲染进程用 DOMParser 解析（只读结构，不执行、不插入），必须在主进程解析时才可加 htmlparser2（记原因）
- 开发只允许：模板自带 + vitest、@types/sql.js、eslint 系、prettier、pdf-lib（只用来生成测试夹具）
- 其他依赖一律不加；确实需要时先写进 docs/DECISIONS.md 说明理由

## 目录
- `src/main/` 主进程：`window.ts`、`ipc.ts` 通道注册、`validate.ts` 参数校验、`log.ts`、`dict.ts` 词典与原形、`clock.ts` 时钟与时区、
  `net.ts` 联网白名单与超时、`ai.ts` DeepSeek、`secret.ts` safeStorage、
  `books/`（store 正文存储、importer 导入与重新解析、images 图片与 SVG 清理、pdfAssets、gutendex）
- `src/main/db/` `connection.ts`（sql.js、事务、原子落盘）、`migrations/`、`repository.ts`、`backup.ts`、`sample.ts`
- `src/preload/` contextBridge 暴露 `window.xword`（每次调用附带当前时区）
- `src/shared/api.ts` IPC 类型、通道与事件白名单；`src/shared/snapshot.ts` 快照派生
- `src/shared/domain/` 纯函数：dates、scheduler、queue、pages、parse、grid、dict、streak、book（统一格式）、epub、css（原书样式白名单）、
  txt、heading、tokenize、words（点词取句）、pagination（分页）、anchors（旧锚点换算）、pdf（均有测试）
- `src/renderer/src/` styles/design.css（设计变量唯一来源）、styles/base.css、components/ui.tsx、components/brand/、lib/（clock、dayWatch、lemmas）、
  features/{home,shelf,reader,highlights,today,wordbook,library,stats,settings}、store/（zustand）；
  reader/ 是外壳 ReaderView + 两个书页引擎：EpubPages（CSS 多栏一栏一页）、PdfPages（pdf.js 画布 + 文字层），接口见 engine.ts
- 书的正文：userData/books/<id>/（meta.json、toc.json、chapters/0001.json、images/、原文件 source.epub|txt|pdf），不进数据库、不参与每日备份；
  位置、高亮、出处一律存锚点（章节 + 块 + 偏移；PDF 是页 + 页内偏移），页码只按当前排版临时算
- 图标（D1）唯一依据 `design-assets/icon/`：`npm run icon` 把 app-icon.ico 原样复制成 `build/icon.ico`（字节一致，不重画、不重新生成）；
  exe、安装 / 卸载程序、快捷方式、窗口（开发 build/icon.ico，打包 resources/icon.ico）都用它
- `docs/` PLAN.md、PROGRESS.md、DECISIONS.md、CHANGELOG.md、ui-spec.md；`scripts/` audit.mjs、render-icon.mjs、e2e.mjs、dict-*.mjs
- 词典：`vendor/ecdict/`（下载的 ECDICT 原始 CSV，不进 git）→ `resources/dict/ecdict-lite.json.gz` + 许可证（进 git，打包进安装包）

## npm 脚本
- `dev` 开发窗口（数据在 %APPDATA%\XWord-dev）；`build` = electron-vite build + electron-builder --win → release/
- `typecheck`、`test`（vitest run）、`lint`（eslint + scripts/audit.mjs 色值/emoji 检查）、`icon`、`format`
- `e2e`：构建后用 CDP 驱动真实窗口跑键盘流程（scripts/e2e.mjs + e2e-reader.mjs，mock Gutendex / DeepSeek 在 e2e-fixtures.mjs，
  PDF / 结构化 EPUB 夹具来自 src/shared/domain/testing，数据、截图、perf.json 在 .test-tmp）；改界面后要跑；E2E_ONLY=v3 只跑阅读器用例
- `dict:fetch` 下载 ECDICT 到 vendor/ecdict 并校验；`dict:build` 生成精简词典（只在更新词典时用）

## 进程与安全（不许放松）
- 渲染进程专用的库（react、lucide-react、@floating-ui/react、zustand、pdfjs-dist）放 devDependencies，Vite 会打进 out/renderer；
  dependencies 只放主进程运行时要的（sql.js、@electron-toolkit/utils），否则会被整包装进安装包
- 数据库只由主进程访问；渲染进程只能用 preload 暴露的类型化 API（类型在 src/shared/api.ts）
- webPreferences：contextIsolation true、nodeIntegration false、sandbox true；preload 自己用 contextBridge 写
- 严格 CSP，只加载本地资源；禁止页面跳转、新窗口、webview；拒绝所有权限请求
- IPC 只注册白名单通道，校验调用方页面，主进程校验每个参数（src/main/validate.ts）
- 单实例锁（sql.js 整库在内存，双开会互相覆盖）；生产环境 Menu.setApplicationMenu(null)、禁用开发者工具
- 每次写操作一个事务；提交后导出整库，先写 .tmp 再重命名；PRAGMA user_version 管迁移（已发布的迁移不改）
- 每天第一次启动备份到 userData\backups\xword-YYYY-MM-DD.db，保留 7 份（只备份数据库，书籍文件不备份）
- 联网只在主进程，只许 gutendex.com、www.gutenberg.org（含 Gutendex 给的 gutenberg.org 下载地址）、api.deepseek.com；
  每个请求都有超时，失败给出明确中文错误；渲染进程 CSP 只允许本地资源，只放宽了 worker-src 'self' blob:、img-src 'self' blob: data:
- shell.openExternal 只开 https，且只限白名单：Standard Ebooks、Project Gutenberg、Calibre 官网、DeepSeek 开放平台
- 导入的书一律不可信：不把原始 HTML 插进页面，只提取文本结构、用 React 渲染成文本节点；SVG 图片先清理，清不干净不显示；
  书内链接只做书内跳转，外链不可点；单个文件 ≤ 200MB，解压后总计 ≤ 500MB，压缩包条目数有上限（防压缩炸弹）
- DeepSeek API key 用 safeStorage 加密保存；不进数据库明文、git、日志、报错；保存后不回传渲染进程（只告诉“已设置 / 未设置”）
- 测试开关（mock 服务地址、可注入时钟、XWORD_USER_DATA、ELECTRON_RENDERER_URL、远程调试端口等）只在 !app.isPackaged 时生效

## 安全边界（全程遵守）
- 只在 XWord 文件夹内新建/修改/删除文件；可运行 npm、npx、node、git；可读 %APPDATA%\XWord 做验证
- 联网只用于安装 npm 依赖和查官方文档（electronjs.org、electron.build、electron-vite.org、vitejs.dev、react.dev、
  sql.js.org、github.com、npmjs.com）；Electron 下载慢用项目内 .npmrc 的 npmmirror
- 禁止：git push、添加远程、git reset --hard、git clean；读改删 XWord 以外的用户文件；改系统环境变量/注册表/
  全局 npm 配置/系统设置；安装系统软件、npm install -g、winget；在代码或文档里写密钥或个人信息；
  任何系统级清理（清 Windows 图标缓存、重启资源管理器等由用户自己做）

## 设计规范里最容易违反的
- 除 design.css、src/main/window.ts 的两个窗口背景色外，不许写十六进制色值（lint 会查）
- 不许 emoji；勾叉用 SVG 画，不用文字字符（lint 会查）
- 只用 lucide 线性图标，16 或 18px；纯图标按钮必须有 Tooltip，内容是“名称 + 快捷键”
- 靠明度分层，边线只用 1px；强调色（陶土）只用于需要注意或操作的地方；高亮一律半透明（color-mix）
- 按下只变背景，不缩放不位移；键盘聚焦要有清晰聚焦环；四种状态在同类控件上一致
- 动效只动 transform 和 opacity；禁止弹跳、回弹、放大入场、视差、装饰性循环；减少动态效果时退化为直接显示或淡入
- “马克笔划过”只用于：开屏、AI 等待（全软件唯一的循环动效）、复习完成、网格打勾、收词下划线、新建高亮；进度条统一荧光笔样式
- 焦点在输入框里时全局快捷键不触发；删除一律软删除 + 可撤销 Toast
- 界面 v2：四层表面 desk → paper → raised → overlay，靠明度差分层，1px 线只用于表格行（--hair）和控件描边（--border）
- 所有数字（统计、进度、日期）用衬线 + tabular-nums；中文一律用界面字体
- 每屏只有一个陶土色主元素；黄色只用于荧光笔、到期 / 选中的半透明底、难词星标
- 动效只说明刚发生了什么；品牌三笔：划（scaleX）、写（scaleX）、勾（stroke-dashoffset）；按键立即生效、动画可打断、不丢键
- 其余细节见 docs/ui-spec.md

## 领域规则
【时间】所有日期按电脑系统当前的本地时区和本地时间计算（用户改了系统时区，软件跟着改）；一天以本地 00:00 分界。
今天、learned_on、done_on、started_on、到期 / 拖欠、新词上限、备份文件名、连续打卡、统计、界面上的所有日期都按本地时间。
“今天”每次实时计算、不缓存；系统唤醒（resume）、屏幕解锁（unlock-screen）、窗口获得焦点、页面重新可见、每 60 秒各检查一次，
日期或时区变了立即刷新今日队列、导航数量、单词页和首页；不依赖午夜定时器。时刻存 ISO 8601（带本地偏移），日期由真实时刻
按本地时区换算。主进程感知不到系统时区变化：渲染进程每次 IPC 附带当前时区，主进程校验是合法 IANA 名后使用。
日期的换算、加减、比较、格式化只能经 dates.ts（传 now / instant + 可选 timeZone，纯函数不读系统时钟）；禁止用毫秒时间戳
做日期加减；lint 查 getDate / getHours、toISOString().slice(0, 10) 等“先转 UTC 再截取”的写法。

【复习节点】STAGES = [0, 1, 2, 6, 14, 30]，标签依次为：第1遍、1天、2天、6天、14天、30天。（checks.stage 存下标 0–5）

【单词状态】
- new：已录入，还没完成第1遍；learned_on 为 NULL。
- learning：已完成第1遍，正在按节点复习。
- mastered：30天节点通过。
- lapsed：30天节点答错，需要重新学习。重新学习的入口以后在词库里做。

【起算日】录入不等于学过。完成第1遍的那天写入 learned_on，同时写入 stage 0 的检查记录。
每个节点的到期日 = learned_on + STAGES[i] 天。起算点永远是 learned_on，不是上一次复习的日期。

【单词页】每页 27 行。新词写进“今天创建、而且还没写满”的那一页；没有这样的页就新建一页。
判断是否写满时，只算没有被软删除的词。row_no 只用于排序，显示时按顺序重新编号。

【到期、拖欠、漏】
- 到期：下一个未完成节点的到期日 ≤ 今天。拖欠：该到期日 < 今天。
- 多个节点同时逾期时，只考最近到期的那一个；更早的节点视为“漏”。
- 这个词被评分之前，“漏”只由调度函数推导出来用于显示；被评分时，才把这些节点写入 checks，result 为 missed，grade 为 NULL。

【评分（键盘 1–4），只针对本轮第一次作答】
- 1 忘了：该格记 fail，lapses 加 1；这个词排到本轮末尾重现。
- 2 模糊：该格记 ok，显示为淡色勾；这个词排到本轮末尾再出现一次。
- 3 记得、4 很熟：该格记 ok。
- 不论 ok 还是 fail，都进入下一个节点，日期仍然从 learned_on 起算。第1遍（stage 0）同样按这四档记录。

【本轮重现】重现时只写 review_log（is_retry = 1），不改 checks，也不改 lapses。重现时评 1，就继续排到末尾，
直到评分 ≥ 2 为止。“本轮”只存在内存里。关掉应用后，没完成的重现直接丢弃。

【难词】某次评分使 lapses 达到 2 或以上时，把 starred 设为 true。用户手动取消后，只有 lapses 再次增加时才会重新自动标记。

【30天节点】评为 ok：status 变为 mastered。评为 fail：status 变为 lapsed。

【今日队列】
- 先放到期的复习词，排序依次为：逾期天数降序 → starred 优先 → lapses 降序 → 页码、行号升序。
- 再放 status = new 的新词，按页码、行号升序。
- 新词数量受每日上限约束：今天已完成第1遍的新词数 + 队列中的新词数 ≤ 上限。上限默认 20，存在 settings 表里。
  超出的新词保持 new，留到之后的日子。

【撤销】撤销一次评分时，恢复以下全部内容到评分前的状态：checks（包括这次评分时写入的 missed 记录）；
lapses、starred、status、learned_on；同时删除对应的 review_log。

## 补充规则（v0.2 起）
- 命名：“词典”指打包进软件的开源词典数据（ECDICT），只读；“词库”指用户自己录入的单词（词库页）。代码和文档都按此区分
- 结束进程：只能结束本会话自己启动的、或命令行里含 XWord 项目路径的进程；动手前先打印 PID 和命令行核对，来源不明的一律不动
- 系统操作：不碰 WSL、Hyper-V、虚拟磁盘、其它盘符，不做任何迁移、扩容、换位置之类的系统操作
- 用户数据：动 %APPDATA%\XWord 之前，先把整个目录备份到 XWord\.test-tmp\appdata-backup-时间戳\；任何情况下都不删其中的 xword.db 和 backups
- 卡住：下载、安装、构建超过 10 分钟没有进展，先换允许的备用方案；备用方案也不行再停下
- 空间不足：先清理项目内可再生成的文件（.test-tmp 旧截图和旧备份、release 旧版本、out、dist），仍不足再停下

## 工作方式
- 大任务先写 docs/PLAN.md，然后直接执行；按阶段检查并提交
- 每个阶段结束依次通过：npm run typecheck → npm run test → npm run lint → npx electron-vite build → 阶段验收；
  全部通过后本地 commit（中文，“Mx：……”），更新 docs/PROGRESS.md
- 需要取舍时选最稳妥的方案，按“日期 / 决定 / 原因”记进 docs/DECISIONS.md，然后继续
- 只有遇到停止条件才找用户：依赖装不上且换镜像也不行；需要做禁止的事；需求有歧义且选错返工代价大
- npm run dev 放后台运行，看日志（userData\xword.log 也有）确认主进程、渲染进程无报错后结束进程
- 看不到界面的检查，列进汇报的“需要手动检查”清单
- 永远不要 push
