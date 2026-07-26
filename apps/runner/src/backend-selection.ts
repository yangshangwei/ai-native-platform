import {
  OperationalError,
  agentBackendDisplayName,
  type Project,
  type ProjectAgentBackendKind,
} from '@ainp/shared';
import type { AgentBackend } from './agents/types';
import { ClaudeCodeBackend } from './agents/claude-code';
import { CodexBackend } from './agents/codex';
import { preflightAgentBackend } from '@ainp/shared/node';

export async function selectAgentBackend(
  project: Project,
  override?: ProjectAgentBackendKind | null,
): Promise<AgentBackend> {
  const backend = resolveBackendKind(project, override);
  const preflight = await preflightAgentBackend(backend);
  if (!preflight.runnable) {
    // 07-26 operational pause (R2): a failed preflight (CLI missing / not
    // logged in / not runnable) is an operational condition, not a business
    // failure — the orchestrator pauses the run instead of failing it.
    throw new OperationalError('backend_unavailable', [
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

function resolveBackendKind(
  project: Project,
  override?: ProjectAgentBackendKind | null,
): ProjectAgentBackendKind {
  if (override) return override;
  if (project.agentBackend) return project.agentBackend;

  throw new Error(
    `Project ${project.name} has no Agent Backend configured. Choose Claude Code or Codex in project settings before starting a workflow.`,
  );
}

export function backendLabel(kind: ProjectAgentBackendKind): string {
  return agentBackendDisplayName(kind);
}
