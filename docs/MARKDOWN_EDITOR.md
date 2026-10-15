# 资料 Markdown 双模式编辑

工具栏按钮的名称与快捷键提示可完整显示在编辑器上方；编辑器外框不裁切这些提示，窄屏继续自动换行。

网页版在「知识库 → 查看整组 → 编辑原始资料」提供「Markdown 源码」和「可视化编辑」。两者编辑同一份正文，保存时仍核对原内容哈希；其他窗口或外部编辑器先修改后，本页会保留草稿并显示冲突，不覆盖新版本。关闭、切换资料和刷新继续沿用未保存保护。

编辑页「取消」、关闭按钮、遮罩、Esc、主导航和切库准备会检查同一份当前草稿，只有明确选择「放弃修改」才离开；取消确认继续留在原模式。保存只提交点击时的快照，重复点击不重复请求。保存响应、背景刷新或返回整组读取期间的新输入保留在当前编辑器，成功返回的新哈希成为下一次保存的并发基线；后续输入仍需再次保存。已经关闭、切库或换成其他编辑器时，旧保存响应不重绘新页面。

「收集与加工 → 快速收集」的原文输入也提供相同的双模式编辑。「批量导入」选择现有支持的 UTF-8 `.txt/.md` 后，先逐份展开标题和正文预览；可切换可视化修改，再点击「导入所选文件」。预览本身不保存或调用 AI，解析所得来源信息继续保留；普通保存不调用 AI。未编辑的导入正文保留 CRLF、末尾换行和空行；可视化实际编辑后采用规范 Markdown。

清空收集表单和保存成功后的重置会同步清除编辑器草稿；引导填例会替换同一草稿并回到源码。文件预览支持单独清空，重新选文件前会确认替换；读取失败保留原预览，清空或重新选择后迟到的旧读取不会恢复内容。收集输入和文件预览都受未保存导航/刷新保护；保存失败保留草稿供重试，保存期间的新输入不会被旧请求清空。

源码模式使用普通文本框，没有语法高亮。可视化模式采用固定 Vditor 4.0.0，提供标题、粗体、斜体、删除线、列表、引用、链接、表格、代码和撤销/重做。只打开、切换模式或直接保存时保留原 Markdown，包括 CRLF、末尾换行和空行；真正编辑可视化内容后，正文采用编辑器的规范 Markdown 格式。

| 内容 | 当前行为 |
|---|---|
| 标题、段落、列表、表格、链接 | 可双向编辑；切换不自动保存 |
| 围栏代码、块公式 | 保留为可编辑源码，不执行代码或加载公式/图表渲染器 |
| 远程图片、未绑定的本地图片引用 | 显示本地占位，保留原引用，不请求远图；点击图片属性后通过专用按钮切到源码修改说明/引用 |
| 已绑定附件 | 调用方注入解析器后可显示同源受控图片；保存成功后使用真实笔记身份解析，暂存编号不作为绑定依据 |
| 行内公式、HTML、Obsidian 双链、frontmatter、扩展指令、无法完整往返的 Markdown | 明确保留源码编辑，不丢弃内容；可视化按钮说明原因 |
| 粘贴格式化 HTML | 先清理危险内容，再转为 Markdown；残留 HTML 或不支持的扩展内容追加到源码末尾并说明 |

编辑器的脚本、样式、Lute、中文界面和图标均在 `public/vendor/vditor/` 自托管。关闭本地草稿缓存，不把资料写进 localStorage。Vditor 的 `preview.markdown.sanitize` 明确开启；HTML 默认保留源码，粘贴不直接插入剪贴板 HTML。图片在进入页面 DOM 前转换为本地占位或受控附件地址，读取 Markdown 时只恢复图片目标，普通文本中的 URL 不被替换。页面原有 CSP、CSRF、会话和外发限制保持有效。

