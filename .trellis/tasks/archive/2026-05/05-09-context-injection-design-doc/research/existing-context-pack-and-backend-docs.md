# Existing Context Pack / AgentBackend docs reviewed

## Sources

- `docs/2026-05-01-ai-native-platform-context-pack-notes.md`
- `docs/2026-05-02-ai-native-platform-context-pack-notes-2.md`
- `docs/2026-05-01-ai-native-platform-agent-backend-notes.md`
- `docs/2026-05-06-technical-architecture-design.md`
- `docs/README.md`

## Findings

- Existing Context Pack principle is “薄初始化 + 需求阶段按需感知 + 验收后回写”.
- Revised Context Pack design separates business view for humans and technical view for downstream agents.
- Platform architecture already treats AgentBackend as pluggable: Claude Code / Codex are execution backends, not the control plane.
- Existing architecture names Context Pack as a per-run ArtifactKind and KnowledgeArtifact as project-scoped versioned knowledge.
- New document should extend this into a provider-neutral injection mechanism for legacy project knowledge, explicitly avoiding `.trellis` as product dependency.
