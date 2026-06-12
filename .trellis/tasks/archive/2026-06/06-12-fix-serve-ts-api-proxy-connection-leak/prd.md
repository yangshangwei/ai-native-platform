# PRD: 修复 serve.ts /api 代理连接泄漏

## 背景

今天两次实测（详见 archive/2026-06/06-12-split-web-independent-page-modules-from-main-ts/notes.md）：
apps/web/serve.ts 的 /api 代理随页面访问累积 ESTABLISHED 连接不释放，每次都精确卡在 262 条
（撞连接池/FD 上限）后代理整体挂死——静态路径正常、/api 全部无限挂起，浏览器侧表现为
ERR_INSUFFICIENT_RESOURCES 洪水。强相关因素：页面打开 agent-stream SSE（EventSource），
客户端断开后上游 fetch 未被取消。

## 根因假设（实施时验证）

serve.ts 代理把客户端请求转发为 `fetch(上游)` 并回传 Response，但未把客户端断开
（request.signal）透传给上游 fetch；SSE 这类长连接在浏览器端关闭后上游连接永久滞留。

## 需求

1. 代理转发时把客户端 `request.signal` 透传给上游 fetch（AbortSignal），客户端断开 → 上游连接关闭。
2. 验证 SSE 场景：浏览器开/关 agent-stream 反复多次后，serve 进程对 8787 的 ESTABLISHED 连接数应回落、不单调增长。
3. 普通 JSON 请求行为不变（状态码、头、体转发逐项保持）。
4. apps/web/test/serve.test.ts 现有断言全绿；新增一个回归测试：代理请求被客户端 abort 后上游请求收到取消（可用本地 mock 上游 server 断言其连接被关闭/请求 signal aborted）。

## 边界

- 只改 apps/web/serve.ts 与其测试；不动页面代码、不动 api。
- dev-only 工具，不需要过度工程（重试/池化等一概不加）。

## 验收标准

1. `bun run typecheck`、`bun x --bun vitest run` 全绿（630+ 新增）
2. 实测：重启 dev server 后，用脚本/浏览器连续开关 20 次 SSE，`lsof -p <pid> | grep ESTABLISHED` 计数回落不累积
