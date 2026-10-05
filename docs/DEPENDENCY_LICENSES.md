# 第三方依赖与工具许可证清单

审计日期：2026-09-20。主分支基线：`f7f95e78a1fd87f33554cf9a12608e54bc656e6f`。本文件记录第三方声明和来源，不为知序项目本身选择许可证。

## 核验方式与范围

当前 `pnpm-lock.yaml` 的 93 个包全部覆盖（无遗漏）。在隔离目录按锁文件安装，读取实际包的 package.json 和根目录 LICENSE/COPYING/NOTICE 文件；核对许可证正文特征、SHA-256、npm 官方版本元数据及 dist.integrity 与锁文件是否一致。93 项均一致。包声明的源码地址不等于独立证明作者身份或每一行代码的权利链。

数量：MIT 82、ISC 8、BSD-3-Clause 2、BSD-2-Clause 1。未出现未知、缺失或 copyleft 许可证声明。许可文本及来源校验摘要见 [机器可读清单](dependency-license-inventory.json)。

当前 Git 源码和 Release 不打包 node_modules、Node、pnpm 或 Gitleaks 二进制。安装后依赖自带的许可证必须保留；若将来制作离线整包、压缩 bundle 或桌面安装包，需要重新核查随包第三方 notice/版权和运行时的附属许可证，不能仅附本表。

