/**
 * Test-surface analyzer (test_integrity_gate evidence layer).
 *
 * Pure counting functions over Java/JUnit sources plus the pom.xml test
 * harness config. The runner compares the doer-turn baseline (worktree HEAD)
 * against the working tree and ships the resulting `TestSurfaceReport` as a
 * per-run artifact; the API-side Gate Engine turns it into rule verdicts.
 *
 * Deliberately NOT a Java parser: a lightweight comment/string state machine
 * is enough to count annotation and call sites deterministically. Java/JUnit
 * 4+5 only (the platform's current delivery surface).
 */

export const TEST_SURFACE_REPORT_SCHEMA_VERSION = 'test-surface-report/v1' as const;

export interface TestSurfaceCounts {
  /** Plain `@Test` annotations (JUnit 4/5, incl. `@Test(...)` param form). */
  testCases: number;
  /** Assertion call sites: `assert*` / `assertThat` / `verify` / `fail` followed by `(`. */
  assertions: number;
  /** `@Ignore` / `@Disabled` markers (incl. reasons and `@Disabled*` variants). */
  skipMarkers: number;
  /** `@Test` occurrences inside comments — a commented-out test. */
  commentedTests: number;
}

export interface TestSurfaceFileEntry {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  /** Pre-rename path; only present for `renamed` entries. */
  oldPath?: string;
  /** Baseline counts (HEAD). Absent for added files or unreadable baselines. */
  before?: TestSurfaceCounts;
  /** Working-tree counts. Absent for deleted files or unreadable files. */
  after?: TestSurfaceCounts;
}

export interface TestSurfaceReport {
  schemaVersion: typeof TEST_SURFACE_REPORT_SCHEMA_VERSION;
  /** Resolved baseline commit (HEAD at collection time), null when unresolvable. */
  baseRef: string | null;
  /** Java test files touched by the doer turn. */
  files: TestSurfaceFileEntry[];
  harness: {
    /** mvnw / mvnw.cmd / .mvn/** paths changed by the doer turn. */
    changedPaths: string[];
    /** True when a pom.xml surefire/failsafe/skip config extract differs. */
    pomTestConfigChanged: boolean;
  };
  /** False when git baseline collection failed — gate rules fail open. */
  baselineAvailable: boolean;
  /** Collector diagnostics (git failures, unreadable files, …). */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Comment/string splitting
// ---------------------------------------------------------------------------

interface SplitSource {
  /** Source with comments removed and string/char literal contents blanked. */
  code: string;
  /** Concatenated comment text (line + block comments). */
  comments: string;
}

/**
 * Splits Java source into code and comment text. String and char literal
 * contents are blanked in the code half so `"assertTrue("` inside a literal
 * never counts as an assertion site.
 */
function splitComments(source: string): SplitSource {
  let code = '';
  let comments = '';
  type State = 'code' | 'line_comment' | 'block_comment' | 'string' | 'char';
  let state: State = 'code';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    const next = source[i + 1];
    switch (state) {
      case 'code':
        if (ch === '/' && next === '/') {
          state = 'line_comment';
          i += 1;
        } else if (ch === '/' && next === '*') {
          state = 'block_comment';
          i += 1;
        } else if (ch === '"') {
          state = 'string';
          code += ch;
        } else if (ch === "'") {
          state = 'char';
          code += ch;
        } else {
          code += ch;
        }
        break;
      case 'line_comment':
        if (ch === '\n') {
          state = 'code';
          code += ch;
          comments += ch;
        } else {
          comments += ch;
        }
        break;
      case 'block_comment':
        if (ch === '*' && next === '/') {
          state = 'code';
          comments += '\n';
          i += 1;
        } else {
          comments += ch;
        }
        break;
      case 'string':
        if (ch === '\\') {
          i += 1; // skip escaped char
        } else if (ch === '"' || ch === '\n') {
          state = 'code';
          code += ch;
        }
        break;
      case 'char':
        if (ch === '\\') {
          i += 1;
        } else if (ch === "'" || ch === '\n') {
          state = 'code';
          code += ch;
        }
        break;
    }
  }
  return { code, comments };
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

/** `@Test` and `@Test(...)`, but not `@TestFactory` / `@TestTemplate`. */
const TEST_ANNOTATION_RE = /@Test\b/g;
/** Assertion call sites (JUnit 4/5 + Mockito common surface). */
const ASSERTION_CALL_RE = /\b(assert\w*|assertThat|verify|fail)\s*\(/g;
/** `@Ignore` (JUnit 4) and `@Disabled` + conditional variants (JUnit 5). */
const SKIP_MARKER_RE = /@(Ignore\b|Disabled\w*)/g;

/**
 * Counts the test surface of a single Java source. Never throws — any
 * string input yields deterministic counts.
 */
export function countTestSurface(source: string): TestSurfaceCounts {
  const { code, comments } = splitComments(source);
  return {
    testCases: countMatches(code, TEST_ANNOTATION_RE),
    assertions: countMatches(code, ASSERTION_CALL_RE),
    skipMarkers: countMatches(code, SKIP_MARKER_RE),
    commentedTests: countMatches(comments, TEST_ANNOTATION_RE),
  };
}

// ---------------------------------------------------------------------------
// pom.xml harness config extraction
// ---------------------------------------------------------------------------

const POM_PLUGIN_BLOCK_RE = /<plugin>[\s\S]*?<\/plugin>/g;
const POM_TEST_PLUGIN_RE = /maven-(surefire|failsafe)-plugin/;
const POM_SKIP_LINE_RE = /skipTests|maven\.test\.skip/;

/**
 * Extracts a normalized fingerprint of the test-harness-relevant parts of a
 * pom.xml: surefire/failsafe `<plugin>` blocks plus any line touching
 * `skipTests` / `maven.test.skip`. Whitespace is collapsed so formatting-only
 * edits compare equal. Returns '' when the pom has no such config, so
 * "added a dependency" style edits do not trip the harness rule.
 */
export function extractPomTestConfig(pomXml: string): string {
  const parts: string[] = [];
  for (const block of pomXml.match(POM_PLUGIN_BLOCK_RE) ?? []) {
    if (POM_TEST_PLUGIN_RE.test(block)) {
      parts.push(block.replace(/\s+/g, ' ').trim());
    }
  }
  for (const line of pomXml.split('\n')) {
    if (POM_SKIP_LINE_RE.test(line)) {
      parts.push(line.replace(/\s+/g, ' ').trim());
    }
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------

/** True for `.java` files under a Maven `src/test/` tree (repo-root or module). */
export function isJavaTestFile(path: string): boolean {
  if (!path.endsWith('.java')) return false;
  return path.startsWith('src/test/') || path.includes('/src/test/');
}
