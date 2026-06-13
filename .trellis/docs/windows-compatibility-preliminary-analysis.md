# Windows 兼容性问题 - 初步分析

**生成时间**: 2026-06-13  
**来源**: Windows 兼容性审计工作流 Phase 1 扫描结果

---

## 问题汇总

**总计**: 20 个发现
- **High 严重度**: 8 个 ⚠️
- **Medium 严重度**: 8 个
- **Low 严重度**: 3 个  
- **Info**: 1 个

---

## High 严重度问题（阻断性）

### 1. File URI 构造问题（多处）
**影响文件**:
- `apps/runner/src/command-runner.ts:150`
- `apps/api/src/artifact-content.ts:52`
- `apps/runner/src/knowledge.ts:68`
- 多个文件（orchestrator/steps.ts, reports.ts, cmd/run.ts）

**问题**: 硬编码 `file://${path}` 模式
- Windows: 产生错误格式 `file://C:\Users\...`
- 正确格式: `file:///C:/Users/...`（三斜杠 + 正斜杠）

**修复方案**: 
```typescript
// 创建统一工具函数
import { pathToFileURL } from 'node:url';

function pathToFileUri(absolutePath: string): string {
  return pathToFileURL(absolutePath).href;
}

// 或手动实现
function pathToFileUri(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/');
  return `file:///${normalized}`;
}
```

**影响范围**: 所有 artifact URI、报告路径、输出引用

---

### 2. File URI 解析问题
**文件**: `apps/api/src/artifact-content.ts:52`

**问题**: `uri.slice('file://'.length)` 无法正确解析 Windows URI
- 输入: `file:///C:/Users/...`
- 错误输出: `/C:/Users/...`（多余的前导斜杠）
- 期望输出: `C:\Users\...` 或 `C:/Users/...`

**修复方案**:
```typescript
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(uri);  // 自动处理平台差异
```

---

### 3. 路径前缀检查问题
**文件**: `apps/api/src/artifact-content.ts:68`

**问题**: `path.startsWith(realRoot + '/')`
- Windows 路径使用反斜杠 `\`
- 检查永远失败

**修复方案**:
```typescript
import path from 'node:path';

// 方案 1: 使用 path.sep
path.startsWith(realRoot + path.sep)

// 方案 2: 规范化后比较
const normalized = path.normalize(targetPath);
normalized.startsWith(path.normalize(realRoot) + path.sep)
```

---

### 4. 路径分割问题
**文件**: `packages/shared/src/utils/context-policy.ts:32`

**问题**: `text.split('/').at(-1)` 无法处理 Windows 反斜杠
- `C:\Users\file.txt` → 不会正确分割

**修复方案**:
```typescript
import path from 'node:path';

const filename = path.basename(text);  // 跨平台
```

---

## Medium 严重度问题

### 5. 进程信号处理（关键）
**文件**: `apps/runner/src/command-runner.ts:102`

**问题**: `process.kill(-child.pid, 'SIGKILL')`
- Windows 不支持负 PID（进程组）
- Windows 不支持 SIGKILL 信号

**影响**: R1.3 安全加固中的超时杀进程逻辑在 Windows 上会失败

**修复方案**:
```typescript
function killProcessTree(pid: number, signal: string = 'SIGTERM'): void {
  if (process.platform === 'win32') {
    // Windows: 使用 taskkill 杀进程树
    spawn('taskkill', ['/pid', pid.toString(), '/T', '/F'], {
      stdio: 'ignore'
    });
  } else {
    // Unix: 使用负 PID 杀进程组
    try {
      process.kill(-pid, signal);
    } catch (err) {
      // 回退：直接杀主进程
      process.kill(pid, signal);
    }
  }
}
```

**替代方案**: 使用 `tree-kill` npm 包（跨平台进程树终止）

---

### 6. HOME 环境变量
**文件**: `apps/runner/src/agents/claude-code.ts:229`

**问题**: 直接访问 `process.env.HOME`
- Windows 使用 `USERPROFILE`
- `process.env.HOME` 在 Windows 上可能不存在

**修复方案**:
```typescript
import { homedir } from 'node:os';

const home = process.env.HOME || process.env.USERPROFILE || homedir();
```

---

### 7. 配置目录约定
**文件**: `apps/runner/src/config.ts:4`

**问题**: `.ai-native` 点前缀目录
- Unix 约定：`~/.ai-native`
- Windows 约定：`%APPDATA%\ai-native`（无点前缀）

**修复方案**:
```typescript
import { homedir } from 'node:os';
import path from 'node:path';