一般注意事项（以各上游原文为准）：[MIT](https://spdx.org/licenses/MIT.html) 与 [ISC](https://spdx.org/licenses/ISC.html) 涉及保留许可/版权声明；[BSD-2-Clause](https://spdx.org/licenses/BSD-2-Clause.html) 区分源码与二进制再分发声明要求；[BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html) 还限制未经许可使用作者名称作背书。本清单不是针对未来任意分发方式的法律结论。

## 用量统计参考（2026-10-02）

参考 ccusage 的报表口径，已核对其 MIT 声明与固定提交，来源和复用范围见 [USAGE](USAGE.md)。未复制其代码文件或增加运行依赖，不改变知序自身许可证状态。

## 当前运行依赖（包含间接依赖）

### Android 个人测试版构建（2026-10-05）

原生代码只使用系统 API，无第三方 App 运行依赖、GMS、字体或媒体。Gradle Wrapper 8.13 JAR 来自官方发行包，SHA256 `81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f` 已匹配 [官方校验值](https://services.gradle.org/distributions/gradle-8.13-wrapper.jar.sha256)，来源为 [Gradle v8.13.0](https://github.com/gradle/gradle/tree/v8.13.0)。Apache-2.0 与官方 NOTICE 保留在 `android/third-party/`，不为项目选择许可证。Temurin JDK、完整 Gradle 仅用于隔离构建，不再分发。实际构建使用 AGP 8.9.2（Apache-2.0，仅构建工具）、正式 SDK Platform 35 / Build Tools 35.0.0；SDK 许可已单独获用户批准，不接受预览条款。编译与签名工具不随 APK 或 Git 分发。已检查 APK 条目：只有项目自身 DEX、资源、Manifest 和构建/签名元数据，无第三方运行库或 native ABI 库；没有随包第三方运行库 notice。新增书本矢量图标由本任务原创绘制，不含外部素材。独立 AOSP API 35 模拟器与框架 Instrumentation 仅用于合成测试，不分发系统镜像或测试 APK。此段不代表对构建工具全部传递组件进行逐项权利链审计。

### 新手教程原文（2026-10-04）

新增素材不是运行依赖。来源与完整附属许可见 [SOURCE-LICENSES](../public/tutorial-examples/SOURCE-LICENSES.txt)：维基教科书 CC BY-SA 4.0（仅相关摘录及其改编）、GitHub 与 EFF CC BY 4.0、Python PSF License 2 与示例代码 0BSD、鲁迅原作公有领域。摘录原文、作者、许可、编辑说明与固定修订位置随导入及下载保留；Python 完整附属许可也进入练习文件。不改变知序本身的许可证，未增加依赖或媒体资产。用户自行粘贴的正文是本地运行数据，不纳入公共素材。

| 包 | 版本 | 声明许可证 | 已核验的随包文件 | 官方版本元数据 |
|---|---|---|---|---|
| @hono/node-server | 2.1.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/%40hono%2Fnode-server/2.1.1) |
| @modelcontextprotocol/sdk | 1.30.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/%40modelcontextprotocol%2Fsdk/1.30.0) |
| accepts | 2.0.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/accepts/2.0.0) |
| ajv | 8.20.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/ajv/8.20.0) |
| ajv-formats | 3.0.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/ajv-formats/3.0.1) |
| body-parser | 2.3.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/body-parser/2.3.0) |
| bytes | 3.1.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/bytes/3.1.2) |
| call-bind-apply-helpers | 1.0.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/call-bind-apply-helpers/1.0.2) |
| call-bound | 1.0.4 | MIT | LICENSE | [npm](https://registry.npmjs.org/call-bound/1.0.4) |
| content-disposition | 1.1.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/content-disposition/1.1.0) |
| content-type | 1.0.5 | MIT | LICENSE | [npm](https://registry.npmjs.org/content-type/1.0.5) |
| content-type | 2.1.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/content-type/2.1.0) |
| cookie | 0.7.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/cookie/0.7.2) |
| cookie-signature | 1.2.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/cookie-signature/1.2.2) |
| cors | 2.8.6 | MIT | LICENSE | [npm](https://registry.npmjs.org/cors/2.8.6) |
| cross-spawn | 7.0.6 | MIT | LICENSE | [npm](https://registry.npmjs.org/cross-spawn/7.0.6) |
| debug | 4.4.3 | MIT | LICENSE | [npm](https://registry.npmjs.org/debug/4.4.3) |
| depd | 2.0.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/depd/2.0.0) |
| dunder-proto | 1.0.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/dunder-proto/1.0.1) |
| ee-first | 1.1.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/ee-first/1.1.1) |
| encodeurl | 2.0.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/encodeurl/2.0.0) |
| es-define-property | 1.0.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/es-define-property/1.0.1) |
| es-errors | 1.3.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/es-errors/1.3.0) |
| es-object-atoms | 1.1.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/es-object-atoms/1.1.2) |
| escape-html | 1.0.3 | MIT | LICENSE | [npm](https://registry.npmjs.org/escape-html/1.0.3) |
| etag | 1.8.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/etag/1.8.1) |
| eventsource | 3.0.7 | MIT | LICENSE | [npm](https://registry.npmjs.org/eventsource/3.0.7) |
| eventsource-parser | 3.1.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/eventsource-parser/3.1.1) |
| express | 5.2.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/express/5.2.1) |
| express-rate-limit | 8.7.0 | MIT | license | [npm](https://registry.npmjs.org/express-rate-limit/8.7.0) |
| fast-deep-equal | 3.1.3 | MIT | LICENSE | [npm](https://registry.npmjs.org/fast-deep-equal/3.1.3) |
| fast-uri | 3.1.8 | BSD-3-Clause | LICENSE | [npm](https://registry.npmjs.org/fast-uri/3.1.8) |
| finalhandler | 2.1.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/finalhandler/2.1.1) |
| forwarded | 0.2.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/forwarded/0.2.0) |
| fresh | 2.0.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/fresh/2.0.0) |
| function-bind | 1.1.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/function-bind/1.1.2) |
| get-intrinsic | 1.3.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/get-intrinsic/1.3.0) |
| get-proto | 1.0.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/get-proto/1.0.1) |
| gopd | 1.2.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/gopd/1.2.0) |
| has-symbols | 1.1.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/has-symbols/1.1.0) |
| hasown | 2.0.4 | MIT | LICENSE | [npm](https://registry.npmjs.org/hasown/2.0.4) |
| hono | 4.13.8 | MIT | LICENSE | [npm](https://registry.npmjs.org/hono/4.13.8) |
| http-errors | 2.0.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/http-errors/2.0.1) |
| iconv-lite | 0.7.3 | MIT | LICENSE | [npm](https://registry.npmjs.org/iconv-lite/0.7.3) |
| inherits | 2.0.4 | ISC | LICENSE | [npm](https://registry.npmjs.org/inherits/2.0.4) |
| ip-address | 10.7.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/ip-address/10.7.2) |
| ipaddr.js | 1.9.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/ipaddr.js/1.9.1) |
| is-promise | 4.0.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/is-promise/4.0.0) |
| isexe | 2.0.0 | ISC | LICENSE | [npm](https://registry.npmjs.org/isexe/2.0.0) |
| jose | 6.2.12 | MIT | LICENSE.md | [npm](https://registry.npmjs.org/jose/6.2.12) |
| json-schema-traverse | 1.0.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/json-schema-traverse/1.0.0) |
| json-schema-typed | 8.0.2 | BSD-2-Clause | LICENSE.md | [npm](https://registry.npmjs.org/json-schema-typed/8.0.2) |
| math-intrinsics | 1.1.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/math-intrinsics/1.1.0) |
| media-typer | 1.1.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/media-typer/1.1.1) |
| merge-descriptors | 2.0.0 | MIT | license | [npm](https://registry.npmjs.org/merge-descriptors/2.0.0) |
| mime-db | 1.54.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/mime-db/1.54.0) |
| mime-types | 3.0.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/mime-types/3.0.2) |
| ms | 2.1.3 | MIT | license.md | [npm](https://registry.npmjs.org/ms/2.1.3) |
| negotiator | 1.1.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/negotiator/1.1.0) |
| object-assign | 4.1.1 | MIT | license | [npm](https://registry.npmjs.org/object-assign/4.1.1) |
| object-inspect | 1.13.4 | MIT | LICENSE | [npm](https://registry.npmjs.org/object-inspect/1.13.4) |
| on-finished | 2.4.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/on-finished/2.4.1) |
| once | 1.4.0 | ISC | LICENSE | [npm](https://registry.npmjs.org/once/1.4.0) |
| parseurl | 1.3.3 | MIT | LICENSE | [npm](https://registry.npmjs.org/parseurl/1.3.3) |
| path-key | 3.1.1 | MIT | license | [npm](https://registry.npmjs.org/path-key/3.1.1) |
| path-to-regexp | 8.4.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/path-to-regexp/8.4.2) |
| pkce-challenge | 5.0.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/pkce-challenge/5.0.1) |
| proxy-addr | 2.0.8 | MIT | LICENSE | [npm](https://registry.npmjs.org/proxy-addr/2.0.8) |
| qs | 6.16.0 | BSD-3-Clause | LICENSE.md | [npm](https://registry.npmjs.org/qs/6.16.0) |
| range-parser | 1.3.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/range-parser/1.3.0) |
| raw-body | 3.0.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/raw-body/3.0.2) |
| require-from-string | 2.0.2 | MIT | license | [npm](https://registry.npmjs.org/require-from-string/2.0.2) |
| router | 2.2.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/router/2.2.0) |
| safer-buffer | 2.1.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/safer-buffer/2.1.2) |
| send | 1.2.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/send/1.2.1) |
| serve-static | 2.2.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/serve-static/2.2.1) |
| setprototypeof | 1.2.0 | ISC | LICENSE | [npm](https://registry.npmjs.org/setprototypeof/1.2.0) |
| shebang-command | 2.0.0 | MIT | license | [npm](https://registry.npmjs.org/shebang-command/2.0.0) |
| shebang-regex | 3.0.0 | MIT | license | [npm](https://registry.npmjs.org/shebang-regex/3.0.0) |
| side-channel | 1.1.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/side-channel/1.1.1) |
| side-channel-list | 1.0.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/side-channel-list/1.0.1) |
| side-channel-map | 1.0.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/side-channel-map/1.0.1) |
| side-channel-weakmap | 1.0.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/side-channel-weakmap/1.0.2) |
| statuses | 2.0.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/statuses/2.0.2) |
| toidentifier | 1.0.1 | MIT | LICENSE | [npm](https://registry.npmjs.org/toidentifier/1.0.1) |
| type-is | 2.1.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/type-is/2.1.0) |
| unpipe | 1.0.0 | MIT | LICENSE | [npm](https://registry.npmjs.org/unpipe/1.0.0) |
| vary | 1.1.2 | MIT | LICENSE | [npm](https://registry.npmjs.org/vary/1.1.2) |
| which | 2.0.2 | ISC | LICENSE | [npm](https://registry.npmjs.org/which/2.0.2) |
| wrappy | 1.0.2 | ISC | LICENSE | [npm](https://registry.npmjs.org/wrappy/1.0.2) |
| yaml | 2.9.1 | ISC | LICENSE | [npm](https://registry.npmjs.org/yaml/2.9.1) |
| zod | 3.25.76 | MIT | LICENSE | [npm](https://registry.npmjs.org/zod/3.25.76) |
| zod-to-json-schema | 3.25.2 | ISC | LICENSE | [npm](https://registry.npmjs.org/zod-to-json-schema/3.25.2) |

## 开发/CI 工具及未合并更新所引用的版本

这些工具由 CI 或使用者另行取得，没有复制到项目源码或 Release。只记录本仓库直接引用工具的顶层许可证；不代表对工具自身全部传递组件进行了独立合规审计。

| 工具 | 固定引用 | 核验许可证 | 上游原文 |
|---|---|---|---|
| actions/checkout | `11d5960a326750d5838078e36cf38b85af677262` | MIT | [许可证](https://github.com/actions/checkout/blob/11d5960a326750d5838078e36cf38b85af677262/LICENSE) |
| pnpm/action-setup | `f40ffcd9367d9f12939873eb1018b921a783ffaa` | MIT | [许可证](https://github.com/pnpm/action-setup/blob/f40ffcd9367d9f12939873eb1018b921a783ffaa/LICENSE.md) |
| actions/setup-node | `49933ea5288caeca8642d1e84afbd3f7d6820020` | MIT | [许可证](https://github.com/actions/setup-node/blob/49933ea5288caeca8642d1e84afbd3f7d6820020/LICENSE) |
| actions/checkout | `3d3c42e5aac5ba805825da76410c181273ba90b1` | MIT | [许可证](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/LICENSE) |
| actions/setup-node | `820762786026740c76f36085b0efc47a31fe5020` | MIT | [许可证](https://github.com/actions/setup-node/blob/820762786026740c76f36085b0efc47a31fe5020/LICENSE) |
| pnpm/action-setup | `b906affcce14559ad1aafd4ab0e942779e9f58b1` | MIT | [许可证](https://github.com/pnpm/action-setup/blob/b906affcce14559ad1aafd4ab0e942779e9f58b1/LICENSE.md) |
| gitleaks/gitleaks | `v8.30.1` | MIT | [许可证](https://github.com/gitleaks/gitleaks/blob/v8.30.1/LICENSE) |
| pnpm/pnpm | `v11.19.0` | MIT | [许可证](https://github.com/pnpm/pnpm/blob/v11.19.0/LICENSE) |

`pnpm/action-setup` 的 `f40ffcd…` 是不可变的带注释 tag 对象，解析到 `b906affc…` commit；两者对应同一份 MIT LICENSE.md。依赖机器人提出的替换不代表取得了另一份内容。

未合并的 Zod 4.6.5 更新：npm 声明 MIT，已下载其官方 tarball、核验 SHA-512 和随包 LICENSE。它未进入当前运行依赖，未在本次审计中升级或合并。其他尚未合并的 Actions 更新也列入上述工具清单。

## 非软件资产

- Android 新增原创 XML 矢量书本图标；未引入第三方图片、字体或媒体。既有网页界面标记使用文字/Unicode 和 CSS。
- CSS 中 Inter、PingFang SC、Microsoft YaHei、Georgia、Songti SC、Consolas 等只是本机字体名称回退；没有 @font-face、外链字体下载或字体二进制再分发。
- README 的 GitHub CI 状态图片是远程生成的仓库状态，不是随包图片资源。
- 设计与接口文档包含 MDN、Obsidian、PubMed、Microsoft、MCP、OWASP、OpenAI 和 Tavily 的来源链接；未打包其网页、课程、论文或书籍全文。供应商接口兼容不等于获得商标背书或外部服务使用权。
- 所有者已确认源码、界面、默认提示词和文档由本项目编写或 AI 辅助生成，没有另行复制的受限内容；这项是来源声明，不是代码相似度或法律鉴定。
