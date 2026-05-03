/**
 * Tiny template helper for runtime-config string fields that contain
 * `${var}` placeholders. Resolves placeholders from a vars map; missing
 * keys become empty strings.
 *
 * Used primarily by the Coordinator's `large_scope_template` fallback
 * question, which embeds the matched trigger keyword:
 *
 *   "这听起来是个比较大的需求（涉及"${trigger}"）..."
 *
 * IMPORTANT: this is NOT a JS template literal. Defaults loaded from
 * the config layer are plain strings, not tagged-template results.
 * Do not pass user input as the template string itself — placeholders
 * are recognised by literal `${name}`. Bracketed property access,
 * arithmetic, function calls etc. are NOT supported and intentionally
 * ignored.
 */
export function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_match, name: string) => {
    const v = vars[name];
    return typeof v === 'string' ? v : '';
  });
}
