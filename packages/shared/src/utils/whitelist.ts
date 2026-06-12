/**
 * MVP command whitelist. Anything the runner spawns must match one of these
 * patterns exactly OR be allow-listed at runtime by an explicit human
 * approval. The platform's gates only trust commands that came from here.
 */
export const COMMAND_WHITELIST: readonly RegExp[] = [
  /^git status$/,
  /^git diff$/,
  /^git diff --name-only$/,
  /^git rev-parse HEAD$/,
  /^\.\/mvnw -B -DskipTests compile$/,
  /^\.\/mvnw -B test$/,
  /^mvn -B -DskipTests compile$/,
  /^mvn -B test$/,
];

export function isWhitelisted(command: string, extraAllow?: readonly string[]): boolean {
  const trimmed = command.trim();
  if (COMMAND_WHITELIST.some((re) => re.test(trimmed))) return true;
  // Project-level additions (e.g. a registered project's custom build/test
  // commands) are exact-string matches after trim — never regex/prefix.
  return Boolean(extraAllow?.some((allowed) => allowed.trim() === trimmed && trimmed.length > 0));
}

/**
 * Validates a project-level custom build/test command at registration time.
 * Returns a human-readable rejection reason, or null when acceptable.
 *
 * The runner spawns commands without a shell (`command.split(/\s+/)` →
 * `spawn(program, args)`), so shell syntax would not work as the user
 * expects and is an injection hazard — reject it up front. Quoted arguments
 * are likewise unsupported (whitespace splitting): documented limitation.
 */
export function customBuildCommandError(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return 'command must not be empty';
  // Control characters (newline, carriage return, tab, NUL, ...) survive the
  // outer trim when embedded mid-string. They are never legitimate in a
  // single spawn command line and would be confusing under whitespace
  // splitting -- reject them outright. Use single spaces between arguments.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return 'command must not contain control characters such as newlines or tabs (use single spaces between arguments)';
  }
  const forbidden = ['&&', '||', ';', '|', '>', '<', '`', '$(', '"', "'"];
  for (const token of forbidden) {
    if (trimmed.includes(token)) {
      return `command must not contain shell metacharacter "${token}" (commands run without a shell, whitespace-split)`;
    }
  }
  return null;
}
