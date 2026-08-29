# 订阅下载功能测试

针对「订阅下载 + CD2 同步」这条链路的自动化测试。跑的都是**真实的生产代码**（由
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
| `cd2-upload-status.test.js` | `getSubscriptionCd2UploadStatus` 的全部分支：destPath 关联、`size=0` 预处理、传输任务被 CD2 清出列表后的云端兜底、`Skipped`/`Error` 等终态、多任务冲突、权限降级 |
| `cleanup-safety.test.js` | `cleanupSubscriptionLocalFile` 和 `removeSubscriptionOldCloudFile` 的安全门——这是整条链路里唯一会删用户文件的地方，任何不确定的情况都必须拒绝删除 |
| `task-state-machine.test.js` | `processSubscriptionMaintenance` / `recheckSubscriptionUpload` 的状态转换：`uploading` ↔ `upload_unconfirmed` ↔ `failed` ↔ 确认成功，以及写库抑制 |
| `db-status-enums.test.js` | 数据库层对 `upload_unconfirmed` 的处理：重试入口、看板计数、重新入队拦截、歌单同步、云端校准保护 |
| `i18n.test.js` | 三份语言文件的键集一致性、字典序、占位符匹配、繁体用词，以及代码引用的 key 都存在、无死键、页面无硬编码中文 |
| `vue-typecheck.test.js` | 按 vue-loader 的方式生成 `<name>.vue.ts` 再跑 tsc，抓模板里的类型错误（例如 `v-slot` 解构参数缺类型标注） |
| `regression-guard.test.js` | 变异测试：把关键逻辑改回修复前的写法，断言旧版本**确实**有 bug。用来证明上面那些断言真的有鉴别力 |

## 替身怎么搭的

**`helpers/mock-cd2.js`** —— 用仓库里同一份 `clouddrive.proto` 起一个假的
`CloudDriveFileSrv`。被测代码走的是真实的 gRPC 序列化链路，只有服务端返回的内容由测试
编排。可以摆布挂载点、传输任务列表、云端文件表，也可以让某个方法直接返回错误。

**`helpers/env.js`** —— 建临时目录充当 CD2 挂载点（相当于 `F:\`）和 LX 下载目录，
写出指定字节数的假音频文件。

**`helpers/sqlite-adapter.js`** —— 仓库里的 `better_sqlite3.node` 是 Windows/Electron
的二进制，在 Linux 上加载不了。这个适配器把 better-sqlite3 用到的那部分 API
（`prepare/run/get/all/pluck`、`transaction`、`exec`）对齐到 Node 内置的 `node:sqlite`，
好让**真实的** dbService 模块跑起来，配合 `tables.ts` 里的**真实 schema**。

**`stubs/ipc.js`** —— 渲染进程 IPC 层的内存替身。它照抄了真实 DB 层的行为，
包括「只有 status 或 failureReason 变化时才写 history」这一条，测试才能验证轮询不会把
历史表刷屏。

## 这些测试证明不了什么

mock CD2 编码的是**我们对 CD2 行为的假设**，它只能证明代码在这些假设下工作正确，
不能证明假设本身成立。特别是这几条：

- 传输任务完成后会被移出 `GetUploadFileList`
- `FindFileByPath` 返回的 `isCloudFile` / `isLocal` 能区分「已在云端」和「还在 CD2 本地写缓存」
- `UploadFileInfo.destPath` 的拼法与 `toRemotePath` 推导的一致

这些只能对着真实 CD2 核对。仓库根目录的 `test-cd2-verify.js` 就是干这个的，
**只读**，不写入、不上传、不删除：

```bash
node test-cd2-verify.js <apiToken> "F:\你的歌.flac" "C:\...\Downloads\music\你的歌.flac"
```

它会逐条打印核对结果，末尾给出「通过 / 不符 / 无法核对」的小结。有 FAIL 说明上面某条
假设在你的环境里不成立，需要按打印出来的实际值调整代码。

## 加测试时注意

`regression-guard.test.js` 靠源码里的字符串锚点做变异。改动 `cd2.ts` 里被锚定的那几行
时它会**主动报错**提示锚点失效，而不是悄悄失去鉴别力——看到这类报错请更新锚点，
不要直接删测试。
