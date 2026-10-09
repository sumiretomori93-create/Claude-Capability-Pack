# 本地记忆层 0.1.57 — 无 Shizuku / 空角色名单恢复测试版

基于用户提供的 0.1.53。仅修改插件，不改 Operit；包标识不变，版本为 0.1.57。目标宿主为 Operit 1.12.2。

## 改动

新增 dist/appFiles.js，通过 1.12.2 已有 Java 桥接调用 java.io/java.util 的应用进程文件接口。不调用 Tools.Files、不调用 shell，也不请求 Shizuku。配置、记忆、候选、拒绝记录、缓存和导入日志全部使用此接口；管理子包也同步修改。

保存目录为 Java.getApplicationContext().getFilesDir() 下的 plugins/com.claude_capability_pack.memory。私有目录无需外部存储或 Shizuku 权限；卸载 Operit/清除应用数据会删除它，不能用普通文件管理器直接访问。不要通过卸载应用测试。

首次读取时，从原插件配置目录和兼容目录复制可读的 memory 文件，排除 index 缓存，不修改或删除源文件，不覆盖私有目录已有文件。遇到可检测的读取失败时停止启用新库，保留已复制文件供重试，不把半迁移的库当成完整记忆。迁移完成后只使用私有目录。

如果 Android 隐藏旧目录使 exists 返回 false，本版无法区分“目录不存在”和“目录不可见”；需核对迁移后的记忆条数，不能仅凭迁移日志认定所有旧记忆都已复制。旧目录无法由应用 UID 读取时，本包不能无权限取回它；需要用户提供可读的备份。首次迁移可能较慢，hook 若超时，可先打开设置页初始化再发消息。

文件写入采用同目录临时文件、flush+sync 与 rename；错误明确报出。配置读失败不静默变成默认值；数字字符串正确解析。候选 JSON 损坏不自动置空覆盖。缓存写失败不阻止已经读到的记忆注入。其他回顾提取与模型整理规则保留，不包含此前称呼识别等独立问题的修复。

## 验证

- node verification/candidate-regression.cjs：原16项候选行为测试通过（替换文件接口模拟）。
- node verification/app-storage.cjs：模拟 Java API 与真实临时文件，验证迁移、UTF-8精确保留、追加、保存配置、核心注入、缓存失败、损坏配置和候选文件报错；Tools.Files 调用次数为0。
- 所有打包 JavaScript 通过 node --check。

这不是 Android 真机验收。Java 桥接重载、实际存储权限和 UI/Hook 生命周期需在手机检查。

## 手机检查

1. 先保留旧插件包和旧 memory 数据备份，然后在现有插件位置更新此测试包，不卸载 Operit。
2. 保持 Shizuku 关闭，打开插件设置；核对原配置、记忆和候选数量。
3. 改一个配置值并保存，关闭再打开设置，确认值保持。
4. 使用一条明确标为测试的记忆，保存后核对能读取，再测试一次普通消息注入。
5. 如失败，记录报错和 [ccp_memory] 日志。不要清空记忆或反复覆盖目录。

日志 storage_ready 表示应用私有存储初始化；completed 中 returned=processedInput、core/retrieval 数量与 memory_chars 表示插件返回的注入结果。手机端模型是否引用记忆不能单独证明注入成功或失败。

回退旧插件不会删除新私有目录，但旧版不会读取新目录里新增的记录，因此回退前需保留新版数据。不要将两个目录当作自动双向同步。

## 0.1.55 设置页修正

保留 0.1.54 的无 Shizuku 存储。修复输入角色名单/数字后切换开关导致未保存内容被覆盖的问题；后台刷新保留设置草稿；成功保存后才清除草稿。“智能整理”只读已保存设置，不顺带保存表单，开启整理功能后需先点击保存。保存不完整表单时合并现有配置；阻止保存“角色限制开启但名单为空”的配置。已有空名单不会被擅自补齐或关闭限制，注入日志显示 reason=empty_allowlist。

附 config-reference-role-restricted.json 使用用户提供的角色名单和预算，保留 requireCharacterMatch=true；这是参考文件，不自动覆盖现有手机配置。进入设置页填 Claude, Assistant 及对应预算并保存。允许名单是否需要 Gabe 请按实际角色卡名称决定。

不能仅凭 skipped_scope 判断写盘与记忆库正常：该判断在实际读取记忆之前。也没有证据证明 reset_subpackage_states 会删除 config.json。

## 0.1.56 页面启动与调用超时修正

旧 ready() 在 WebView 接口调用内等待配置、迁移、全库统计、候选和模型配置，加载时间会计入宿主 JavaScript interface invocation 超时。新版全部 WebView 方法先返回 accepted 确认，再通过宿主 setTimeout 回调执行操作并推送状态；并发操作返回 busy，错误会显示并恢复可操作状态。候选智能整理内部原有的后台任务保持原流程。启动不查询模型配置；迁移在每个条目间交还事件循环。目录路径解析不再隐式触发迁移。

新增 verification/startup-bridge.cjs 验证慢初始化立即响应、并发确认、完成推送、失败解锁；原候选回归、存储测试及浏览器设置交互测试通过。仍未进行 Android 真机验证，无法仅凭模拟测试认定已解决全部宿主桥接问题。

验收先只打开页面：确认能切换页签、编辑输入，等待统计加载。加载成功前不要连续提交保存。若仍有错误，请提供 [ccp_memory_ui] startup stage=... 与 operation_failed 附近日志，以及 timeout 行附近的宿主日志；这些能区分存储、记忆扫描、候选或宿主运行时卡点。不需要删除或清空记忆。

## 0.1.57 针对已确认的 empty_allowlist 恢复

用户提供的18:59日志确认私有目录 config.json 内角色限制开启但两个名单为空。本版在读取配置时仅针对该状态一次性恢复 enabledCharacterNames=["Claude","Assistant"]，保持 requireCharacterMatch=true，其他字段包括未知字段原样保留。已有非空名单或关闭角色限制不受影响。原始配置备份到 config.json.before-role-recovery-0157.json，完成标记 config-role-recovery-0157.json；恢复后读回核对再允许继续。修复失败明确报错，不跳过权限限制。

这是针对本次用户需求的名单，不是通用角色自动发现；Gabe等其他名字不会被默认加入。完成后如再次手动清空名单，不会重复补写。

验收发一条普通新消息，检查 config_recovered 是否出现，随后应继续到 completed 或明确 failed；completed 的 buckets/core/memory_chars/returned 才说明此次实际读库及插件返回结果。若仍 skipped_scope 且显示角色名称不在名单内，应按实际角色名称调整，而不是关闭全部限制。此包不能保证实际库非空、pinned范围匹配或宿主最终采纳注入结果。

## 仓库构建输入

本次0.1.57来自经过修复与验证的ToolPkg运行代码。src/中的CommonJS JavaScript是当前权威运行源码；legacy-src/保留原0.1.51 TypeScript作迁移参考，不参与构建。build脚本检查JavaScript语法并复制到dist，再复制单独构建的memory-core。不要修改legacy-src期待改变安装包。

先在../memory-core执行npm ci与npm test，再在本目录执行npm ci、npm test、npm run package。verification/ui-settings.cjs需要另外安装Playwright及Chromium，可通过npm run test:ui执行；CI默认执行不依赖浏览器的候选、应用存储和启动桥接模拟测试。scripts/test-runtime.mjs是旧0.1.51测试参考，不再作为新版验收。
