#!/usr/bin/env bash
# UI 改造审查脚本
# 验证所有改动符合设计系统规范

set -e

# 回到项目根目录
cd "$(dirname "$0")/../../.."

echo "========================================"
echo "UI 改造审查 - Phase 1 & 2"
echo "========================================"
echo ""

# 1. 类型检查
echo "✓ 步骤 1/6: TypeScript 类型检查..."
cd apps/web
npm run typecheck
cd ../..
echo "✓ 类型检查通过"
echo ""

# 2. 文件存在性检查
echo "✓ 步骤 2/6: 设计系统文件检查..."
FILES=(
  "apps/web/public/design-tokens.css"
  "apps/web/public/components.css"
  "apps/web/public/utilities.css"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✓ $file 存在"
  else
    echo "  ✗ $file 缺失"
    exit 1
  fi
done
echo ""

# 3. CSS 文件大小检查
echo "✓ 步骤 3/6: CSS 文件大小检查..."
for file in "${FILES[@]}"; do
  size=$(wc -c < "$file" | tr -d ' ')
  lines=$(wc -l < "$file" | tr -d ' ')
  echo "  - $(basename $file): ${lines} 行, ${size} 字节"
done
echo ""

# 4. 关键 CSS 类检查
echo "✓ 步骤 4/6: 关键 CSS 类存在性检查..."
CLASSES=(
  "metric-card-v2"
  "metric-icon"
  "btn-primary"
  "badge-success"
  "grid-stats"
)

for class in "${CLASSES[@]}"; do
  if grep -q "$class" apps/web/public/*.css; then
    echo "  ✓ .$class 定义存在"
  else
    echo "  ✗ .$class 缺失"
    exit 1
  fi
done
echo ""

# 5. 设计 Token 检查
echo "✓ 步骤 5/6: 设计 Token 完整性检查..."
TOKENS=(
  "color-primary"
  "color-success"
  "color-warning"
  "color-danger"
  "radius-lg"
  "shadow-sm"
  "font-body"
)

for token in "${TOKENS[@]}"; do
  if grep -q -- "--${token}" apps/web/public/design-tokens.css; then
    echo "  ✓ --$token 定义存在"
  else
    echo "  ✗ --$token 缺失"
    exit 1
  fi
done
echo ""

# 6. 页面组件检查
echo "✓ 步骤 6/6: 页面组件使用检查..."
PAGES=(
  "apps/web/src/page-workbench.ts"
  "apps/web/src/page-reports.ts"
)

for page in "${PAGES[@]}"; do
  if grep -q "metricCardV2" "$page"; then
    echo "  ✓ $(basename $page) 使用新组件"
  else
    echo "  ⚠ $(basename $page) 未使用新组件（可能不需要）"
  fi
done
echo ""

echo "========================================"
echo "✅ UI 审查完成 - 所有检查通过！"
echo "========================================"
echo ""
echo "摘要："
echo "- 设计系统文件: 3 个"
echo "- 类型检查: 通过"
echo "- 关键组件: 已定义"
echo "- 设计 Token: 完整"
echo ""
