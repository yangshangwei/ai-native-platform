import {
  agentBackendDisplayName,
  type Project,
  type ProjectAgentBackendKind,
} from '@ainp/shared';
import type { AgentBackend } from './agents/native';
import { ClaudeCodeBackend } from './agents/claude-code';
import { CodexBackend } from './agents/codex';
import { preflightAgentBackend } from './agent-backend-preflight';

export async function selectAgentBackend(
  project: Project,
): Promise<AgentBackend> {
  const backend = resolveBackendKind(project);
  const preflight = await preflightAgentBackend(backend);
  if (!preflight.runnable) {
    throw new Error([
      `${preflight.label} is not ready (${preflight.status}).`,
      preflight.error,
      preflight.remediationHint,
    ].filter(Boolean).join(' '));
  }

  if (backend === 'codex') {
    console.log(`[runner] backend = Codex (bin=${preflight.bin}, version=${preflight.version ?? 'unknown'})`);
    return new CodexBackend({ bin: preflight.bin ?? undefined });
  }
  console.log(`[runner] backend = Claude Code (bin=${preflight.bin}, version=${preflight.version ?? 'unknown'})`);
  return new ClaudeCodeBackend({ bin: preflight.bin ?? undefined });
}

function resolveBackendKind(project: Project): ProjectAgentBackendKind {
  if (project.agentBackend) return project.agentBackend;

  throw new Error(
    `Project ${project.name} has no Agent Backend configured. Choose Claude Code or Codex in project settings before starting a workflow.`,
  );
}

export function backendLabel(kind: ProjectAgentBackendKind): string {
  return agentBackendDisplayName(kind);
}
