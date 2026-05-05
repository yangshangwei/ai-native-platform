#!/usr/bin/env bun
import { cmdRegister } from './cmd/register';
import { cmdRun } from './cmd/run';
import { cmdDoctor } from './cmd/doctor';
import { cmdWatch } from './cmd/watch';
import { cmdOrchestrate } from './orchestrator';
import { api } from './api-client';
import type { FlowId } from '@ainp/shared';

const KNOWN_FLOW_IDS: readonly FlowId[] = ['feature.standard', 'feature.fastforward', 'issue.standard'];
function parseFlowIdFlag(raw: unknown): FlowId | undefined {
  if (raw === undefined || raw === true) return undefined;
  const s = String(raw);
  if ((KNOWN_FLOW_IDS as readonly string[]).includes(s)) return s as FlowId;
  console.error(
    `[runner] --flow-id must be one of: ${KNOWN_FLOW_IDS.join(', ')} (got: ${s})`,
  );
  process.exit(2);
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return flags;
}

function usage(): never {
  console.log(`ainp-runner — Local Runner for AI Native Platform

Usage:
  ainp-runner health
  ainp-runner doctor
  ainp-runner register --path <path> --name <name> [--agent-backend <claude_code|codex>]
  ainp-runner register --url <git-url> --source <github|gitee|git|gitlab> --name <name> [--branch <branch>] [--agent-backend <claude_code|codex>]
  ainp-runner run --project <name> --command "<whitelisted command>" [--title <t>] [--keep-worktree]
  ainp-runner orchestrate --project <name> --title "<task>" [--flow-id <feature.standard|feature.fastforward|issue.standard>] [--keep-worktree]
  ainp-runner watch [--once] [--poll-ms <ms>] [--keep-worktree]

Examples:
  ainp-runner doctor
  ainp-runner register --path ./examples/java-maven-sample --name java-sample
  ainp-runner register --url git@gitlab.internal.example.com:platform/app.git --source gitlab --name platform-app
  ainp-runner run --project java-sample --command "mvn -B test" --title "smoke mvn test"
  ainp-runner orchestrate --project java-sample --title "add a no-op marker comment"
  ainp-runner orchestrate --project java-sample --title "tweak readme typo" --flow-id feature.fastforward
  ainp-runner watch --once
`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand) usage();
  const flags = parseFlags(rest);

  switch (subcommand) {
    case 'health': {
      const r = await api.health();
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case 'doctor': {
      await cmdDoctor();
      return;
    }
    case 'register': {
      const path = typeof flags.path === 'string' ? flags.path : undefined;
      const sourceUrl = typeof flags.url === 'string' ? flags.url : undefined;
      const sourceKind = typeof flags.source === 'string' ? flags.source : undefined;
      const defaultBranch = typeof flags.branch === 'string' ? flags.branch : undefined;
      const sourceAuthKind = typeof flags.auth === 'string' ? flags.auth : undefined;
      const sourceUsername = typeof flags.username === 'string' ? flags.username : undefined;
      const sourceCredential = typeof flags.token === 'string' ? flags.token : typeof flags.password === 'string' ? flags.password : undefined;
      const agentBackend = typeof flags['agent-backend'] === 'string' ? flags['agent-backend'] : undefined;
      const name = String(flags.name ?? '');
      if (!name || (!path && !sourceUrl)) usage();
      if (sourceKind && !['local', 'github', 'gitee', 'git', 'gitlab'].includes(sourceKind)) usage();
      if (agentBackend && !['claude_code', 'codex'].includes(agentBackend)) usage();
      await cmdRegister({
        path,
        name,
        sourceUrl,
        sourceKind: sourceKind as Parameters<typeof cmdRegister>[0]['sourceKind'],
        defaultBranch,
        sourceAuthKind: sourceAuthKind as Parameters<typeof cmdRegister>[0]['sourceAuthKind'],
        sourceUsername,
        sourceCredential,
        agentBackend: agentBackend as Parameters<typeof cmdRegister>[0]['agentBackend'],
      });
      return;
    }
    case 'run': {
      const project = String(flags.project ?? '');
      const command = String(flags.command ?? '');
      if (!project || !command) usage();
      await cmdRun({
        project,
        command,
        title: typeof flags.title === 'string' ? flags.title : undefined,
        keepWorktree: Boolean(flags['keep-worktree']),
      });
      return;
    }
    case 'orchestrate': {
      const project = String(flags.project ?? '');
      const title = String(flags.title ?? '');
      if (!project || !title) usage();
      const flowId = parseFlowIdFlag(flags['flow-id']);
      await cmdOrchestrate({
        project,
        title,
        cleanup: !flags['keep-worktree'],
        flowId,
      });
      return;
    }
    case 'watch': {
      await cmdWatch({
        once: Boolean(flags.once),
        pollMs:
          typeof flags['poll-ms'] === 'string' ? Number(flags['poll-ms']) : undefined,
        keepWorktree: Boolean(flags['keep-worktree']),
      });
      return;
    }
    default:
      usage();
  }
}

main().catch((err) => {
  console.error('[runner] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
