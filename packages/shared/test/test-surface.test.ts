import { describe, it, expect } from 'vitest';
import {
  TEST_SURFACE_REPORT_SCHEMA_VERSION,
  countTestSurface,
  extractPomTestConfig,
  isJavaTestFile,
} from '../src/utils/test-surface';

describe('countTestSurface', () => {
  it('counts @Test annotations including the JUnit4 parameterized form', () => {
    const src = [
      'import org.junit.jupiter.api.Test;',
      '',
      'class CalculatorTest {',
      '  @Test',
      '  void adds() {',
      '    assertEquals(4, Calculator.add(2, 2));',
      '    assertTrue(Calculator.add(1, 1) > 0);',
      '  }',
      '',
      '  @Test(expected = IllegalArgumentException.class)',
      '  public void rejectsNull() {',
      '    fail("should have thrown");',
      '  }',
      '}',
    ].join('\n');
    const counts = countTestSurface(src);
    expect(counts.testCases).toBe(2);
    expect(counts.assertions).toBe(3);
    expect(counts.skipMarkers).toBe(0);
    expect(counts.commentedTests).toBe(0);
  });

  it('does not count @TestFactory or @TestTemplate as plain @Test', () => {
    const src = [
      '@TestFactory',
      'Stream<DynamicTest> dynamic() { return Stream.empty(); }',
      '@TestTemplate',
      'void template() {}',
      '@Test',
      'void real() {}',
    ].join('\n');
    expect(countTestSurface(src).testCases).toBe(1);
  });

  it('counts assertion call sites for assert*/assertThat/verify/fail', () => {
    const src = [
      'assertThat(result).isEqualTo(3);',
      'verify(service).save(any());',
      'assertNotNull(value);',
      'fail();',
      'Assertions.assertThrows(RuntimeException.class, () -> run());',
    ].join('\n');
    expect(countTestSurface(src).assertions).toBe(5);
  });

  it('does not count lookalike identifiers as assertion sites', () => {
    const src = [
      'failFast(true);', // `fail` requires an immediate `(`
      'int failures = 3;',
      'this.verifyLater = value;',
    ].join('\n');
    expect(countTestSurface(src).assertions).toBe(0);
  });

  it('counts @Ignore and @Disabled variants (with and without reasons)', () => {
    const src = [
      '@Ignore',
      'void a() {}',
      '@Ignore("slow")',
      'void b() {}',
      '@Disabled',
      'void c() {}',
      '@Disabled("flaky")',
      'void d() {}',
      '@DisabledIfSystemProperty(named = "ci", matches = "true")',
      'void e() {}',
      '@DisabledOnOs(OS.WINDOWS)',
      'void f() {}',
    ].join('\n');
    expect(countTestSurface(src).skipMarkers).toBe(6);
  });

  it('ignores annotations and assertions inside comments for code counters', () => {
    const src = [
      '// @Test',
      '// void old() { assertTrue(x); }',
      '/*',
      ' * @Test disabled long ago',
      ' * assertEquals(1, 2);',
      ' */',
      '@Test',
      'void real() { assertEquals(1, 1); }',
    ].join('\n');
    const counts = countTestSurface(src);
    expect(counts.testCases).toBe(1);
    expect(counts.assertions).toBe(1);
    // The two comment-side @Test occurrences ARE reported as commented tests.
    expect(counts.commentedTests).toBe(2);
  });

  it('ignores string literal contents (no assertions or tests from strings)', () => {
    const src = [
      'String s = "assertTrue(";',
      'String t = "@Test";',
      'String u = "// @Test not a comment";',
      'char c = \'"\';',
    ].join('\n');
    const counts = countTestSurface(src);
    expect(counts.testCases).toBe(0);
    expect(counts.assertions).toBe(0);
    expect(counts.commentedTests).toBe(0);
  });

  it('handles // sequences inside string literals without eating code', () => {
    const src = [
      'String url = "https://example.com"; assertEquals(url, actual);',
      '@Test void real() {}',
    ].join('\n');
    const counts = countTestSurface(src);
    expect(counts.assertions).toBe(1);
    expect(counts.testCases).toBe(1);
  });

  it('returns zero counts for empty input', () => {
    expect(countTestSurface('')).toEqual({
      testCases: 0,
      assertions: 0,
      skipMarkers: 0,
      commentedTests: 0,
    });
  });
});

