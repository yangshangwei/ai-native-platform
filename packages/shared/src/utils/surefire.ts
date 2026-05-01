/**
 * Maven Surefire / Failsafe report parser.
 *
 * Surefire writes one XML file per test class to `target/surefire-reports/`.
 * The aggregate counts live as attributes on the root <testsuite> tag; we
 * regex-extract them to avoid a full XML dependency.
 *
 * Format (Surefire 3.x):
 *
 *   <testsuite name="..." tests="N" failures="N" errors="N" skipped="N" time="..">
 *     <testcase ...>...</testcase>
 *   </testsuite>
 */
export interface TestSuiteSummary {
  name: string;
  total: number;
  failures: number;
  errors: number;
  skipped: number;
  /** Seconds, NaN if unparseable. */
  time: number;
}

export function parseSurefireSummary(xml: string): TestSuiteSummary | null {
  const m = xml.match(/<testsuite\b([^>]*)>/);
  if (!m) return null;
  const attrs = m[1] ?? '';
  const get = (name: string): string => {
    const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`);
    const am = attrs.match(re);
    return am ? (am[1] ?? '') : '';
  };
  const num = (s: string): number => {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    name: get('name'),
    total: num(get('tests')),
    failures: num(get('failures')),
    errors: num(get('errors')),
    skipped: num(get('skipped')),
    time: Number(get('time')),
  };
}

export interface SurefireAggregate {
  framework: 'maven-surefire' | 'maven-failsafe';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  suites: TestSuiteSummary[];
  /** Source paths the aggregate was assembled from. */
  reportPaths: string[];
}

export function aggregateSurefire(
  framework: SurefireAggregate['framework'],
  parsed: Array<{ path: string; summary: TestSuiteSummary }>,
): SurefireAggregate {
  const total = parsed.reduce((a, p) => a + p.summary.total, 0);
  const failures = parsed.reduce((a, p) => a + p.summary.failures, 0);
  const errors = parsed.reduce((a, p) => a + p.summary.errors, 0);
  const skipped = parsed.reduce((a, p) => a + p.summary.skipped, 0);
  return {
    framework,
    total,
    passed: total - failures - errors - skipped,
    failed: failures,
    skipped,
    errors,
    suites: parsed.map((p) => p.summary),
    reportPaths: parsed.map((p) => p.path),
  };
}
