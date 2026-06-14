export const meta = {
  name: 'ui-overhaul-phase3-6',
  description: 'Complete UI overhaul phases 3-6: pages upgrade, visualization, animations, dark mode',
  phases: [
    { title: 'Phase 3', detail: 'Upgrade 4 pages with Sub2API design system' },
    { title: 'Phase 4', detail: 'Add data visualization with Chart.js' },
    { title: 'Phase 5', detail: 'Implement animations and micro-interactions' },
    { title: 'Phase 6', detail: 'Build complete dark mode support' },
  ],
};

// Phase 3: 页面升级任务
phase('Phase 3');
log('开始 Phase 3: 升级项目接入、新建任务、知识库、设置页面');

const phase3Tasks = [
  {
    page: 'projects',
    file: 'apps/web/src/page-projects.ts',
    goal: '项目列表卡片化，表单美化，统计卡片',
  },
  {
    page: 'new-task',
    file: 'apps/web/src/page-new-task.ts',
    goal: '增强表单视觉层级，输入验证反馈',
  },
  {
    page: 'knowledge',
    file: 'apps/web/src/page-knowledge.ts',
    goal: '统一卡片样式，优化按钮组',
  },
  {
    page: 'settings',
    file: 'apps/web/src/page-settings.ts',
    goal: '美化输入框，统一配置卡片',
  },
];

const phase3Results = await pipeline(
  phase3Tasks,
  // Stage 1: 分析当前页面状态
  (task) => agent(
    `分析 ${task.file} 的当前实现，识别需要优化的 UI 元素。目标：${task.goal}。

    输出 JSON 格式：
    {
      "currentState": "当前 UI 状态描述",
      "elementsToUpgrade": ["元素1", "元素2", ...],
      "estimatedChanges": "预计改动范围"
    }`,
    {
      label: `分析 ${task.page}`,
      phase: 'Phase 3',
      schema: {
        type: 'object',
        properties: {
          currentState: { type: 'string' },
          elementsToUpgrade: { type: 'array', items: { type: 'string' } },
          estimatedChanges: { type: 'string' },
        },
        required: ['currentState', 'elementsToUpgrade', 'estimatedChanges'],
      },
    }
  ),
  // Stage 2: 执行升级
  (analysis, task) => agent(
    `基于分析结果，升级 ${task.file} 的 UI。

    分析结果：${JSON.stringify(analysis)}

    要求：
    1. 使用 metricCardV2() 展示统计数据
    2. 表单使用新的设计 token（圆角、阴影、间距）
    3. 按钮使用统一样式类
    4. 卡片使用 .panel 或 .card 类
    5. 保持功能完全不变，只改视觉

    返回改动摘要 JSON：
    {
      "filesChanged": ["文件列表"],
      "changesApplied": "改动描述",
      "visualImpact": "视觉影响"
    }`,
    {
      label: `升级 ${task.page}`,
      phase: 'Phase 3',
      schema: {
        type: 'object',
        properties: {
          filesChanged: { type: 'array', items: { type: 'string' } },
          changesApplied: { type: 'string' },
          visualImpact: { type: 'string' },
        },
        required: ['filesChanged', 'changesApplied', 'visualImpact'],
      },
    }
  )
);

log(`Phase 3 完成：${phase3Results.filter(Boolean).length}/${phase3Tasks.length} 个页面已升级`);

// Phase 4: 数据可视化
phase('Phase 4');
log('开始 Phase 4: 集成 Chart.js 数据可视化');

const chartjsInstall = await agent(
  `检查 Chart.js 是否已安装，如果没有则安装。

  步骤：
  1. 检查 package.json
  2. 如果没有 chart.js，运行 bun add chart.js
  3. 返回安装状态

  返回 JSON：
  {
    "installed": true/false,
    "version": "版本号或null"
  }`,
  {
    label: '安装 Chart.js',
    phase: 'Phase 4',
    schema: {
      type: 'object',
      properties: {
        installed: { type: 'boolean' },
        version: { type: ['string', 'null'] },
      },
      required: ['installed'],
    },
  }
);

const chartComponents = await agent(
  `创建图表组件封装。

  在 apps/web/src/ 创建 chart.ts 文件，包含：
  1. pieChart() - 饼图
  2. lineChart() - 折线图
  3. barChart() - 柱状图

  使用 Sub2API 配色方案（从 design-tokens.css）。

  返回 JSON：
  {
    "created": true/false,
    "components": ["pieChart", "lineChart", "barChart"]
  }`,
  {
    label: '创建图表组件',
    phase: 'Phase 4',
    schema: {
      type: 'object',
      properties: {
        created: { type: 'boolean' },
        components: { type: 'array', items: { type: 'string' } },
      },
      required: ['created', 'components'],
    },
  }
);

const chartIntegration = await agent(
  `将图表集成到工作台和报告页面。

  工作台页面：
  - 添加 Token 使用趋势折线图

  报告页面：
  - 添加平台分布饼图

  返回 JSON：
  {
    "pagesUpdated": ["workbench", "reports"],
    "chartsAdded": 2
  }`,
  {
    label: '集成图表',
    phase: 'Phase 4',
    schema: {
      type: 'object',
      properties: {
        pagesUpdated: { type: 'array', items: { type: 'string' } },
        chartsAdded: { type: 'number' },
      },
      required: ['pagesUpdated', 'chartsAdded'],
    },
  }
);

