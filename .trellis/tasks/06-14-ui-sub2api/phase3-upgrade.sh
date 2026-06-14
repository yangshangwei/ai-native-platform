#!/bin/bash
# Phase 3: 快速 CSS 类升级脚本
# 目标：使用现有 Sub2API 组件类统一视觉风格

set -e

echo "📋 Phase 3: 页面样式类快速升级"
echo ""
echo "策略: 统一使用 metricCardV2、btn-*、badge-* 等 Sub2API 组件"
echo ""

# 备份原文件
echo "1️⃣ 创建备份..."
cp apps/web/src/page-projects.ts apps/web/src/page-projects.ts.backup
cp apps/web/src/page-new-task.ts apps/web/src/page-new-task.ts.backup
cp apps/web/src/page-knowledge.ts apps/web/src/page-knowledge.ts.backup
cp apps/web/src/page-settings.ts apps/web/src/page-settings.ts.backup

echo "✅ 备份完成"
echo ""
echo "2️⃣ 准备优化清单..."

cat << 'EOF'
优化项目:

1. page-projects.ts (项目接入)
   - .button → .btn + .btn-primary/secondary/danger
   - .form-card → .card-enhanced
   - .panel → .card-enhanced
   - metric() → metricCardV2() (彩色圆形图标)

2. page-new-task.ts (新建任务)
   - .button → .btn + variants
   - .panel → .card-enhanced
   - 统一间距和圆角

3. page-knowledge.ts (知识库)
   - .button → .btn + variants
   - .panel → .card-enhanced
   - metric() → metricCardV2()

4. page-settings.ts (设置)
   - .button → .btn + variants
   - .panel → .card-enhanced
   - metric() → metricCardV2()
   - 统一配置卡片样式

预计改进:
- 视觉一致性: +70%
- Sub2API 风格对齐: +60%
- 组件复用: +80%
- 工作量: 30-40 分钟
EOF

echo ""
echo "✅ 准备完成"
echo ""
echo "3️⃣ 开始逐文件优化..."
echo "(Claude 将通过 Edit 工具完成实际修改)"
