# Operit Local Memory ToolPkg

一个面向 Operit 的本地长期记忆插件。记忆以 Markdown 文件保存在设备本地，发送消息前只注入少量核心记忆和与当前话题相关的召回结果。

当前版本：`0.1.57`（测试版，面向 Operit 1.12.2）

## 主要功能

- 本地 Markdown 记忆库，不依赖远程记忆服务。
- 每轮注入可钉选的核心记忆。
- 基于关键词、中文字符切分和 BM25 的按需召回。
- 可按角色卡名称或 ID 限制记忆访问。
- 从对话摘要生成待审核候选，不会未经确认直接写入正式记忆库。
- 候选记忆保留简短结论与具体发生经过，并支持人工编辑后装订。
- 可导入用户自己的 Ombre Brain Markdown 记忆。
- 设置页支持重扫、搜索、容量控制和候选审核。

## 安装

1. 下载 [0.1.57 测试版安装包](releases/claude-local-memory-0.1.57.toolpkg)，或从 GitHub Releases 查看版本说明。
2. 在 Operit 中导入并启用 ToolPkg。
3. 打开“本地记忆设置”，确认“记忆册加载”已经开启。
4. 如需自动生成候选，再单独开启“收集对话碎片”。

安装后，数据保存在 Operit 应用私有目录 `files/plugins/com.claude_capability_pack.memory` 中，通过现有 Java 桥接读写，不依赖 Shizuku。首次启动尝试复制可读取的旧目录数据；清除应用数据或卸载 Operit 会删除私有数据。仓库和发布包不包含真实用户记忆。

0.1.57 修复空角色名单导致的注入跳过、设置页输入被重绘覆盖及 WebView 初始化超时流程；个人恢复名单为 Claude、Assistant，其他配置保持原值。该恢复只执行一次，已有非空名单不修改。尚未完成 Android 真机验收，说明见 [插件 README](packages/memory-toolpkg/README.md)。

## 构建

需要 Node.js 20 或更新版本。

```powershell
cd packages/memory-core
npm ci
npm test

cd ../memory-toolpkg
npm ci
npm test
npm run package
```

输出文件：

```text
packages/memory-toolpkg/build/claude-local-memory.toolpkg
```

## 项目结构

- `packages/memory-core`：Markdown 格式、检索、召回、摘要候选和 Ombre 导入。
- `packages/memory-toolpkg`：Operit Hook、设置页、运行时存储和 ToolPkg 打包。

## 隐私

- 插件不会把本地记忆库提交到本仓库。
- 自动摘要只产生待审核候选。
- 只有通过“装订”的候选才会进入正式记忆库。
- 发布源码前，`research/`、`artifacts/`、构建目录和本地配置均由 `.gitignore` 排除。

## 第三方与兼容性

本项目是非官方兼容插件，与 Anthropic、Operit 或 Ombre Brain 没有隶属或背书关系。第三方项目和许可证说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## License

[MIT](LICENSE)
