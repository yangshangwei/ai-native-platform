/**
 * Chart Components - Chart.js Wrappers
 *
 * Provides easy-to-use chart components with Sub2API design system colors.
 * Supports dark mode via theme detection.
 */

import {
  Chart,
  ArcElement,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { getResolvedTheme } from './theme';

// Register Chart.js components
Chart.register(
  ArcElement,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Title,
  Tooltip,
  Legend
);

/**
 * Get color palette based on current theme
 */
function getColorPalette(): {
  primary: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  purple: string;
  text: string;
  textMuted: string;
  gridLines: string;
  background: string;
} {
  const isDark = getResolvedTheme() === 'dark';

  if (isDark) {
    return {
      primary: '#60a5fa',
      success: '#4ade80',
      warning: '#fb923c',
      danger: '#f87171',
      info: '#22d3ee',
      purple: '#c084fc',
      text: '#f1f5f9',
      textMuted: '#94a3b8',
      gridLines: '#334155',
      background: '#1e293b',
    };
  } else {
    return {
      primary: '#2563eb',
      success: '#15803d',
      warning: '#f97316',
      danger: '#b91c1c',
      info: '#1d4ed8',
      purple: '#9333ea',
      text: '#1e293b',
      textMuted: '#64748b',
      gridLines: '#dbe3ef',
      background: '#ffffff',
    };
  }
}

/**
 * Create a pie chart
 * @param canvas - Canvas element
 * @param labels - Data labels
 * @param data - Data values
 * @param title - Chart title
 */
export function createPieChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  data: number[],
  title?: string
): Chart {
  const colors = getColorPalette();
  const palette = [
    colors.primary,
    colors.success,
    colors.warning,
    colors.danger,
    colors.info,
    colors.purple,
  ];

  return new Chart(canvas, {
    type: 'pie',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: palette.slice(0, data.length),
          borderColor: colors.background,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: colors.text,
            padding: 12,
            font: {
              size: 13,
              family: "'Fira Sans', sans-serif",
            },
          },
        },
        title: title
          ? {
              display: true,
              text: title,
              color: colors.text,
              font: {
                size: 16,
                weight: 'bold',
                family: "'Fira Sans', sans-serif",
              },
              padding: 16,
            }
          : undefined,
        tooltip: {
          backgroundColor: colors.background,
          titleColor: colors.text,
          bodyColor: colors.text,
          borderColor: colors.gridLines,
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
        },
      },
    },
  });
}

/**
 * Create a line chart
 * @param canvas - Canvas element
 * @param labels - X-axis labels
 * @param datasets - Array of datasets with label and data
 * @param title - Chart title
 */
export function createLineChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  datasets: Array<{ label: string; data: number[] }>,
  title?: string
): Chart {
  const colors = getColorPalette();
  const palette = [
    colors.primary,
    colors.success,
    colors.warning,
    colors.danger,
    colors.info,
    colors.purple,
  ];

  return new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((ds, idx) => ({
        label: ds.label,
        data: ds.data,
        borderColor: palette[idx % palette.length],
        backgroundColor: palette[idx % palette.length] + '20', // 20% opacity
        tension: 0.3,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: colors.text,
            padding: 12,
            font: {
              size: 13,
              family: "'Fira Sans', sans-serif",
            },
          },
        },
        title: title
          ? {
              display: true,
              text: title,
              color: colors.text,
              font: {
                size: 16,
                weight: 'bold',
                family: "'Fira Sans', sans-serif",
              },
              padding: 16,
            }
          : undefined,
        tooltip: {
          backgroundColor: colors.background,
          titleColor: colors.text,
          bodyColor: colors.text,
          borderColor: colors.gridLines,
          borderWidth: 1,
          padding: 12,
        },
      },
      scales: {
        x: {
          grid: {
            color: colors.gridLines,
          },
          ticks: {
            color: colors.textMuted,
            font: {
              size: 12,
              family: "'Fira Sans', sans-serif",
            },
          },
        },
        y: {
          grid: {
            color: colors.gridLines,
          },
          ticks: {
            color: colors.textMuted,
            font: {
              size: 12,
              family: "'Fira Sans', sans-serif",
            },
          },
          beginAtZero: true,
        },
      },
    },
  });
}

/**
 * Create a bar chart
 * @param canvas - Canvas element
 * @param labels - X-axis labels
 * @param datasets - Array of datasets with label and data
 * @param title - Chart title
 */
export function createBarChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  datasets: Array<{ label: string; data: number[] }>,
  title?: string
): Chart {
  const colors = getColorPalette();
  const palette = [
    colors.primary,
    colors.success,
    colors.warning,
    colors.danger,
    colors.info,
    colors.purple,
  ];

  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((ds, idx) => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: palette[idx % palette.length],
        borderColor: palette[idx % palette.length],
        borderWidth: 0,
        borderRadius: 6,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: colors.text,
            padding: 12,
            font: {
              size: 13,
              family: "'Fira Sans', sans-serif",
            },
          },
        },
        title: title
          ? {
              display: true,
              text: title,
              color: colors.text,
              font: {
                size: 16,
                weight: 'bold',
                family: "'Fira Sans', sans-serif",
              },
              padding: 16,
            }
          : undefined,
        tooltip: {
          backgroundColor: colors.background,
          titleColor: colors.text,
          bodyColor: colors.text,
          borderColor: colors.gridLines,
          borderWidth: 1,
          padding: 12,
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: colors.textMuted,
            font: {
              size: 12,
              family: "'Fira Sans', sans-serif",
            },
          },
        },
        y: {
          grid: {
            color: colors.gridLines,
          },
          ticks: {
            color: colors.textMuted,
            font: {
              size: 12,
              family: "'Fira Sans', sans-serif",
            },
          },
          beginAtZero: true,
        },
      },
    },
  });
}

/**
 * Update chart colors when theme changes
 * Call this function when theme changes to update existing charts
 */
export function updateChartTheme(chart: Chart): void {
  const colors = getColorPalette();

  // Update legend
  if (chart.options.plugins?.legend?.labels) {
    chart.options.plugins.legend.labels.color = colors.text;
  }

  // Update title
  if (chart.options.plugins?.title) {
    chart.options.plugins.title.color = colors.text;
  }

  // Update tooltip
  if (chart.options.plugins?.tooltip) {
    chart.options.plugins.tooltip.backgroundColor = colors.background;
    chart.options.plugins.tooltip.titleColor = colors.text;
    chart.options.plugins.tooltip.bodyColor = colors.text;
    chart.options.plugins.tooltip.borderColor = colors.gridLines;
  }

  // Update scales
  if (chart.options.scales) {
    Object.values(chart.options.scales).forEach((scale) => {
      if (scale?.grid) {
        scale.grid.color = colors.gridLines;
      }
      if (scale?.ticks) {
        scale.ticks.color = colors.textMuted;
      }
    });
  }

  chart.update();
}

/**
 * Get platform distribution data from runs
 * Returns mock data for now - will be connected to real data later
 */
export function getPlatformDistribution(): { labels: string[]; data: number[] } {
  // Mock data - replace with real data from API
  return {
    labels: ['Claude Opus 4.8', 'Claude Sonnet 4.6', 'Claude Haiku 4.5'],
    data: [65, 25, 10],
  };
}

/**
 * Create and render a pie chart
 * Helper function that wraps createPieChart with simplified API
 */
export function pieChart(
  canvas: HTMLCanvasElement,
  chartData: { labels: string[]; data: number[] },
  title?: string
): Chart {
  return createPieChart(canvas, chartData.labels, chartData.data, title);
}
