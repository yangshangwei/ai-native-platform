#!/usr/bin/env bun
import { cmdRegister } from './cmd/register';
import { cmdRun } from './cmd/run';
import { cmdDoctor } from './cmd/doctor';
import { cmdWatch } from './cmd/watch';
import { cmdOrchestrate } from './orchestrator';
import { api } from './api-client';

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
  ainp-runner register --path <path> --name <name>
  ainp-runner run --project <name> --command "<whitelisted command>" [--title <t>] [--keep-worktree]
  ainp-runner orchestrate --project <name> --title "<task>" [--keep-worktree]
  ainp-runner watch [--once] [--poll-ms <ms>] [--keep-worktree]

Examples:
  ainp-runner doctor
  ainp-runner register --path ./examples/java-maven-sample --name java-sample
  ainp-runner run --project java-sample --command "mvn -B test" --title "smoke mvn test"
  ainp-runner orchestrate --project java-sample --title "add a no-op marker comment"
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
      const path = String(flags.path ?? '');
      const name = String(flags.name ?? '');
      if (!path || !name) usage();
      await cmdRegister({ path, name });
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
      await cmdOrchestrate({
        project,
        title,
        cleanup: !flags['keep-worktree'],
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