describe('extractPomTestConfig', () => {
  const surefirePom = (skipTests: string) => [
    '<project>',
    '  <dependencies>',
    '    <dependency><groupId>org.junit</groupId><artifactId>junit</artifactId></dependency>',
    '  </dependencies>',
    '  <build>',
    '    <plugins>',
    '      <plugin>',
    '        <groupId>org.apache.maven.plugins</groupId>',
    '        <artifactId>maven-surefire-plugin</artifactId>',
    '        <configuration>',
    `          <skipTests>${skipTests}</skipTests>`,
    '        </configuration>',
    '      </plugin>',
    '      <plugin>',
    '        <artifactId>maven-compiler-plugin</artifactId>',
    '      </plugin>',
    '    </plugins>',
    '  </build>',
    '</project>',
  ].join('\n');

  it('captures surefire plugin config so a skipTests flip changes the extract', () => {
    const before = extractPomTestConfig(surefirePom('false'));
    const after = extractPomTestConfig(surefirePom('true'));
    expect(before).not.toBe('');
    expect(before).not.toBe(after);
  });

  it('is stable across dependency-only edits', () => {
    const before = surefirePom('false');
    const after = before.replace(
      '</dependencies>',
      '  <dependency><groupId>x</groupId><artifactId>y</artifactId></dependency>\n  </dependencies>',
    );
    expect(extractPomTestConfig(before)).toBe(extractPomTestConfig(after));
  });

  it('is stable across whitespace-only reformatting of the surefire block', () => {
    const before = surefirePom('false');
    const after = before.replace('          <skipTests>', '  <skipTests>');
    expect(extractPomTestConfig(before)).toBe(extractPomTestConfig(after));
  });

  it('captures maven.test.skip property lines outside plugin blocks', () => {
    const withSkip = '<project><properties><maven.test.skip>true</maven.test.skip></properties></project>';
    const without = '<project><properties><foo>bar</foo></properties></project>';
    expect(extractPomTestConfig(withSkip)).toContain('maven.test.skip');
    expect(extractPomTestConfig(without)).toBe('');
  });

  it('captures failsafe plugin blocks too', () => {
    const pom = '<project><build><plugins><plugin><artifactId>maven-failsafe-plugin</artifactId></plugin></plugins></build></project>';
    expect(extractPomTestConfig(pom)).toContain('maven-failsafe-plugin');
  });

  it('returns empty string when there is no test-harness config', () => {
    expect(extractPomTestConfig('<project><build/></project>')).toBe('');
    expect(extractPomTestConfig('')).toBe('');
  });
});

describe('isJavaTestFile', () => {
  it('accepts .java files under src/test at repo root or in a module', () => {
    expect(isJavaTestFile('src/test/java/sample/CalculatorTest.java')).toBe(true);
    expect(isJavaTestFile('module-a/src/test/java/FooTest.java')).toBe(true);
  });

  it('rejects main sources, non-java files, and lookalike paths', () => {
    expect(isJavaTestFile('src/main/java/sample/Calculator.java')).toBe(false);
    expect(isJavaTestFile('src/test/resources/data.txt')).toBe(false);
    expect(isJavaTestFile('src/test/java/FooTest.kt')).toBe(false);
    expect(isJavaTestFile('src/testdata/java/FooTest.java')).toBe(false);
  });
});

describe('schema version', () => {
  it('pins the report schema version literal', () => {
    expect(TEST_SURFACE_REPORT_SCHEMA_VERSION).toBe('test-surface-report/v1');
  });
});
