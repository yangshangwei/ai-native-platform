## 冒烟时发现的环境缺陷（非本任务代码问题）

apps/web/serve.ts 的 /api 代理会累积 ESTABLISHED 连接不释放（实测挂死时堆积 262 条，
疑似 SSE 代理转发未在客户端断开时关闭上游连接）。长时间运行后代理整体挂死：
静态路径正常、/api 全部超时，页面侧表现为 ERR_INSUFFICIENT_RESOURCES 洪水。
临时处置：重启 dev server。根治建议：代理转发时跟踪 client abort 并关闭上游
fetch（AbortSignal 透传），加入路线图 T4 轨道。
