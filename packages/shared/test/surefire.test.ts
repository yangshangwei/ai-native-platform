import { describe, it, expect } from 'vitest';
import { aggregateSurefire, parseSurefireSummary } from '../src/utils/surefire';

const PASSING = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="sample.CalculatorTest" tests="3" failures="0" errors="0" skipped="0" time="0.022">
  <testcase classname="sample.CalculatorTest" name="addsPositiveNumbers" time="0.001"/>
  <testcase classname="sample.CalculatorTest" name="multipliesPositiveNumbers" time="0.0"/>
  <testcase classname="sample.CalculatorTest" name="addHandlesNegatives" time="0.0"/>
</testsuite>`;

const FAILING = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="sample.BadTest" tests="2" failures="1" errors="0" skipped="0" time="0.05">
  <testcase classname="sample.BadTest" name="ok" time="0.0"/>
  <testcase classname="sample.BadTest" name="fails" time="0.0">
    <failure type="AssertionError" message="bad">stack</failure>
  </testcase>
</testsuite>`;

describe('parseSurefireSummary', () => {
  it('extracts the testsuite attributes', () => {
    const s = parseSurefireSummary(PASSING)!;
    expect(s.name).toBe('sample.CalculatorTest');
    expect(s.total).toBe(3);
    expect(s.failures).toBe(0);
    expect(s.errors).toBe(0);
    expect(s.skipped).toBe(0);
  });

  it('returns null for non-surefire input', () => {
    expect(parseSurefireSummary('<html></html>')).toBeNull();
    expect(parseSurefireSummary('')).toBeNull();
  });

  it('treats missing numeric attributes as 0', () => {
    const s = parseSurefireSummary('<testsuite name="X" tests="1">')!;
    expect(s.failures).toBe(0);
    expect(s.errors).toBe(0);
    expect(s.skipped).toBe(0);
  });
});

describe('aggregateSurefire', () => {
  it('sums counts across multiple suites and computes passed', () => {
    const a = parseSurefireSummary(PASSING)!;
    const b = parseSurefireSummary(FAILING)!;
    const agg = aggregateSurefire('maven-surefire', [
      { path: 'a.xml', summary: a },
      { path: 'b.xml', summary: b },
    ]);
    expect(agg.total).toBe(5);
    expect(agg.failed).toBe(1);
    expect(agg.errors).toBe(0);
    expect(agg.skipped).toBe(0);
    expect(agg.passed).toBe(4);
    expect(agg.reportPaths).toEqual(['a.xml', 'b.xml']);
  });
});