const configDir = process.platform === 'win32'
  ? path.join(process.env.APPDATA || homedir(), 'ai-native')
  : path.join(homedir(), '.ai-native');
```

---

### 8. 路径类型检测
**文件**: `apps/api/src/routes/projects.ts:606`

**问题**: 
```typescript
value.startsWith('/') || value.startsWith('./') || value.startsWith('../')
```
- Windows 绝对路径 `C:\path` 不会被识别
- Windows 相对路径 `.\path` 不会被识别

**修复方案**:
```typescript
import path from 'node:path';

// 绝对路径检测
if (path.isAbsolute(value)) { ... }

// 相对路径检测
if (/^\.\.?[\/\\]/.test(value)) { ... }
```

---

## Low 严重度问题

### 9. Git Worktree 路径
**文件**: `apps/runner/src/worktree.ts:43`

**问题**: Git 在 Windows 上的路径处理
- Git 通常接受两种分隔符
- 但某些操作可能需要正斜杠

**建议**: 测试驱动验证，可能需要规范化

---

### 10. Detached 进程行为差异
**文件**: `apps/runner/src/command-runner.ts:49`

**问题**: `detached: true` 在 Windows 和 Unix 上行为不同
- Unix: 创建新进程组
- Windows: 创建新控制台窗口（如果有）

**建议**: 文档化差异，考虑平台特定逻辑

---

## 正面发现（Info）

### 11. path.join() 使用良好
**范围**: 整个代码库

**发现**: 大部分代码正确使用 `path.join()`
- 自动使用平台特定分隔符
- 是跨平台路径构造的最佳实践

**建议**: 继续保持，审计剩余的字符串拼接

---

## 修复优先级路线图

### Phase 1: 阻断性修复（High 优先级）

1. **创建跨平台工具模块** (1-2 小时)
   ```typescript
   // packages/shared/src/utils/platform.ts
   export function pathToFileUri(path: string): string;
   export function fileUriToPath(uri: string): string;
   export function killProcessTree(pid: number, signal?: string): void;
   export function getConfigDir(): string;
   ```

2. **修复 File URI 问题** (2-3 小时)
   - 替换所有 `file://${path}` 为 `pathToFileUri(path)`
   - 替换所有 `uri.slice('file://'.length)` 为 `fileUriToPath(uri)`
   - 文件: command-runner, artifact-content, knowledge, orchestrator/steps, reports, cmd/run

3. **修复路径检查和分割** (1 小时)
   - artifact-content.ts 的前缀检查
   - context-policy.ts 的 basename 提取

### Phase 2: 进程管理修复（Medium 优先级）

4. **实现跨平台进程终止** (2-3 小时)
   - `killProcessTree()` 实现
   - 更新 command-runner.ts
   - 测试 Windows taskkill 集成

### Phase 3: 环境和配置（Medium 优先级）

5. **修复环境变量和路径约定** (1 小时)
   - HOME/USERPROFILE 兼容
   - 配置目录平台约定
   - 路径类型检测改进

### Phase 4: 测试验证（必须）

6. **添加平台特定测试** (2-3 小时)
   - 单元测试覆盖新工具函数
   - 集成测试验证 Windows 路径处理
   - 文档化 Windows 测试环境需求

---

## 估计工作量

- **Phase 1 (High)**: 4-6 小时
- **Phase 2 (Medium)**: 2-3 小时  
- **Phase 3 (Medium)**: 1 小时
- **Phase 4 (测试)**: 2-3 小时

**总计**: 9-13 小时工作量

---

## 依赖和前提

1. **Bun 在 Windows 上的支持**
   - 需要验证 Bun runtime 的 Windows 兼容性
   - 等待工作流 Phase 3 的依赖检查结果

2. **测试环境**
   - 需要 Windows 测试环境或 CI
   - 考虑 GitHub Actions Windows runner

3. **外部依赖**
   - 可选：`tree-kill` 包用于进程树终止
   - Node.js 内置模块足够（不需要新依赖）

---

## 下一步行动

1. ✅ 等待工作流完整报告（Phase 2 Analyze + Phase 3 Verify）
2. 🔄 根据完整报告创建实施计划
3. 📝 创建专门的 Windows 兼容性任务
4. 🔧 实施修复（从 Phase 1 High 优先级开始）
5. ✅ 测试验证
6. 📄 更新文档

---

**状态**: 等待工作流完成中...
