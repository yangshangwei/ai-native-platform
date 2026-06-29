import { describe, expect, it } from 'vitest';
import { buildTaskTrendSeries } from '../src/page-workbench';
import type { WorkflowRunDto } from '../src/projection';

function run(status: WorkflowRunDto['status'], createdAt: string): WorkflowRunDto {
  return {
    id: `run_${status}_${createdAt}`,
    projectId: 'proj_1',
    type: 'feature',
    title: `${status} run`,
    status,
    currentStage: 'implementation',
    flowId: 'feature.standard',
    startStage: null,
    sourceBranch: 'main',
    branch: `ai/${status}`,
    workspacePath: null,
    createdAt,
  };
}

describe('workbench task trend projection', () => {
  const now = new Date('2026-06-29T12:00:00.000Z');

  it('does not invent chart data when no runs exist', () => {
    const trend = buildTaskTrendSeries([], now);

    expect(trend.hasRealData).toBe(false);
    expect(trend.datasets.flatMap((dataset) => dataset.data)).toEqual(Array(21).fill(0));
  });

  it('counts real runs in the seven-day window', () => {
    const trend = buildTaskTrendSeries([
      run('passed', '2026-06-29T08:00:00.000Z'),
      run('failed', '2026-06-28T08:00:00.000Z'),
      run('running', '2026-06-28T09:00:00.000Z'),
      run('passed', '2026-06-10T08:00:00.000Z'),
    ], now);

    expect(trend.hasRealData).toBe(true);
    expect(trend.labels).toEqual(['6/23', '6/24', '6/25', '6/26', '6/27', '6/28', '6/29']);
    expect(trend.datasets.find((dataset) => dataset.label === '成功')?.data).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(trend.datasets.find((dataset) => dataset.label === '失败')?.data).toEqual([0, 0, 0, 0, 0, 1, 0]);
    expect(trend.datasets.find((dataset) => dataset.label === '进行中')?.data).toEqual([0, 0, 0, 0, 0, 1, 0]);
  });
});
