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

export function isWhitelisted(command: string): boolean {
  const trimmed = command.trim();
  return COMMAND_WHITELIST.some((re) => re.test(trimmed));
}
