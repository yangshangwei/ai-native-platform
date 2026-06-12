# PRD: db 迁移显式化（路线图 T4.3）

## 背景

研究依据：archive 任务 research/api-architecture.md §2.6 与建议表 #12。
`apps/api/src/store/db.ts`（471 行）当前在 **import 时**执行全部建表与迁移（模块顶层副作用），
`AINP_DB_PATH` 也在 import 时读取；无迁移版本表，靠 `PRAGMA table_info` 逐列探测式 ALTER，
`agent_events` 重建逻辑内联在模块顶层。后果：30 个 api 测试都被迫"先设 env 再动态 `await import`"，
迁移历史不可追溯，新迁移只能继续堆探测代码。

## 目标（行为保持 + 工程化）

1. **显式初始化**：导出 `initDb()`（幂等），建表 + 迁移全部移入；模块顶层仅保留惰性单例壳。
   对外 API 兼容：现有消费方（store.ts、workflow-engine、promote 等）经现有 `db` 导出拿连接的方式不破——
   可用 lazy getter（首次访问时自动 initDb）保证生产路径零改动，测试路径获得显式控制。
2. **迁移版本表**：`schema_migrations(version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)`。
   既有探测式迁移改写为编号迁移列表 `MIGRATIONS: { version, name, up(db) }[]`，按版本号顺序应用、记账。
   **对存量数据库的首次接管**：版本表不存在时，先跑一次"基线探测"把现状对齐到对应版本（复用现有 PRAGMA 探测逻辑
   作为 baseline 判定），避免对已迁移过的库重复 ALTER 报错。新库直接顺序跑全部迁移。
3. **测试 bootstrap 简化**：测试仍可用"env + 动态 import"旧法（lazy getter 兼容），但新增推荐路径：
   `initDb({ path })` 显式传参。30 个测试文件**不强制全量改写**——本任务只改 2-3 个代表性测试示范新路径，
   其余保持零改动（兼容层保证它们继续绿）。
4. **spec 更新**：在 `.trellis/spec/api/backend/`（database 主题 spec 现标 "To fill"，可顺势补一份
   `database.md` 最小版）写明迁移纪律：新迁移=追加 MIGRATIONS 条目，禁再写探测式 ALTER。

## 边界

- 不改任何表结构本身；迁移后的最终 schema 与现状逐列一致（用 PRAGMA 对比验证）。
- 不动 store.ts 的表工厂与各 repo。
- promote.ts / workflow-engine.ts 直接 import db 开事务的现状保持。

## 验收标准

1. `bun run typecheck`、`bun x --bun vitest run` 全绿（694 + 新增）
2. **schema 等价证据**：脚本对比"旧代码建的库"与"新迁移建的库"的全部表/列/索引（`sqlite_master` + `PRAGMA table_info`）逐项一致
3. **存量库接管证据**：用旧代码建库并写入数据后，切换新代码打开——迁移记账正常、数据完好、无重复 ALTER 错误
4. 新增单测：迁移幂等（连开两次）、版本顺序、基线接管
5. 既有 30 个测试文件改动数 ≤ 3（仅示范性改写）