log(`Phase 4 完成：已添加 ${chartIntegration?.chartsAdded || 0} 个图表`);

// Phase 5: 动画和细节
phase('Phase 5');
log('开始 Phase 5: 添加动画和微交互');

const animationCSS = await agent(
  `创建动画 CSS 文件 apps/web/public/animations.css。

  包含：
  1. 页面切换过渡（淡入淡出）
  2. 骨架屏动画
  3. Toast 滑入滑出
  4. 按钮点击反馈
  5. 下拉菜单展开

  使用 CSS animations 和 transitions。
  支持 prefers-reduced-motion。

  返回 JSON：
  {
    "created": true/false,
    "animations": ["fadeIn", "slideIn", "skeleton", ...]
  }`,
  {
    label: '创建动画 CSS',
    phase: 'Phase 5',
    schema: {
      type: 'object',
      properties: {
        created: { type: 'boolean' },
        animations: { type: 'array', items: { type: 'string' } },
      },
      required: ['created', 'animations'],
    },
  }
);

const skeletonComponent = await agent(
  `在 apps/web/src/dom.ts 添加骨架屏组件函数。

  创建：
  - skeletonCard() - 卡片骨架
  - skeletonList() - 列表骨架
  - skeletonText() - 文本骨架

  返回 JSON：
  {
    "added": true/false,
    "functions": ["skeletonCard", "skeletonList", "skeletonText"]
  }`,
  {
    label: '骨架屏组件',
    phase: 'Phase 5',
    schema: {
      type: 'object',
      properties: {
        added: { type: 'boolean' },
        functions: { type: 'array', items: { type: 'string' } },
      },
      required: ['added', 'functions'],
    },
  }
);

const animationIntegration = await agent(
  `将动画应用到所有页面。

  1. 在 index.html 引入 animations.css
  2. 页面切换添加过渡类
  3. 加载状态使用骨架屏
  4. Toast 使用滑入动画

  返回 JSON：
  {
    "integrated": true/false,
    "pagesUpdated": 7
  }`,
  {
    label: '集成动画',
    phase: 'Phase 5',
    schema: {
      type: 'object',
      properties: {
        integrated: { type: 'boolean' },
        pagesUpdated: { type: 'number' },
      },
      required: ['integrated', 'pagesUpdated'],
    },
  }
);

log(`Phase 5 完成：${animationCSS?.animations.length || 0} 个动画已添加`);

// Phase 6: 深色模式
phase('Phase 6');
log('开始 Phase 6: 实现深色模式');

const darkTokens = await agent(
  `创建深色模式设计 token: apps/web/public/design-tokens-dark.css。

  基于现有 design-tokens.css，创建深色版本：
  1. 背景色反转（深色背景）
  2. 文字颜色适配（浅色文字）
  3. 确保对比度 ≥ 4.5:1
  4. 使用 CSS 变量覆盖

  使用媒体查询 @media (prefers-color-scheme: dark)。

  返回 JSON：
  {
    "created": true/false,
    "tokensCount": 数字
  }`,
  {
    label: '深色 Token',
    phase: 'Phase 6',
    schema: {
      type: 'object',
      properties: {
        created: { type: 'boolean' },
        tokensCount: { type: 'number' },
      },
      required: ['created', 'tokensCount'],
    },
  }
);

const darkModeToggle = await agent(
  `实现深色模式切换功能。

  在 apps/web/src/ 创建 theme.ts：
  1. 检测系统主题
  2. LocalStorage 存储用户偏好
  3. 手动切换函数
  4. 主题变化事件

  在导航栏添加切换按钮。

  返回 JSON：
  {
    "implemented": true/false,
    "features": ["auto-detect", "manual-toggle", "persistence"]
  }`,
  {
    label: '深色切换',
    phase: 'Phase 6',
    schema: {
      type: 'object',
      properties: {
        implemented: { type: 'boolean' },
        features: { type: 'array', items: { type: 'string' } },
      },
      required: ['implemented', 'features'],
    },
  }
);

const darkModeTest = await agent(
  `测试深色模式在所有页面的表现。

  检查：
  1. 所有页面深色适配
  2. 图表颜色适配
  3. 对比度验证
  4. 切换平滑过渡

  返回 JSON：
  {
    "passed": true/false,
    "issues": ["问题列表，如果有"]
  }`,
  {
    label: '深色测试',
    phase: 'Phase 6',
    schema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        issues: { type: 'array', items: { type: 'string' } },
      },
      required: ['passed', 'issues'],
    },
  }
);

log(`Phase 6 完成：深色模式${darkModeTest?.passed ? '✅ 通过' : '❌ 需要修复'}`);

// 最终报告
return {
  phase3: {
    pagesUpgraded: phase3Results.filter(Boolean).length,
    total: phase3Tasks.length,
  },
  phase4: {
    chartsAdded: chartIntegration?.chartsAdded || 0,
    installed: chartjsInstall?.installed || false,
  },
  phase5: {
    animationsCount: animationCSS?.animations.length || 0,
    integrated: animationIntegration?.integrated || false,
  },
  phase6: {
    darkModeReady: darkModeTest?.passed || false,
    tokensCount: darkTokens?.tokensCount || 0,
  },
  summary: 'Phase 3-6 完成',
};
