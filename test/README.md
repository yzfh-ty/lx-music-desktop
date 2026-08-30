# 订阅下载功能测试

针对「订阅下载 + CloudDrive2 同步」这条链路的自动化测试。跑的都是**真实的生产代码**（由
`helpers/compile.js` 从 `src/` 现场编译），只把外部依赖换成可编排的替身，所以测试失效
时基本可以确定是代码真的变了，而不是测试自己抄的一份逻辑过期了。

```bash
npm test                                  # 跑全部
node --test test/cd2-upload-status.test.js  # 跑单个
```

零额外依赖，用的是 Node 22 内置的 `node:test` / `node:assert` / `node:sqlite`。

## 各个文件测什么

| 文件 | 覆盖范围 |
| --- | --- |
| `cd2-upload-status.test.js` | `getSubscriptionCd2UploadStatus` 的全部分支：destPath 关联、`size=0` 预处理、传输任务被 CloudDrive2 清出列表后的云端兜底、`Skipped`/`Error` 等终态、多任务冲突、权限降级；另用真实复制、gRPC 确认与清理模块覆盖手动下载的“上传并保留 / 上传后清理”链路 |
| `cleanup-safety.test.js` | `cleanupSubscriptionLocalFile` 和 `removeSubscriptionOldCloudFile` 的安全门——这是整条链路里唯一会删用户文件的地方，任何不确定的情况都必须拒绝删除 |
| `task-state-machine.test.js` | `processSubscriptionMaintenance` / `recheckSubscriptionUpload` 的状态转换、写库抑制，以及活动下载磁盘锁、本地模式自动备份、异步初始化取消 |
| `db-status-enums.test.js` | 数据库层对 `upload_unconfirmed` 的处理：重试入口、看板计数、重新入队拦截、歌单同步、云端校准保护；另覆盖手动上传去重记录的新增与升级 |
| `i18n.test.js` | 三份语言文件的键集一致性、字典序、占位符匹配、繁体用词，以及代码引用的 key 都存在、无死键、页面无硬编码中文 |
| `vue-typecheck.test.js` | 按 vue-loader 的方式生成 `<name>.vue.ts` 再跑 tsc，抓模板里的类型错误（例如 `v-slot` 解构参数缺类型标注） |
| `regression-guard.test.js` | 变异测试：把关键逻辑改回修复前的写法，断言旧版本**确实**有 bug；同时守卫手动下载必须先完成元数据/歌词再同步、未确认时不得显示成功，以及数据库 Worker 可承载订阅页的并发请求 |

## 替身怎么搭的

**`helpers/mock-cd2.js`** —— 用仓库里同一份 `clouddrive.proto` 起一个假的
`CloudDriveFileSrv`。被测代码走的是真实的 gRPC 序列化链路，只有服务端返回的内容由测试
编排。可以摆布挂载点、传输任务列表、云端文件表，也可以让某个方法直接返回错误。

