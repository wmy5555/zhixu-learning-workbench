# iOS 原生迁移交接 · 2026-10-22

工作分支 feat/ios-expo-rebuild-20261022；App 位于 apps/ios。用户选择 Expo + React Native，目前无 Mac，交付可移交源码。旧 iOS 未复用。正式 4318 快照固定在 7aa1d780c4f8af1de3e53699c1395b775f9a2557；不要把 main 或后续正式目录当成这个基线。

## 必须先看

apps/ios/README.md、MIGRATION.md、verification.json。后两者区分源码覆盖、实际执行和未验证。当前不是已验收的 iOS App；Swift/Xcode/真机及高危依赖门禁仍未完成，禁止据此发布或合并。

## 已踩过的坑

- 必须在 apps/ios 目录使用固定 pnpm 11.19.0，本地 pnpm-workspace.yaml 防止进入上层工作区。verifyDepsBeforeRun=false 避免命令隐式重复安装。不要手改锁文件。
- Expo 安装器自动调用 PATH 中的 pnpm，版本可能不一致。最终冻结安装已用 11.19.0 验证；unrs-resolver 后置脚本显式拒绝，预编译依赖完成了本轮 lint。
- Expo 58 的 API 与旧示例不同；用安装版本的文档/类型。React Native 0.88 TextInput 的引用用 React.ComponentRef<typeof TextInput>。
- 带 .js 后缀的 ESM 平台导入不会自动切到 .native.js；metro.config.cjs 的显式解析不可删除。Node 测试通过不代表 Swift/Expo 适配运行通过。
- Windows 不支持生成 iOS 原生工程。prebuild 的拒绝不是生成成功；自动链接找到模块不代表编译成功。
- 原生作用域依赖串行分发。只有同步草稿/任务状态/取消可旁路；扩大旁路可能串用正式与练习的外发上下文。
- 切换知识空间前必须保存旧空间草稿，保存失败则保持原空间。草稿与外观只在设备中保存，不随便携备份导出；恢复必须拒绝 nativeDrafts 注入。
- iOS 资料根目录排除系统云备份，凭据主密钥设备专属。卸载前要主动导出已保存资料，不能把源码快照当数据备份。
- 仓库公开且尚未选择项目许可证；保留 Expo 模板 MIT notice 和依赖许可清单，不把模板 LICENSE 当成整个项目许可证。
- node-forge/braces 高危公告未解除；审计给出的补丁号本轮注册表没有，不能硬写不存在的 override 或改低门槛。
- 旧桌面源码中 Windows 重命名重试依赖 Atomics，已限制在 Windows；iOS 同步 IO、大附件 base64 和自写固定 IP 网络桥仍需原生性能与安全验收。
- 本轮不创建提前 PR。日批需代码与原生边界安全审阅；没有云端通过结论。正式 4318、用户服务、真实 Vault/数据库/凭据均未由本任务更改。