可视化切换、纯文本粘贴和拖入文本先读取同一固定 Lute 引擎的 `RenderJSON` 语法树，只跳过解析器实际识别的代码块和代码跨度。HTML 块、行内 HTML 和 frontmatter 保留源码；结构解析不可用或异常也保留源码。不能用正则删除看似代码的片段再作 HTML 安全判断：含非法反引号 info 的伪围栏或跨段落的未闭合反引号，可能仍被实际解析为 HTML。此保护在正文交给 Vditor 前执行；不能依靠 sanitizer 或 CSP 自动阻止表单、iframe 和固定定位内容覆盖界面。

工具栏图标随主脚本以本地外链脚本预载，两者就绪才启用可视化。通过公开 `icon: ''` 选项关闭上游的自动图标加载，避免其同步 XHR 后插入内联脚本被现有 CSP 拒绝而留下空白工具栏；不放宽 CSP，不修改 vendor 或 manifest。

本轮不加载 Vditor 包内可选 KaTeX、图表或 PlantUML 渲染器；这些资源不随网页发布。已有只读 Markdown 入口仍使用原来的安全 DOM 阅读器，不能把它的旧验证代替新编辑器安全验证。没有新增 AI 调用、提示词或外发授权。

## 附件注入契约

当前附件控件已向原始资料编辑器注入 `uploadImage` 与 `assetResolver`。可视化模式支持在正文内粘贴或拖入本地图片；「插入本地图片」仍使用 FilePond 选择与撤销。暂存时只在 Markdown 中写入稳定的内容引用，保存后才按真实笔记身份显示已绑定图片。源码选区插入与可视化草稿分开处理，可视化模式不会写入隐藏文本框的旧选区。

保存同时复制当前正文、上传编号与哈希。失败保留草稿及编号；成功仅清除本次提交且已绑定的编号，期间继续输入或新增上传仍留在当前草稿。撤销只在完整正文仍与该次插入后的快照相同时恢复插入前快照；继续改写后保留正文并提示手动处理，避免误删已有引用。

`public/markdown-editor.mjs` 的 `createMarkdownEditor(textarea, options)` 接受以下可选回调：

- `assetResolver(markdownUrl)` 返回已绑定附件的同源受控展示 URL，或返回空值。只接受 `/api/notes/<noteId>/attachments?asset=<id>` 地址。
- `uploadImage(file)` 由附件组件暂存图片并返回 `{ attachmentId, markdownUrl }`；`markdownUrl` 必须为 `../.zhixu-attachments/<sha256.ext>`。不接受 blob、file、临时路径或远程上传地址作为新图片引用。
- 上传、撤销、恢复、`attachmentUploadIds` 和保存绑定归调用方负责。新上传未保存时没有受控 `displayUrl`，不能用预分配 noteId 伪造预览 URL；保存成功绑定后，才使用真实 noteId 的附件入口。FilePond 自身的临时预览不进入正文。

调用方可用 `setValue(markdown)` 初始化预览、清空或填入示例：它保留传入的精确正文，回到源码并使迟到的旧加载失效。`textarea.markdownEditor` 指向同一个适配器，供现有引导填例使用。任何模式下提交和未保存检查都须调用 `getValue()`；不能直接修改隐藏文本框来替换可视化草稿。文本/Markdown导入与附件入口共用当前草稿接口；DOCX仍保留独立提取文字校验。

附件控件组合时也需先用 `getValue()` 读取当前草稿，再用 `setValue()` 替换；直接对隐藏的 textarea 调用 `setRangeText` 或 `.value` 会遗漏可视化输入。`attachmentUploadIds` 仍由附件调用方独立维护，正文替换不能清空或伪造这些绑定记录。上传和编辑器的组合遵守相同草稿及绑定规则。

### 附件组合接点

以下约定由当前 `source-files.mjs` 与编辑器共享；实际验证范围见测试结果中的组合记录。

