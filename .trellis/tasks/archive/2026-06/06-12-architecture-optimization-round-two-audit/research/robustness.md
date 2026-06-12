# Research: 第二轮架构健壮性审查（防御性代码质量）

- **Query**: 凭证数据流转卫生 / 服务监听面 / 请求体防御性解析 / 并发正确性 / 资源清理与异常路径
- **Scope**: internal（全仓代码审查）
- **Date**: 2026-06-12
- **前提**: 本地单机 MVP（api: Bun/Hono + SQLite，runner 本地执行器，web dev server），无多租户，明确不做容器隔离。严重度以该威胁模型为基准。

---

## 按严重度排序的发现总表

| # | 严重度 | 发现 | 位置 |
|---|--------|------|------|
| 1 | **High（改进项）** | web dev server 未指定 hostname，Bun 默认 0.0.0.0，且反代 /api/* → 局域网可达 includeSecret 端点 | `apps/web/serve.ts:50` |
| 2 | **Medium** | agent CLI 硬超时只发 SIGTERM，无 SIGKILL 兜底，子进程忽略 SIGTERM 时 runner 永久挂起 | `apps/runner/src/agents/claude-code.ts:251-254`、`codex.ts:189-194` |
| 3 | **Medium** | `GET /projects/:id?includeSecret=1` 返回明文凭证，代码零注释、零标记、零鉴权 | `apps/api/src/routes/projects.ts:303-309` |
| 4 | **Medium-Low** | orchestrator 的 worktree prepare 与 try/finally 之间存在异常窗口，失败残留会阻断重跑 | `apps/runner/src/orchestrator.ts:122-176` |
| 5 | **Low** | 凭证嵌入 git argv URL，本机 ps 可见；错误 sanitize 是精确字符串替换，编码变体可能漏掉 | `apps/runner/src/worktree.ts:122-130`、`apps/api/src/routes/projects.ts:355,703` |
| 6 | **Low（脆弱不变量）** | workflow-engine 其余 get→set 迁移依赖"单进程同步执行"这一隐式约定，无注释固化 | `apps/api/src/workflow-engine.ts:268-453,707-724,965-1009` |
| 7 | **Info** | command-runner 超时 SIGKILL 仅杀 leader 不杀进程组（注释已自认） | `apps/runner/src/command-runner.ts:95-96` |
| 8 | **Info** | SQLite 明文持久化 source_credential（本地单机可接受，记录现状） | `apps/api/src/store/store.ts:174` |
| 9 | **Info** | serve.ts safeJoin 前缀检查无尾分隔符（URL.pathname 规范化使其不可达，理论项） | `apps/web/serve.ts:23-27` |

---

## 1. 凭证字段（sourceCredential）数据流转卫生

### 全部出现点清单（grep 全仓 .ts，排除测试）

| 文件 | 行 | 性质 | 评估 |
|---|---|---|---|
| `packages/shared/src/types/project.ts` | 28 | 类型定义，含注释 "Runner-only credential. API list/register responses redact this field." | OK |
| `apps/api/src/routes/projects.ts` | 31,48,144,241-252,273-288,352-355,386,413,423,432,488,525,535,564,567 | 请求体接收/归一化/校验/错误消息 | 见下 |
| `apps/api/src/store/store.ts` | 149,174 | SQLite 行 ↔ 对象映射（`source_credential` 列，明文） | Info #8 |
| `apps/runner/src/api-client.ts` | 50,55 | runner 经 `?includeSecret=1` 取回 | 见 #3 |
| `apps/runner/src/worktree.ts` | 20,128 | 注入 credentialedUrl 给 git clone/fetch | 见 #5 |
| `apps/runner/src/index.ts` | 86,100；`cmd/register.ts` 15,49 | CLI flag → 注册请求体 | OK |
| `apps/web/src/page-projects.ts` | 79,214,414,425-438,743,791,857 | 表单 state，提交后即清空 | OK |
| `apps/web/src/types.ts` | 44-48,106 | `ProjectDto = Omit<Project,'sourceCredential'>` + `hasSourceCredential` | OK |

### 序列化响应剥离 — 已确认完整

`publicProject()`（`routes/projects.ts:523-537`）解构剥离 `sourceCredential`，替换为 `hasSourceCredential` 布尔值。所有返回项目对象的路径均经过它：

- `GET /`（:90）、`POST /` 新建（:157）与重名幂等返回（:133）、`POST /:id/archive`（:177）、`PUT /:id/agent-backend`（:229）、`PUT /:id`（:300）、`GET /:id` 默认分支（:308）。
- 唯一例外是 `GET /:id?includeSecret=1`（:307）`return c.json(project)` 返回全量对象 —— 见发现 #3。

### 日志 / 审计 / artifact 文本 — 未发现泄漏

- `audit.ts:9-23` 由调用方显式构造 payload；grep workflow-engine 全部 `audit(...)` 调用，payload 只含 id/status/stage/title 等字段，无 project 对象展开、无 credential。
- 全仓无 `console.log(project)` / `JSON.stringify(project)` 直接打印项目对象。
- runner 上下文包（`apps/runner/src/context/builder.ts`）只引用 `project.id` 与 profile markdown，且经 `sanitizeSensitiveContextText`（:148-150）；credential 不进入 artifact 文本。
- 错误消息：`validateCredentialInput`（projects.ts:557-570）只输出字段名（"sourceCredential is required..."），不回显值。

### redaction.ts（maskSecrets）使用覆盖度

定义于 `packages/shared/src/utils/redaction.ts:5-18`（sk-/gh[pousr]_/Bearer/key=value 五类模式）。调用点：

1. `packages/shared/src/utils/agent-backend-preflight.ts:7` — CLI 预检诊断输出；
2. `apps/runner/src/agents/claude-code.ts:288` — CC stderr 逐行 mask 后再 emit/打印；
3. `apps/runner/src/agents/codex.ts:201-204` — Codex stderr 同样处理。

覆盖缺口（均为防御深度层面，非已知泄漏）：
- agent **stdout**（stream-json 行）不经过 maskSecrets——payload 原样 emit 进 agent_events 表与 SSE。若 agent 在工作区内 cat 出含密钥文件，会进事件流。本地单机可接受，可作改进项。
- `sh.ts` / `command-runner.ts` 的 stdout/stderr 日志文件不 mask（whitelist 命令面窄，风险低）。
- maskSecrets 的 `key[:=]value` 模式无法匹配"凭证以裸 URL userinfo 形式出现"（`https://user:pass@host`）——与 #5 的 sanitizeGitError 互为补位，但两者都非穷尽。

### `GET /projects/:id?includeSecret=1` 现状（发现 #3，Medium）

```ts
// routes/projects.ts:303-309 —— 原文如此，无任何注释
projects.get('/:id', (c) => {
  const id = c.req.param('id');
  const project = store.projects.get(id) ?? store.projectByName(id);
  if (!project) return c.json({ error: 'not found' }, 404);
  if (c.req.query('includeSecret') === '1') return c.json(project);
  return c.json(publicProject(project));
});
```

- **现状**：该分支无注释、无内部标记、无任何调用方鉴别（header/token），任何能访问 API 端口的客户端传一个 query 参数即可取回明文凭证。
- 消费方仅 `apps/runner/src/api-client.ts:55`。
- 类型层有间接说明（`shared/types/project.ts:27` "Runner-only"、`web/types.ts:44-48`），但路由代码本身无说明 —— 任务关注的"注释说明"答案是：**没有**。
- 单独看（api 默认 127.0.0.1）可接受；与发现 #1 组合后变成实际暴露链。建议：加注释声明内部契约 + 至少加一个简单 runner header 校验，或迁移为 runner 专用路由前缀。

### 改进建议（凭证面）

1. `includeSecret=1` 分支补注释 + 最低限度的调用方标识。
2. agent stdout 事件入库前过一次 maskSecrets（容量小、纯函数，代价低）。
3. （可选）credential 列加最轻量的本地混淆或至少在 schema 注释里声明明文现状。

---

## 2. 服务监听面

### api — 正确

`apps/api/src/server.ts:4-5,18`：
```ts
const port = Number(process.env.AINP_API_PORT ?? 8787);
const hostname = process.env.AINP_API_HOST ?? '127.0.0.1';
const server = Bun.serve({ port, hostname, idleTimeout: 255, fetch: app.fetch });
```
默认 127.0.0.1，本机监听，符合预期。

### web — 发现 #1（High，改进项）

`apps/web/serve.ts:50` `Bun.serve({ port, fetch })` **未传 hostname**。Bun.serve 默认 hostname 为 `0.0.0.0`，即 web dev server 监听所有网卡。叠加因素：

- :56-67 它把 `/api/*` 原样反代到 `http://127.0.0.1:8787`（含 method/headers/body），等于把"只监听本机"的 api 完整暴露到局域网；
- 经反代可直接调 `GET /api/projects/:id?includeSecret=1` 取明文凭证（与 #3 组成链条）；
- 也暴露全部写操作（注册项目、审批、promote 等）。

**建议**：与 api 对齐 —— `const HOST = process.env.AINP_WEB_HOST ?? '127.0.0.1';` 并传入 `Bun.serve({ port, hostname: HOST, ... })`。一行改动。

---

## 3. 请求体防御性解析（路径拼接位）

路由层普遍使用 `(await c.req.json()) as {...}` 类型断言（projects.ts:110,123,237；knowledge-artifacts.ts:43,112,175,222,353 等），无运行时 schema 校验——但抽查的两个"字符串拼进文件路径"位点都有独立的硬校验层兜底：

### promote 的 codestable 目标路径 — 健壮

- 写盘路径 = `<project.localPath>/codestable/<kind-plural>/<entityId>.md`（`promote-file.ts:159-183`）。
- `entityId` **不直接取自请求体**：由 `promote.ts:80-84` 用 `\bREQ-(\d{1,6})\b` 正则从 draftText 提取，或 in-tx max+1 生成（:86-100,169-170）——两条路径产物都只含 `[A-Z-\d]`。
- 双重防御：`ENTITY_ID_PATTERN = /^(REQ|DSN)-\d{1,6}$/`（promote-file.ts:47）白名单；`resolveEntityFilePath` 不匹配即 throw（:177-181）；`promote.ts:237` 写盘前再 `isPathSafeEntityId` 检查一次，不匹配走跳过+log 分支（:284-286）。`..`、`/`、空白均不可能通过。
- `kind` 经 `KIND_TO_ENTITY` 映射 + `isKnowledgeArtifactKind` 校验（promote.ts:127-133）；目录段取自常量 `ENTITY_KIND_DIR`（:31-34），不受输入影响。
- `projectId` 必须命中 `store.projects.get`（:152-158），`localPath` 是注册时数据而非本次请求输入。
- 结论：**无路径穿越面**。残余事实：localPath 本身在注册时可指任意本机目录——这是产品语义（本地项目），非缺陷。

### artifact-content.ts 的 assertReadableFileUri — 健壮

`resolveReadableFileUri`（:48-59）：
1. 强制 `file://` 前缀；
2. `realpathSync(path)` —— **同时消解 symlink 与 `..` 相对成分**（realpath 返回规范绝对路径），相当于归一化校验；
3. 对文件真实目录做白名单根匹配，`isWithinResolvedRoot`（:65-72）对 root 也做 realpath，且用 `path === realRoot || path.startsWith(realRoot + '/')` —— 带尾分隔符，无前缀混淆（`/a/bx` 不会误判进 `/a/b`）；
4. 白名单根（:14-20）：AINP_ARTIFACTS_DIR / AINP_REPORTS_DIR / AINP_HOME / ~/.ai-native，tmpdir 仅测试模式。
- `uri.slice('file://'.length)` 不做百分号解码 → `%2e%2e` 保持字面量，realpathSync 对不存在的字面量目录直接 ENOENT throw，不构成绕过。
- 小瑕疵（info）：`file://localhost/path` 形式会被裁成 `localhost/path` 然后 ENOENT —— 行为安全只是不友好。

### 其余 `as {...}` 断言面

非路径类字段（status/decision/comment 等）普遍有枚举守卫（如 knowledge-artifacts.ts:354 `isKnowledgeArtifactStatus`）。类型断言模式整体是已知技术债，但抽查未发现"裸字符串直达 fs API"的第二处。

---

## 4. 并发正确性（延续 claim TOCTOU 修复视角）

### 已修复的基线

`claimWorkflowRequest`（workflow-engine.ts:202-219）→ `store.workflowRequests.claimIfPending`（store.ts:372）原子 `UPDATE ... WHERE status='pending'`；`markRunStartedIfClaimed`（store.ts:392）同模式，失败后的 get 仅用于区分 404/409 错误消息（workflow-engine.ts:225-237 注释明确）。

### 其余 get→set 迁移盘点（均非 WHERE 守卫）

| 函数 | 位置 | 模式 |
|---|---|---|
| `transitionStage` | :268-281 | get run → 改字段 → set |
| `setWorkspace` | :283-291 | 同上 |
| `completeWorkflowRun` | :339-350 | 同上 |
| `retryStage` | :364-407 | get run + steps → 重置 step → set run |
| `reEvaluateGate` | :414-453 | get run → 跑 gate → 条件改 run.status → set |
| `recordAcceptanceDecision`→`recordApproval` | :551-575, 965-1009 | latestForGate 幂等检查（get）→ runManualGate → insert |
| `setKnowledgeArtifactStatus` | :707-724 | get → 计算 metadata → updateStatus（UPDATE 无状态前置条件） |
| promote 的 supersede 循环 | promote.ts:177-180 | byEntityId（get）→ 逐条 setStatus |

### 暴露面评估 — 当前实际安全，但是脆弱不变量（发现 #6，Low）

关键事实：**所有这些函数从 get 到 set 全程同步、零 await**，运行在唯一持有 SQLite 的单一 Bun api 进程的事件循环上。多 runner + UI 并发只体现为 HTTP 请求排队——每个同步状态迁移天然原子，"UI 审批 vs runner 重评 vs 另一 runner promote"无法在 get/set 之间交错。promote 的 6 步还额外包在 `db.transaction`（bun:sqlite 同步事务）里，连同 supersede 循环一起原子。

与已修复 claim 的差别：claim 的修复价值在于**幂等语义**（两个 runner 先后 claim，第二个必须拿 null），而非进程内交错；其余迁移没有等价的"恰好一个赢家"需求——重复 approve 有 :969-981 幂等重放检查，重复 reEvaluate 是天然幂等的重算。

真正的风险是**演化脆弱性**：
1. 任何人在这些函数 get 与 set 之间引入一个 `await`（例如未来给 reEvaluateGate 加异步 LLM 评估），交错窗口立即出现且无任何防线；
2. 若未来 api 多进程化（Bun cluster / 多实例），全部假设作废；
3. `setKnowledgeArtifactStatus` 的 UPDATE 不带 `WHERE status = ?` 前置条件，乱序的两个 PATCH /:id/status 请求是 last-write-wins，没有状态机合法迁移校验（accepted→draft 也能写进去）。

**建议**（按性价比）：a) 在 workflow-engine.ts 头部注释固化"状态迁移函数必须全同步、禁止中途 await"的约定；b) `setKnowledgeArtifactStatus` 加合法迁移表 + `UPDATE ... WHERE status = ?` 守卫（与 claim 同模式，改动小）；c) 其余 get→set 暂不值得逐个改写。

---

## 5. 资源清理与异常路径

### promote.ts 事务回滚 — 完备

- `db.transaction(() => {...})`（promote.ts:165-231）是 bun:sqlite 同步事务，回调 throw 即自动 ROLLBACK；回调内全部调用（nextEntityIdFallback / setKnowledgeArtifactStatus / createKnowledgeArtifact / upsertHead）均同步，无 async 逃逸出事务边界。
- 事务前置 IO（ensureCodestableDir，:159）刻意放在 tx 之前 fail-fast；唯一残留是空的 `codestable/<kind>/` 目录，无害。
- 事务后置文件写失败：仅 console.error 不回滚（:267-277），DB/文件漂移是 PRD R10/R11 的**显式设计决策**，log 带 entityId+kart id 供对账；tmp 文件写失败有 unlink 兜底（promote-file.ts:232-236），tmp 名带随机后缀防并发碰撞（:226-227）。
- 评估：在其设计约束内完备。漂移扫描任务（注释多处提及"future drift-scan"）尚未存在，是已知欠账而非缺陷。

### runner 子进程超时兜底链 — 发现 #2（Medium）

| 位点 | 链条 | 评估 |
|---|---|---|
| `agents/claude-code.ts:251-254` | 硬超时 → SIGTERM，**无 SIGKILL 升级** | 缺兜底 |
| `agents/claude-code.ts:263-271` | post-result 宽限 → SIGTERM，同样无升级 | 缺兜底 |
| `agents/codex.ts:189-194` | 硬超时 → SIGTERM，无 SIGKILL（全文件 0 处 SIGKILL） | 缺兜底 |
| `sh.ts:33-38` | 超时直接 SIGKILL（无 TERM 先行，但保证有界） | OK |
| `command-runner.ts:93-97` | 超时 SIGKILL，仅杀 leader 不杀 pgid（注释自认 "future work"） | 发现 #7，Info |
| `agents/cli-common.ts:68-71` | 3s 探针超时 SIGKILL | OK |

核心问题：claude-code/codex 在 SIGTERM 后 `await new Promise(child.once('exit'))`（claude-code.ts:293-297）——若 CLI 捕获/忽略 SIGTERM（该文件 :48,:256-262 注释自己描述过"hooks、session keepalives 会让 CLI 赖着不退"的现实场景），exit 永不触发，**runner 整条 orchestration 永久挂起**，无第二层定时器。建议：SIGTERM 后加 5-10s 的 SIGKILL 升级定时器（与 sh.ts 风格统一）；spawn 时 `detached: true` + `process.kill(-pid)` 顺手解决 #7 的进程组问题。

### api SSE 流 abort 清理 — 健康

- `workflow-runs.ts:409-478` 与 `workflow-requests.ts:233-301` 同构：`stream.onAbort` 置标志（:411-413）；订阅释放放在 `finally { unsubscribe() }`（:475-477 / :300），任何路径（abort/写失败/throw）都释放总线回调，无监听器泄漏。
- 等待循环用 5s 自唤醒 setTimeout（:456-461），abort 后最迟 5s 退出循环——资源释放有界、略有延迟，可接受；history 重放路径每条检查 aborted（:446）。
- 配套：server.ts:18 `idleTimeout: 255` + 5s ping 防止 Bun 掐空闲连接；web 代理转发 `req.signal`（serve.ts:58-65 注释明确为防 FD 泄漏）——客户端断开会传导到上游 SSE。链路完整。

### worktree 失败残留 — 发现 #4（Medium-Low）

`orchestrator.ts` 的异常窗口：`env.prepare`（:122）成功后直到 `try`（:176）开始之前，有四个可抛点不受 finally 保护：
1. `api.workspacePrepared`（:123）HTTP 失败；
2. `mkdir runArtifactsDir`（:127）；
3. `loadContextPolicy()`（:129）；
4. 未知 flowId throw（:161-166）。

任一抛出 → worktree 已创建但 `env.cleanup` 永不执行。残留后果明确：同 runId 重跑时 `prepare` 在 `worktree.ts:37-39` 撞 "worktree path already exists" 直接 throw（runId 唯一性使该场景罕见，但 git 侧的 worktree 注册项与 `ai/{runId}-*` 分支会在源仓库累积）。次级残留：prepare 内 `mkdir`（worktree.ts:40）成功而 `git worktree add` 失败（:43-52）时留下空的 `{projectId}/{runId}` 目录。

`cleanup` 本身的兜底是好的（worktree.ts:70-85）：git worktree remove --force 失败 → 回退 `rm -rf`；分支删除 best-effort。但注意回退 rm 只删目录**不删 git 的 worktree 注册记录**，依赖后续 git 自身的 `worktree prune`。

`cmd/run.ts:141` 的手动路径 cleanup 同样不在 finally 中（基于 :30 注释的步骤式结构）。

**建议**：把 try 块上移到 `env.prepare` 之后第一行（即 :123 起全部纳入），finally 不变；或给 prepare 失败路径补 `rm` 父目录。改动局部、低风险。

---

## Caveats / Not Found

- 未运行任何测试/构建，全部结论基于静态阅读。
- Bun.serve 默认 hostname=0.0.0.0 基于 Bun 文档化行为，未在本机实测端口绑定。
- 未审查 `apps/runner/src/agents/coordinator/llm-fallback.ts` 的 SIGTERM 链（:443,:502）细节，模式上与 codex 同源，大概率同样缺 SIGKILL 升级，列为待确认。
- maskSecrets 对 agent stdout 的缺口是防御深度评估，未发现实际泄漏样本。
