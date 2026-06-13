# Windows 兼容性修复实施计划

**创建时间**: 2026-06-13 10:50 AM  
**基于**: Windows 审计工作流 Phase 1-2 发现  
**状态**: 准备实施

---

## 修复路线图

### ✅ Phase 0: 工具模块（已完成）

**提交**: `1b14af8`  
**文件**: `packages/shared/src/utils/platform.ts`

已创建的工具函数：
- `pathToFileUri(path: string): string`
- `fileUriToPath(uri: string): string`
- `killProcessTree(pid: number, signal?: string): Promise<void>`
- `getConfigDir(): string`
- `normalizePathForComparison(path: string): string`

---

## Phase 1: 应用文件 URI 修复

**优先级**: High  
**严重度**: 8 个 High 问题  
**估计工作量**: 2-3 小时

### 受影响文件清单

1. **apps/runner/src/command-runner.ts** (优先级 1)
   - 行 150: `stdoutRef: file://${stdoutPath}`
   - 行 153: `stderrRef: file://${stderrPath}`
   - **影响**: 所有命令执行的输出引用在 Windows 上不可用

2. **apps/api/src/artifact-content.ts** (优先级 1)
   - 行 52: `const path = uri.slice('file://'.length)`
   - 行 68: `path.startsWith(realRoot + '/')`
   - **影响**: Artifact 内容读取失败，安全路径检查被绕过

3. **apps/runner/src/knowledge.ts** (优先级 2)
   - 行 68: `candidateUri.slice('file://'.length)`
   - **影响**: Knowledge 提升失败

4. **apps/runner/src/orchestrator/steps.ts** (优先级 2)
   - 多处: 行 153, 331, 441, 543, 582, 637, 649, 764, 777
   - **影响**: 所有阶段的输出引用

5. **apps/api/src/reports.ts** (优先级 3)
   - 行 49, 58, 712
   - **影响**: 报告生成的引用

6. **apps/runner/src/cmd/run.ts** (优先级 3)
   - 行 90, 103
   - **影响**: CLI 运行输出

### 修复模式

#### Pattern 1: URI 构造
```typescript
// Before
const uri = `file://${absolutePath}`;

// After
import { pathToFileUri } from '@ainp/shared';
const uri = pathToFileUri(absolutePath);
```

#### Pattern 2: URI 解析
```typescript
// Before
const path = uri.slice('file://'.length);

// After
import { fileUriToPath } from '@ainp/shared';
const path = fileUriToPath(uri);
```

#### Pattern 3: 路径前缀检查
```typescript
// Before
if (path.startsWith(realRoot + '/')) { ... }

// After
import { normalizePathForComparison } from '@ainp/shared';
const normalizedPath = normalizePathForComparison(path);
const normalizedRoot = normalizePathForComparison(realRoot);
if (normalizedPath.startsWith(normalizedRoot + '/')) { ... }
```

### 实施顺序

1. command-runner.ts（阻断优先）
2. artifact-content.ts（阻断优先）
3. knowledge.ts
4. orchestrator/steps.ts（多处修改）
5. reports.ts
6. cmd/run.ts

---

## Phase 2: 应用进程终止修复

**优先级**: High  
**严重度**: 11 个 High 问题  
**估计工作量**: 3-4 小时

### 受影响文件清单

1. **apps/runner/src/command-runner.ts** (优先级 1)
   - 行 54: `detached: true` → 条件化
   - 行 102: `process.kill(-child.pid, 'SIGKILL')` → killProcessTree
   - 行 106: `child.kill('SIGKILL')` → killProcessTree
   - **影响**: 构建/测试超时无法终止

2. **apps/runner/src/agents/claude-code.ts** (优先级 1)
   - 行 256: 超时 SIGTERM + SIGKILL 升级
   - 行 276: 宽限期 SIGTERM + SIGKILL 升级
   - **影响**: Claude Code CLI 在 Windows 上无法超时终止

3. **apps/runner/src/agents/codex.ts** (优先级 1)
   - 行 194: 超时 SIGTERM + SIGKILL 升级
   - **影响**: Codex CLI 在 Windows 上无法超时终止

4. **apps/runner/src/agents/coordinator/llm-fallback.ts** (优先级 1)
   - 行 444: one-shot SIGTERM + SIGKILL
   - 行 512: streaming SIGTERM + SIGKILL
   - **影响**: Coordinator 超时失败，阻塞任务分流

5. **apps/runner/src/agents/cli-common.ts** (优先级 2)
   - 行 69: 探针超时 SIGKILL
   - **影响**: 版本检查僵尸进程

6. **apps/runner/src/sh.ts** (优先级 2)
   - 行 36: 直接 SIGKILL
   - **影响**: Shell 命令超时失败

7. **apps/api/src/routes/runner-control.ts** (优先级 2)
   - 行 109: Runner 停止 SIGTERM
   - 行 162: 重试 detached 条件化
   - **影响**: Web UI 无法停止 runner

### 修复模式

#### Pattern 1: 替换 child.kill()
```typescript
// Before
child.kill('SIGTERM');
setTimeout(() => {
  if (!child.killed) {
    child.kill('SIGKILL');
  }
}, 10000);

// After
import { killProcessTree } from '@ainp/shared';

try {
  await killProcessTree(child.pid, 'SIGTERM');
} catch (err) {
  // Ignore if process already dead
}

setTimeout(async () => {
  if (!child.killed) {
    try {
      await killProcessTree(child.pid, 'SIGKILL');
    } catch (err) {
      // Ignore
    }
  }
}, 10000);
```

#### Pattern 2: 替换 process.kill(-pid)
```typescript
// Before
process.kill(-child.pid, 'SIGKILL');