| 值 | 含义与用途 |
|---|---|
| `receipt.id` | 暂存上传编号，加入 `attachmentUploadIds`，用于本次保存绑定及上传撤销 |
| `receipt.attachment.id` | 稳定附件编号，组成 `../.zhixu-attachments/<id>`；不能当作上传编号提交 |
| `editor.getValue()` | 同步取得当前源码或可视化正文；提交、未保存检查和程序插入都读取它 |
| `editor.setValue(markdown)` | 精确替换草稿、回到源码、使旧加载失效；不会管理或清除上传编号 |

附件分支的 `imageInsertControls(body, uploadIds)` 当前对 textarea 使用 `setRangeText`、`.value` 和 `input` 事件。组合时保留其 FilePond 上传与撤销流程，只把正文读写接到适配器。例如，明确追加图片的操作使用：

```js
const editor = body.markdownEditor;
if (imageUploads.includes(receipt.id)) return;
const markdown = editor.getValue();
editor.setValue(`${markdown}\n${imageReference(receipt.attachment)}\n`);
imageUploads.push(receipt.id);
```

这段示例是追加到末尾，并会回到源码。只有源码模式才能沿用 textarea 的选区插入；不能把隐藏 textarea 的旧选区当作可视化光标。重置、填例和导入提取结果也走 `setValue()`，上传列表另行按实际撤销结果处理。

保存时正文与上传编号必须在同一次点击中取快照，不把可变数组直接交给异步保存：

```js
const submitted = {
  ...serializeForm(form),
  body: editor.getValue(),
  expectedHash: currentHash,
  attachmentUploadIds: [...imageUploads],
};
const updated = await api.updateNote(note.id, submitted);
currentHash = updated.hash;
const bound = new Set(submitted.attachmentUploadIds);
for (let i = imageUploads.length - 1; i >= 0; i -= 1) {
  if (bound.has(imageUploads[i])) imageUploads.splice(i, 1);
}
```

上述片段只展示两个状态的组合，不替代本页已有的保存锁、当前编辑器/资料库核对及字段比较。失败时保留正文和全部暂存编号；成功时只移除本次已绑定编号。慢保存期间新增正文或上传仍留在当前草稿，新哈希用于下一次保存，不能无条件重绘或清空整个上传数组。撤销暂存上传时，只有能证明仍是该次插入且未被用户修改的片段才可删正文；否则保留引用并提示处理，不能用全局字符串替换误删原文。

当前编辑器 `uploadImage(file)` 回调由附件侧把异步回执桥接成 `{ attachmentId: receipt.attachment.id, markdownUrl }`，其中 `markdownUrl` 为 `../.zhixu-attachments/` 加稳定附件编号，同时独立记录 `receipt.id`。多格式提取仅把已提取正文传入 `setValue()`，提交重新取 `getValue()`，保留提取来源、警告和附件绑定记录。自动回归覆盖当前草稿插图/撤销、失败重试及保存中新上传；组合版本的真实浏览器点击与用户文档手感仍须独立验收。

适配器默认不连接上传接口。没有注入回调时，粘贴/拖入图片会说明使用附件入口，不会嵌入 data URL。`getValue()` 同步读取当前草稿，供保存与未保存检查使用；不能只读取隐藏文本框，因为可视化输入可能仍在等待编辑器的延迟回调。

依赖来源、完整性、各组件许可见 [第三方依赖说明](DEPENDENCY_LICENSES.md) 与随资源保留的 `NOTICE.txt`、许可全文和 `manifest.json`。本项目自身许可证状态不因使用这些组件改变。

图片属性使用 Vditor 官方 `customWysiwygToolbar` 的 `image` 扩展入口。上游属性框会直接设置图片 src，绕开 Lute 转换前的占位逻辑；适配器在弹框返回前替换掉全部直接URL控件，提供说明与「切换源码编辑图片引用」，保留当前草稿并聚焦源码。普通标题、表格等其他属性工具保持有效，未修改vendor资源。
