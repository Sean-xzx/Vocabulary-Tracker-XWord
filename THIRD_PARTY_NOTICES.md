# Third-party sources / 第三方来源

The original XWord project is all rights reserved. Third-party materials retain their own licenses;
this notice does not relicense them or apply their licenses to XWord. No root open-source LICENSE is added.
原创项目保留所有权利，第三方材料继续适用各自许可证；没有给 XWord 添加开源许可证。

| Component                    | Version used                                                | License                                                 | Source                                       |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| ECDICT dictionary            | Committed derived resource; checksum in docs/resources.json | MIT, included in resources/dict/ECDICT-LICENSE.txt      | https://github.com/skywind3000/ECDICT        |
| Electron                     | 39.8.10                                                     | MIT; bundled platform components have their own notices | https://github.com/electron/electron         |
| @electron-toolkit/utils      | 4.0.0                                                       | MIT                                                     | https://github.com/alex8088/electron-toolkit |
| sql.js                       | 1.14.2                                                      | MIT                                                     | https://github.com/sql-js/sql.js             |
| fflate                       | 0.8.3                                                       | MIT                                                     | https://github.com/101arrowz/fflate          |
| React / React DOM            | 19.3.0                                                      | MIT                                                     | https://github.com/facebook/react            |
| Zustand                      | 5.0.15                                                      | MIT                                                     | https://github.com/pmndrs/zustand            |
| Floating UI React            | 0.27.20                                                     | MIT                                                     | https://github.com/floating-ui/floating-ui   |
| Lucide React                 | 1.47.0                                                      | ISC                                                     | https://github.com/lucide-icons/lucide       |
| pdfjs-dist                   | 6.3.289                                                     | Apache-2.0                                              | https://github.com/mozilla/pdf.js            |
| pdf-lib (test fixtures only) | 1.17.1                                                      | MIT                                                     | https://github.com/Hopding/pdf-lib           |

Dependency versions come from the lockfile and installed package metadata. Their license texts are
provided by their npm packages. Source checkout does not vendor these packages. Packaging includes
Electron's notices; the configured PDF resources include pdf.js LICENSE. ECDICT's bundled notice was
compared byte for byte with upstream during publication preparation and preserved unchanged.

版本依据锁文件与安装包元信息。依赖许可证由各 npm 包提供，源码仓库不复制依赖目录。
打包保留 Electron 相关声明，并包含 PDF 资源许可证。随附词典许可证已与上游逐字节核对，原样保留。

Development tools include TypeScript (Apache-2.0), Vite, Vitest, electron-vite, electron-builder,
ESLint and Prettier (MIT), with transitive components governed by their package notices.
GitHub Actions use the official checkout/setup-node actions (MIT), pinned by commit in the workflow.

Project Gutenberg content is obtained on demand and is not bundled with the repository. Its copyright
status depends on the work and jurisdiction; users must check the applicable rights before import/use.
DeepSeek is an optional external service subject to its own terms. No key or private provider content is shipped.

Gutenberg 书籍按需获取，不随仓库分发；作品权利取决于作品及地区，用户应自行确认。
DeepSeek 是可选外部服务，适用其服务条款，不分发密钥或私人服务内容。

The demo text and book fixtures are synthetic; screenshots use isolated test data.
Original design references are retained in design-assets and remain subject to [NOTICE](NOTICE.md).
示例、书籍夹具和截图使用合成测试内容；原创设计资源仍适用项目权利声明。
