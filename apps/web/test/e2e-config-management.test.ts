/**
 * 端到端业务测试：配置管理 + UI重构验证
 *
 * 测试场景：
 * 1. 加载配置注册表（新分类方案）
 * 2. 验证5个业务场景tab的配置分组
 * 3. 测试配置覆盖和保存流程
 * 4. 验证UI projection层的数据转换
 */

import { describe, it, expect } from 'vitest';
import { CONFIG_REGISTRY, configKeysByCategory } from '../../../packages/shared/src/config/registry';
import { buildSettingsViewModel } from '../src/settings-projection';

describe('E2E: 配置管理业务流程', () => {

  describe('场景1: 配置注册表加载和分类', () => {
    it('应该包含所有32个配置项', () => {
      const allKeys = Object.keys(CONFIG_REGISTRY);
      expect(allKeys).toHaveLength(32);
    });

    it('应该有5个业务场景分类', () => {
      const categories = [
        'intelligent_analysis',
        'conversation_ux',
        'workflow_custom',
        'performance_resource',
        'troubleshooting'
      ];

      categories.forEach(category => {
        const keys = configKeysByCategory(category as any);
        expect(keys.length).toBeGreaterThan(0);
      });
    });

    it('智能分析分类应该包含6个配置项', () => {
      const keys = configKeysByCategory('intelligent_analysis' as any);
      expect(keys).toHaveLength(6);
      expect(keys).toContain('coordinator.confidence_threshold');
      expect(keys).toContain('coordinator.bug_keywords');
      expect(keys).toContain('coordinator.feature_keywords');
      expect(keys).toContain('coordinator.refactor_keywords');
      expect(keys).toContain('coordinator.large_scope_keywords');
      expect(keys).toContain('coordinator.large_scope_regex');
    });

    it('对话体验分类应该包含4个配置项', () => {
      const keys = configKeysByCategory('conversation_ux' as any);
      expect(keys).toHaveLength(4);
      expect(keys).toContain('coordinator.clarification_style');
      expect(keys).toContain('coordinator.max_clarification_rounds');
    });

    it('工作流定制分类应该包含5个配置项', () => {
      const keys = configKeysByCategory('workflow_custom' as any);
      expect(keys).toHaveLength(5);
      expect(keys.every(k => k.startsWith('skill.'))).toBe(true);
    });

    it('性能与资源分类应该包含8个配置项', () => {
      const keys = configKeysByCategory('performance_resource' as any);
      expect(keys).toHaveLength(8);
    });

    it('故障处理分类应该包含9个配置项', () => {
      const keys = configKeysByCategory('troubleshooting' as any);
      expect(keys).toHaveLength(9);
      // 应该包含所有fallback配置
      const fallbackKeys = keys.filter(k => k.includes('fallback'));
      expect(fallbackKeys.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('场景2: UI Projection层数据转换', () => {
    it('应该正确构建5个tab的ViewModel', () => {
      const mockRegistry = {
        keys: Object.keys(CONFIG_REGISTRY),
        entries: CONFIG_REGISTRY as any
      };

      const vm = buildSettingsViewModel({
        registry: mockRegistry,
        overrides: {},
        drafts: new Map(),
        audits: new Map()
      });

      expect(vm.tabs).toHaveLength(5);
      expect(vm.tabs[0].id).toBe('intelligent_analysis');
      expect(vm.tabs[0].label).toBe('智能分析');
      expect(vm.tabs[1].id).toBe('conversation_ux');
      expect(vm.tabs[1].label).toBe('对话体验');
      expect(vm.tabs[2].id).toBe('workflow_custom');
      expect(vm.tabs[2].label).toBe('工作流定制');
      expect(vm.tabs[3].id).toBe('performance_resource');
      expect(vm.tabs[3].label).toBe('性能与资源');
      expect(vm.tabs[4].id).toBe('troubleshooting');
      expect(vm.tabs[4].label).toBe('故障处理');
    });

    it('每个tab应该包含正确数量的配置行', () => {
      const mockRegistry = {
        keys: Object.keys(CONFIG_REGISTRY),
        entries: CONFIG_REGISTRY as any
      };

      const vm = buildSettingsViewModel({
        registry: mockRegistry,
        overrides: {},
        drafts: new Map(),
        audits: new Map()
      });

      expect(vm.tabs[0].rows).toHaveLength(6); // 智能分析
      expect(vm.tabs[1].rows).toHaveLength(4); // 对话体验
      expect(vm.tabs[2].rows).toHaveLength(5); // 工作流定制
      expect(vm.tabs[3].rows).toHaveLength(8); // 性能与资源
      expect(vm.tabs[4].rows).toHaveLength(9); // 故障处理
    });

    it('配置行应该包含UI所需的所有字段', () => {
      const mockRegistry = {
        keys: Object.keys(CONFIG_REGISTRY),
        entries: CONFIG_REGISTRY as any
      };

      const vm = buildSettingsViewModel({
        registry: mockRegistry,
        overrides: {},
        drafts: new Map(),
        audits: new Map()
      });

      const firstRow = vm.tabs[0].rows[0];
      expect(firstRow).toHaveProperty('key');
      expect(firstRow).toHaveProperty('displayName');
      expect(firstRow).toHaveProperty('displayDescription');
      expect(firstRow).toHaveProperty('valuePreview');
      expect(firstRow).toHaveProperty('hasOverride');
      expect(firstRow).toHaveProperty('hasDraft');
      expect(firstRow).toHaveProperty('risk');
    });
  });

  describe('场景3: 配置覆盖和状态管理', () => {
    it('应该正确识别有覆盖值的配置', () => {
      const mockRegistry = {
        keys: Object.keys(CONFIG_REGISTRY),
        entries: CONFIG_REGISTRY as any
      };

      const vm = buildSettingsViewModel({
        registry: mockRegistry,
        overrides: {
          'coordinator.confidence_threshold': {
            valueJson: '0.75',
            updatedAt: new Date().toISOString(),
            updatedBy: 'test-user'
          }
        },
        drafts: new Map(),
        audits: new Map()
      });

      const row = vm.perKey.get('coordinator.confidence_threshold');
      expect(row?.hasOverride).toBe(true);
      expect(row?.hasDraft).toBe(false);
    });

    it('应该正确识别有草稿的配置', () => {
      const mockRegistry = {
        keys: Object.keys(CONFIG_REGISTRY),
        entries: CONFIG_REGISTRY as any
      };

      const drafts = new Map();
      drafts.set('coordinator.max_clarification_rounds', '10');

      const vm = buildSettingsViewModel({
        registry: mockRegistry,
        overrides: {},
        drafts,
        audits: new Map()
      });

      const row = vm.perKey.get('coordinator.max_clarification_rounds');
      expect(row?.hasDraft).toBe(true);
      expect(row?.draftValue).toBe('10');
    });

    it('summary应该正确统计覆盖和草稿数量', () => {
      const mockRegistry = {
        keys: Object.keys(CONFIG_REGISTRY),
        entries: CONFIG_REGISTRY as any
      };

      const drafts = new Map();
      drafts.set('coordinator.confidence_threshold', '0.8');
      drafts.set('coordinator.max_clarification_rounds', '5');

      const vm = buildSettingsViewModel({
        registry: mockRegistry,
        overrides: {
          'coordinator.bug_keywords': {
            valueJson: '["bug","修复"]',
            updatedAt: new Date().toISOString(),
            updatedBy: 'test-user'
          }
        },
        drafts,
        audits: new Map()
      });

      expect(vm.summary.overrideCount).toBe(1);
      expect(vm.summary.dirtyCount).toBe(2);
    });
  });

  describe('场景4: 配置值类型和约束验证', () => {
    it('置信度阈值应该支持0-1的小数', () => {
      const entry = CONFIG_REGISTRY['coordinator.confidence_threshold'];
      expect(entry.type).toBe('number');
      expect(entry.min).toBe(0);
      expect(entry.max).toBe(1);
    });

    it('最大追问轮数应该支持1-20的整数', () => {
      const entry = CONFIG_REGISTRY['coordinator.max_clarification_rounds'];
      expect(entry.type).toBe('number');
      expect(entry.min).toBe(1);
      expect(entry.max).toBe(20);
    });

    it('关键词配置应该是string_array类型', () => {
      const bugEntry = CONFIG_REGISTRY['coordinator.bug_keywords'];
      const featureEntry = CONFIG_REGISTRY['coordinator.feature_keywords'];

      expect(bugEntry.type).toBe('string_array');
      expect(featureEntry.type).toBe('string_array');
      expect(Array.isArray(bugEntry.default)).toBe(true);
    });

    it('提示词配置应该是multiline string', () => {
      const systemPrompt = CONFIG_REGISTRY['coordinator.system_prompt'];
      const grillMePrompt = CONFIG_REGISTRY['coordinator.system_prompt_grill_me'];

      expect(systemPrompt.type).toBe('string');
      expect(systemPrompt.multiline).toBe(true);
      expect(grillMePrompt.type).toBe('string');
      expect(grillMePrompt.multiline).toBe(true);
    });
  });

  describe('场景5: UI重构验证 - 简化信息展示', () => {
    it('配置行应该提供值预览', () => {
      const mockRegistry = {
        keys: Object.keys(CONFIG_REGISTRY),
        entries: CONFIG_REGISTRY as any
      };

      const vm = buildSettingsViewModel({
        registry: mockRegistry,
        overrides: {},
        drafts: new Map(),
        audits: new Map()
      });

      // 所有配置行都应该有valuePreview
      vm.tabs.forEach(tab => {
        tab.rows.forEach(row => {
          expect(row.valuePreview).toBeDefined();
          expect(row.valuePreview.length).toBeGreaterThan(0);
        });
      });

      // 至少应该有一些配置有值预览
      const totalRows = vm.tabs.reduce((sum, tab) => sum + tab.rows.length, 0);
      expect(totalRows).toBe(32);
    });

    it('高风险配置应该被正确标记', () => {
      const mockRegistry = {
        keys: Object.keys(CONFIG_REGISTRY),
        entries: CONFIG_REGISTRY as any
      };

      const vm = buildSettingsViewModel({
        registry: mockRegistry,
        overrides: {},
        drafts: new Map(),
        audits: new Map()
      });

      // 检查性能与资源tab中的配置风险等级
      const perfTab = vm.tabs.find(t => t.id === 'performance_resource');
      const hasHighRisk = perfTab?.rows.some(r => r.risk === 'high');

      // 应该至少有一些中高风险配置
      expect(hasHighRisk || perfTab?.rows.some(r => r.risk === 'medium')).toBe(true);
    });
  });
});