**`helpers/env.js`** —— 建临时目录充当 CloudDrive2 挂载点（相当于 `F:\`）和 LX 下载目录，
写出指定字节数的假音频文件。

**`helpers/sqlite-adapter.js`** —— 仓库里的 `better_sqlite3.node` 是 Windows/Electron
的二进制，在 Linux 上加载不了。这个适配器把 better-sqlite3 用到的那部分 API
（`prepare/run/get/all/pluck`、`transaction`、`exec`）对齐到 Node 内置的 `node:sqlite`，
好让**真实的** dbService 模块跑起来，配合 `tables.ts` 里的**真实 schema**。

**`stubs/ipc.js`** —— 渲染进程 IPC 层的内存替身。它照抄了真实 DB 层的行为，
包括「只有 status 或 failureReason 变化时才写 history」这一条，测试才能验证轮询不会把
历史表刷屏。

## 这些测试证明不了什么

CloudDrive2 mock 编码的是**我们对 CloudDrive2 行为的假设**，它只能证明代码在这些假设下工作正确，
不能证明假设本身成立。特别是这几条：

- 传输任务完成后会被移出 `GetUploadFileList`
- `FindFileByPath` 返回的 `isCloudFile` / `isLocal` 能区分「已在云端」和「还在 CloudDrive2 本地写缓存」
- `UploadFileInfo.destPath` 的拼法与 `toRemotePath` 推导的一致

这些只能对着真实 CloudDrive2 核对。仓库根目录的 `test-cd2-verify.js` 就是干这个的，
**只读**，不写入、不上传、不删除：

```bash
node test-cd2-verify.js <apiToken> "F:\你的歌.flac" "C:\...\Downloads\music\你的歌.flac"
```

它会逐条打印核对结果，末尾给出「通过 / 不符 / 无法核对」的小结。有 FAIL 说明上面某条
假设在你的环境里不成立，需要按打印出来的实际值调整代码。

## 真实环境验收记录

2026-08-30 在独立 Electron 用户目录和唯一的 `F:\__LX_REAL_E2E_20260830__` 命名空间中完成全面真实验收。
CloudDrive2 使用默认 gRPC 端口 `19798`，整个 `F:\` 为挂载根目录；音源使用
`D:\project\lx-music-desktop\gdstudio_lx_source.js`，应用内导入副本与原文件 SHA-256 一致。

| 验收项 | 真实结果 |
| --- | --- |
| CloudDrive2 登录、挂载与设置页健康检查 | 通过，界面显示连接与挂载检查通过 |
| 歌单订阅、首次同步与持久化 | 从界面新增网易云「国风榜」，得到「发现 50、入队 50、跳过 0」；重启后 50 项任务及暂停状态完整恢复 |
| 真实下载主链 | 放行一首「莫问归期」，完成解析、下载、音质复核、元数据/封面/歌词写入、上传确认和延迟清理 |
| 文件真实性 | 得到 22,896,416 字节 FLAC（44.1 kHz、16 bit、含封面和内嵌歌词）；本地与 F 盘音频、LRC 的 SHA-256 分别一致 |
| CloudDrive2 完成判定 | 上传任务移出传输列表后，由云端文件校验确认 `success`，`verifiedByCloudFile=true` |
| 重复同步去重 | 第二次界面同步得到「发现 0、入队 0、跳过 50」，任务总数仍为 50 |
| 手动下载三种模式 | 使用真实生产 `cd2.ts`、真实文件和真实 F 盘验证：不同步仅留本地；上传并保留在两端保留音频/LRC；上传后清理仅保留 F 盘音频/LRC |
| 故障保护 | 不可连接端点和未上传目标均拒绝清理，本地音频/LRC 保留 |
| 旧版本替换 | 先上传旧 MP3，再上传新 FLAC；仅在新文件云端确认后删除旧音频/LRC，新文件保留 |
| 磁盘锁与恢复 | 锁定时任务不启动；重启后锁及 49 项手动暂停状态保留；界面解锁后只放行未手动暂停的任务 |
| 立即备份 | 设置页成功生成带时间戳的订阅数据库备份 |
| 网盘校准 | 界面扫描 1 个真实 F 盘文件，自动匹配 1、待确认 0、失败 0，运行记录为 `completed` |
| 目录一致性 | 界面扫描 2 个真实样本，准确报告已记录 1、缺失 1、未登记 1，并列出对应路径 |
| 历史、失败恢复与重试 | 界面显示真实阶段历史；注入的隔离失败任务重启后仍存在，「重试全部」准确重新入队 1 项并清除失败原因 |
| 延迟本地清理 | 云端确认后本地音频/LRC 删除，F 盘音频/LRC 保留 |

订阅新增、同步、锁定/解锁、健康检查、备份、校准、目录检查、历史和失败重试均通过实际 Electron 界面操作。
手动下载三种模式、故障保护、旧版替换和最终清理通过同一生产模块直连真实 CloudDrive2 gRPC 与 F 盘文件验证；
渲染层对三种模式的分流另由自动化回归测试覆盖。因此这里不把生产模块验证误写成三次手工点击下载界面。

验收结束后已删除 `F:\__LX_REAL_E2E_20260830__` 及两个隔离本地目录；没有读取、修改或清理日常 LX 用户数据。

## 加测试时注意

`regression-guard.test.js` 靠源码里的字符串锚点做变异。改动 `cd2.ts` 里被锚定的那几行
时它会**主动报错**提示锚点失效，而不是悄悄失去鉴别力——看到这类报错请更新锚点，
不要直接删测试。