// After
import { killProcessTree } from '@ainp/shared';
await killProcessTree(child.pid, 'SIGKILL');
```

#### Pattern 3: 条件化 detached
```typescript
// Before
const child = spawn(cmd, args, {
  detached: true,
  // ...
});

// After
const child = spawn(cmd, args, {
  detached: process.platform !== 'win32',
  // ...
});
```

### 实施顺序

1. command-runner.ts（核心基础设施）
2. claude-code.ts（最常用 agent）
3. codex.ts（最常用 agent）
4. coordinator/llm-fallback.ts（关键流程）
5. cli-common.ts（工具函数）
6. sh.ts（工具函数）
7. runner-control.ts（API 端点）

---

## Phase 3: 路径处理改进

**优先级**: Medium-High  
**估计工作量**: 1-2 小时

### 1. packages/shared/src/utils/context-policy.ts
- 行 32: `text.split('/')` → `path.basename(text)`
- 行 38: 模式匹配硬编码 '/'

### 2. apps/api/src/routes/projects.ts
- 行 606: 路径类型检测
  ```typescript
  // Before
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../'))
  
  // After
  if (path.isAbsolute(value) || /^\.\.?[\/\\]/.test(value))
  ```

---

## Phase 4: 环境变量修复

**优先级**: Low-Medium  
**估计工作量**: 1 小时

### 受影响文件

1. **apps/runner/src/agents/claude-code.ts** (行 221)
   ```typescript
   // Before
   childEnv.HOME = isolatedHome;
   
   // After
   if (process.platform === 'win32') {
     childEnv.USERPROFILE = isolatedHome;
   } else {
     childEnv.HOME = isolatedHome;
   }
   ```

2. **apps/runner/src/agents/coordinator/llm-fallback.ts** (行 577)
   - 同上模式

3. **apps/api/src/routes/projects.ts** (行 96)
   ```typescript
   // Before
   const home = process.env.HOME || homedir();
   
   // After
   import { homedir } from 'node:os';
   const home = homedir();
   ```

4. **apps/runner/src/config.ts** (行 4)
   ```typescript
   // Before
   const baseDir = join(homedir(), '.ai-native');
   
   // After
   import { getConfigDir } from '@ainp/shared';
   const baseDir = getConfigDir();
   ```

---

## Phase 5: 文件系统加固

**优先级**: Medium  
**估计工作量**: 2-3 小时

### 1. Windows 保留名检查 (promote-file.ts)

```typescript
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function isPathSafeEntityId(id: string): boolean {
  if (!/^(REQ|DSN)-\d{1,6}$/.test(id)) return false;
  
  // Check Windows reserved names
  const prefix = id.split('-')[0];
  if (WINDOWS_RESERVED_NAMES.test(prefix)) return false;
  
  return true;
}
```

### 2. Atomic rename 重试逻辑 (promote-file.ts)

```typescript
async function atomicWrite(target: string, content: string): Promise<void> {
  const temp = `${target}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temp, content, 'utf8');
  
  // Windows-specific retry logic
  const maxRetries = process.platform === 'win32' ? 3 : 1;
  for (let i = 0; i < maxRetries; i++) {
    try {
      await rename(temp, target);
      return;
    } catch (err) {
      if (err.code === 'EEXIST' || err.code === 'EPERM') {
        if (i < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 100 * (i + 1))); // exponential backoff
          continue;
        }
      }
      throw err;
    }
  }
}
```

### 3. 路径长度验证

```typescript
function validatePathLength(fullPath: string): void {
  if (process.platform === 'win32' && fullPath.length > 260) {
    throw new Error(
      `Path too long for Windows (${fullPath.length} > 260 chars). ` +
      `Enable long path support or use a shorter project path.`
    );
  }
}
```

---

## Phase 6: 测试验证

**优先级**: 必须  
**估计工作量**: 4-6 小时

### 1. 单元测试更新
- 为所有修改的模块添加 Windows 路径测试用例
- 模拟 Windows 环境（process.platform）

### 2. 集成测试
- 在 Windows 环境运行测试套件
- 修复平台特定失败

### 3. E2E 测试
- Windows 上运行完整 smoke 测试
- 验证 Agent 后端集成

### 4. 文档
- Windows 安装指南
- 已知限制
- CI/CD 配置

---

## 总工作量估算

| Phase | 工作量 | 状态 |
|-------|--------|------|
| Phase 0: 工具模块 | 2h | ✅ 已完成 |
| Phase 1: 文件 URI | 2-3h | 待开始 |
| Phase 2: 进程终止 | 3-4h | 待开始 |
| Phase 3: 路径处理 | 1-2h | 待开始 |
| Phase 4: 环境变量 | 1h | 待开始 |
| Phase 5: 文件系统 | 2-3h | 待开始 |
| Phase 6: 测试验证 | 4-6h | 待开始 |
| **总计** | **15-21h** | **2h 完成** |

**剩余**: 13-19 小时

---

## 风险和依赖

### 阻断风险
1. **Bun Windows 支持** - 等待审计 Phase 3 确认
2. **Git 路径格式** - 需要 Windows 测试验证

### 可选改进
1. 命令解析（空格处理）- 需要 shell-quote 或数组格式
2. 符号链接处理 - 需要提升权限或 Developer Mode
3. 大小写敏感性 - NTFS 可配置

---

## 下一步行动

1. ✅ 工具模块已完成
2. 🔄 等待审计工作流完成
3. 📝 开始 Phase 1（文件 URI 修复）
4. 🔄 并行进行业务流程审计

**准备状态**: ✅ 可以立即开始 Phase 1
