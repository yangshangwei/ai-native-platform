import type { WorkflowStage } from './workflow';
import type { GateId } from './gate';
import type { AgentBackendKind } from './agent';

/**
 * Canonical SkillSpec — owned by the platform. Backend-agnostic.
 * Runtime adapters convert this into a backend-specific bundle (prompt, tools).
 */
export interface SkillSpec {
  id: string;
  version: string;
  stage: WorkflowStage;
  instructions: string;
  inputs: SkillIO[];
  outputs: SkillIO[];
  toolPolicy: ToolPolicy;
  requiredGates: GateId[];
  compatibleBackends: AgentBackendKind[];
}

export interface SkillIO {
  name: string;
  kind: 'artifact' | 'text' | 'json';
  required: boolean;
  description: string;
}

export interface ToolPolicy {
  /** Commands the agent may suggest; final approval still goes through whitelist. */
  allowedCommands: string[];
  /** Filesystem globs the agent may write to (relative to workspace). */
  writableGlobs: string[];
  /** Whether the backend may call the network. Reserved. */
  networkAllowed: boolean;
}
