# 上下文注入机制设计文档

## Goal

将本次关于“AI 云原生开发平台如何为 Claude Code / Codex 等执行后端按项目生命周期按需注入上下文”的讨论落地为可后续优化实现的设计文档。文档不使用 `.trellis` 作为平台方案依赖，而是抽象为平台自有 Context Injection Layer，覆盖 greenfield / growing / legacy 三类项目成熟度。

## What I already know

- 项目是 AI 云原生开发平台，后端通过 Claude Code / Codex 等 coding backend 执行工程任务。
- 用户希望把上下文注入从“老项目知识恢复”扩展为项目生命周期机制：新项目要播种上下文，成长中项目要持续校准，遗留项目要恢复证据。
- 既有平台文档已经有 Context Pack、AgentBackend、Knowledge Capture、Workflow/Gate 等设计沉淀。
- 本次目标是写文档，不做代码实现。

## Requirements

- 产出平台设计文档，沉淀：目标、非目标、Project Maturity Profile、Seed / Recovered / Confirmed 知识类别、架构、数据模型、注入分层、ContextPack mode / budget、Claude Code / Codex 适配、安全、MVP 路线。
- 明确不依赖 `.trellis`；可建议平台自有 `.ai/` 或数据库知识库结构。
- 更新 `docs/README.md`，让后续能从文档索引找到该设计。
- 与已有 `Context Pack`、`AgentBackend`、`Knowledge Capture` 文档保持概念一致。

## Acceptance Criteria

- [ ] 新文档位于 `docs/`，标题和文件名能表达“项目生命周期上下文注入机制”。
- [ ] 文档包含新项目 Bootstrap、成长项目持续校准、遗留项目 Recovery 的可执行路线，而不仅是抽象讨论。
- [ ] 文档明确 Claude Code / Codex 只是 backend adapter，平台拥有控制平面和上下文包协议。
- [ ] 文档明确上下文预算、按需扩展、证据优先、prompt injection 防护。
- [ ] `docs/README.md` 已更新索引，且入口描述不再局限于 legacy-only framing。

## Out of Scope

- 不修改运行时代码。
- 不引入新依赖。
- 不设计 UI 细节到组件级。
- 不使用 `.trellis` 作为最终平台注入机制的一部分。

## Technical Notes

- 参考文档：
  - `docs/2026-05-01-ai-native-platform-context-pack-notes.md`
  - `docs/2026-05-02-ai-native-platform-context-pack-notes-2.md`
  - `docs/2026-05-01-ai-native-platform-agent-backend-notes.md`
  - `docs/2026-05-06-technical-architecture-design.md`
  - `docs/README.md`
