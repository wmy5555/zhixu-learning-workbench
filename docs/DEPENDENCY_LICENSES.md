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

- 仓库未包含图片、SVG 文件、字体文件、音视频、PDF、训练模型或外部数据集。界面标记使用文字/Unicode 和 CSS。
- CSS 中 Inter、PingFang SC、Microsoft YaHei、Georgia、Songti SC、Consolas 等只是本机字体名称回退；没有 @font-face、外链字体下载或字体二进制再分发。
- README 的 GitHub CI 状态图片是远程生成的仓库状态，不是随包图片资源。
- 设计与接口文档包含 MDN、Obsidian、PubMed、Microsoft、MCP、OWASP、OpenAI 和 Tavily 的来源链接；未打包其网页、课程、论文或书籍全文。供应商接口兼容不等于获得商标背书或外部服务使用权。
- 所有者已确认源码、界面、默认提示词和文档由本项目编写或 AI 辅助生成，没有另行复制的受限内容；这项是来源声明，不是代码相似度或法律鉴定。

## Android / Capacitor 增量记录（2026-10-07）

上方 93 个 npm 包清单是 2026-09-20 的旧基线，不涵盖此后新增的 Capacitor runtime、CLI、Android Gradle 插件、Gradle distribution、AndroidX 或 Maven 依赖。本节只记录本次 Android 原型中已能从清单文件和本地包核对的直接依赖及其已知许可；没有解析 Maven 传递依赖树或审计 SDK/插件工具链的全部二进制，因此不表示全部 Android 组件已审计。

| 组件 | 版本/来源 | 许可证与核验范围 |
|---|---|---|
| `@capacitor/core`、`@capacitor/android` | npm `8.5.2`，锁文件对应包 | MIT；本地包 `LICENSE` 与官方仓库 [core](https://github.com/ionic-team/capacitor/blob/8.5.2/LICENSE)、[android](https://github.com/ionic-team/capacitor/blob/8.5.2/LICENSE) 一致。APK 随附的 [Android 第三方 notices](../public/android-third-party-notices.txt) 保存完整文本。 |
| `@capacitor/cli` | npm `8.5.2`，开发依赖 | MIT；CLI 只在开发/同步时使用。npm 旧清单未列入这个后续新增包，运行时 APK 不打包 CLI。 |
| Gradle Wrapper | `gradle-8.14.3-all.zip`；wrapper JAR 已存在 | Gradle 发行版采用 Apache-2.0；校验和应来自 Gradle 官方 sidecar（[SHA-256](https://services.gradle.org/distributions/gradle-8.14.3-all.zip.sha256)）。Wrapper JAR 内嵌 `META-INF/LICENSE` 的 Apache-2.0 文本复制到同目录 [LICENSE](../apps/android/android/gradle/wrapper/LICENSE)。wrapper properties 记载官方 SHA-256。 |
| AndroidX | AndroidX AOSP/Google Maven；项目明确引用 AppCompat `1.7.1`、CoordinatorLayout `1.3.0`、Core Splashscreen `1.2.0`；Capacitor 还依赖 Activity `1.11.0`、Core `1.17.0`、Fragment `1.8.9`、Webkit `1.14.0` | AndroidX 源码仓库声明 Apache-2.0；各 Maven 发布物来自 Google Maven。官方 [AndroidX 源码](https://github.com/androidx/androidx) 与 [Android 内容许可说明](https://source.android.com/license)为核验来源。未在该上游仓库找到独立 `NOTICE` 文件；APK notice 保留其 Apache-2.0 正文及来源说明。 |
| Apache Cordova Android framework | Maven `org.apache.cordova:framework:14.0.1` | Apache-2.0；核对 [14.0.1 上游 LICENSE](https://github.com/apache/cordova-android/blob/14.0.1/LICENSE) 与 [NOTICE](https://github.com/apache/cordova-android/blob/14.0.1/NOTICE)。上游 NOTICE 的 Apache Software Foundation 归属声明已复制到 APK notice。 |
| Android Gradle Plugin | `com.android.tools.build:gradle:8.13.0` | 构建工具，不是应用运行时依赖。此处记录坐标但未展开其传递组件许可证。 |

Capacitor 生成的默认图标和启动图属于模板资源，其许可范围随上述 Capacitor MIT 许可说明；本次未重绘、替换或另行引入媒体。2026-10-07 已在 b129246 构建的实际 APK ZIP 条目中确认 [android-third-party-notices.txt](../public/android-third-party-notices.txt) 随包收录；这不扩展上文注明的传递依赖审计范围。

2026-10-07 依赖安全修复：MCP SDK 从 1.30.0 升至 1.31.0（MIT，许可文件保持存在），修复 GHSA-6qxp-vccf-f47h。旧清单版本不代表当前锁文件。
