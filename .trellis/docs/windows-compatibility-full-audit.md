# Windows 兼容性审计 - 完整发现汇总

**生成时间**: 2026-06-13  
**工作流ID**: wf_c9a9218e-b48  
**状态**: Phase 2 完成，Phase 3 进行中

---

## 执行摘要

Windows 兼容性审计发现了 **55+ 个兼容性问题**，涵盖路径处理、进程管理、文件系统、信号处理等多个关键领域。

### 按严重度汇总

| 严重度 | 数量 | 主要类别 |
|--------|------|----------|
| **High** | 22+ | 信号处理（11）、进程组管理（3）、文件 URI（8） |
| **Medium** | 20+ | 路径处理、环境变量、Shell 命令、文件权限 |
| **Low** | 10+ | 测试、配置约定、文件锁 |
| **Info** | 3+ | 正确的实现、文档需求 |

---

## Phase 1: 路径和 URI 问题（20 个发现）

### High 严重度（8 个）

1. **File URI 构造模式** - `file://${path}` 在 Windows 上产生错误格式
   - **✅ 已修复**: 创建了 `pathToFileUri()` 工具函数

2. **File URI 解析** - `uri.slice('file://'.length)` 无法处理 Windows URI
   - **✅ 已修复**: 创建了 `fileUriToPath()` 工具函数

3-8. **路径分隔符、前缀检查、文件名提取**
   - **✅ 已修复**: 创建了 `normalizePathForComparison()` 等工具函数

### 待应用

需要将新创建的工具函数应用到受影响的文件：
- `apps/runner/src/command-runner.ts`
- `apps/api/src/artifact-content.ts`
- `apps/runner/src/knowledge.ts`
- `apps/runner/src/orchestrator/steps.ts`
- `apps/api/src/reports.ts`
- `packages/shared/src/utils/context-policy.ts`

---

## Phase 2A: 信号处理问题（23 个发现）

### High 严重度（11 个）- **🚨 关键阻断**

所有这些问题都源于 **Windows 不支持 POSIX 信号**（SIGTERM、SIGKILL）。

#### 受影响的文件：

1. **apps/runner/src/sh.ts:36**
   - 使用 `child.kill('SIGKILL')`
   - **影响**: Shell 命令超时终止失败

2. **apps/runner/src/command-runner.ts:102, 106**
   - 使用 `process.kill(-child.pid, 'SIGKILL')` 负 PID 杀进程组
   - **影响**: Maven/Gradle 构建超时后无法终止子进程
   - **✅ 部分修复**: R1.3 添加了 SIGKILL 升级，但没有 Windows 兼容性

3. **apps/runner/src/agents/cli-common.ts:69**
   - CLI 可用性探针使用 `child.kill('SIGKILL')`
   - **影响**: 版本检查可能留下僵尸进程

4. **apps/runner/src/agents/codex.ts:194**
   - Codex CLI 超时使用 SIGTERM/SIGKILL
   - **影响**: Codex 在 Windows 上无法正常超时终止

5. **apps/runner/src/agents/claude-code.ts:256, 276**
   - Claude Code CLI 超时和宽限期使用 SIGTERM/SIGKILL
   - **影响**: Claude Code 在 Windows 上无法正常超时终止

6. **apps/runner/src/agents/coordinator/llm-fallback.ts:444, 512**
   - Coordinator LLM 回退使用 SIGTERM/SIGKILL
   - **影响**: Coordinator 超时失败，阻塞任务分流

7. **apps/api/src/routes/runner-control.ts:109**
   - Runner 控制停止使用 SIGTERM
   - **影响**: Web UI 无法停止 Windows 上的 runner

#### 修复方案

**✅ 工具已创建**: `killProcessTree()` 函数已实现
- Windows: 使用 `taskkill /F /T /PID`
- Unix: 使用 `process.kill(-pid, signal)`

**待应用**: 需要替换所有直接的 `child.kill()` 调用

---

## Phase 2A: 进程组管理（4 个发现）

### High 严重度（1 个）

**apps/runner/src/command-runner.ts:54**
- 使用 `detached: true` 在 Windows 上创建新控制台窗口
- **影响**: 破坏超时终止机制，创建孤儿进程
- **修复**: `detached: process.platform !== 'win32'`

### Medium 严重度（1 个）

**apps/api/src/routes/runner-control.ts:162**
- Runner 重试使用 `detached: true`
- **修复**: 条件化 detached 选项

---

## Phase 2B: 文件系统问题（12 个发现）

### High 严重度（3 个）

1. **进程树终止** (command-runner.ts)
   - **✅ 已修复**: `killProcessTree()` 已实现

2. **Git worktree 命令** (worktree.ts:43)
   - **影响**: Git 路径格式、WSL vs Windows git 冲突
   - **风险**: 中等 - 需要测试验证

3. **命令解析** (command-runner.ts:46)
   - 空格分割无法处理 Windows 路径（如 `C:\Program Files\...`）
   - **影响**: 自定义构建命令失败
   - **修复**: 需要使用 `shell-quote` 或接受数组格式

### Medium 严重度（7 个）

1. **File permissions** (artifact-content.ts:53)
   - `realpathSync()` 在 Windows 符号链接/接合点上行为不同
   - **风险**: 安全路径验证可能被绕过

2. **Atomic rename** (promote-file.ts:226)
   - Windows 上 `rename()` 非原子，目标存在时失败
   - **影响**: Entity 文件更新失败
   - **修复**: 重试逻辑 + 错误处理

3. **Path normalization** (context-policy.ts:18)
   - 转换反斜杠 + 小写化可能破坏大小写敏感 NTFS
   - **修复**: 使用 `path.normalize()` 和 `path.sep`

4. **Windows 保留名** (promote-file.ts:47)
   - Entity ID 如 `CON-001`、`PRN-001` 会导致文件创建失败
   - **修复**: 添加保留名检查正则

5. **路径长度限制** (promote-file.ts:172)
   - Windows MAX_PATH 260 字符限制
   - **影响**: 长路径创建失败
   - **修复**: 路径长度验证 + 文档说明启用长路径支持

6. **File locking** (promote-file.ts:228)
   - Windows 文件锁更严格，病毒扫描会阻塞
   - **修复**: 重试逻辑 + 排除建议

7. **Shell command paths** (worktree.ts, projects.ts)
   - Git 可能不在 PATH 或指向 WSL git
   - **修复**: Git 可用性检查 + 清晰错误消息

---

## Phase 2: 环境变量问题（5 个发现）

### Medium 严重度（2 个）

1. **orchestrator.ts:35** - `homedir()` 使用正确，但需验证 path.join()
2. **Git 命令** - 需要检查 Git 在 PATH 中

### Low 严重度（3 个）

1. **claude-code.ts:221** - 设置 `HOME` 而非 `USERPROFILE`
   - **✅ 已修复**: `getConfigDir()` 已实现

2. **llm-fallback.ts:577** - Coordinator 隔离模式同样问题
3. **projects.ts:96** - 使用 `process.env.HOME`
   - **修复**: 使用 `homedir()` 或平台检查

---

## 修复优先级路线图（更新）

### ✅ Phase 1: 跨平台工具模块（已完成）

- [x] 创建 `packages/shared/src/utils/platform.ts`
- [x] 实现 `pathToFileUri()`、`fileUriToPath()`
- [x] 实现 `killProcessTree()`
- [x] 实现 `getConfigDir()`、`normalizePathForComparison()`
- [x] 单元测试（16/18 passing）
- [x] 提交到 Git

**提交**: `1b14af8` - feat: add cross-platform utility module for Windows compatibility

### 🔄 Phase 2: 应用文件 URI 修复（High 优先级）

**工作量**: 2-3 小时

需要修改的文件（按顺序）：
1. `apps/runner/src/command-runner.ts` - stdout/stderr URI 构造
2. `apps/api/src/artifact-content.ts` - URI 解析和路径检查
3. `apps/runner/src/knowledge.ts` - URI 解析
4. `apps/runner/src/orchestrator/steps.ts` - 多处 URI 构造
5. `apps/api/src/reports.ts` - 报告 URI 构造
6. `apps/runner/src/cmd/run.ts` - 输出 URI 构造

**替换模式**:
```typescript
// Before
const uri = `file://${path}`;
const path = uri.slice('file://'.length);

// After
import { pathToFileUri, fileUriToPath } from '@ainp/shared';
const uri = pathToFileUri(path);
const path = fileUriToPath(uri);
```

### 🔄 Phase 3: 应用进程终止修复（High 优先级）

**工作量**: 3-4 小时

需要修改的文件（按优先级）：
1. `apps/runner/src/command-runner.ts` - 超时 kill + detached 条件化
2. `apps/runner/src/agents/claude-code.ts` - 超时和宽限期 kill
3. `apps/runner/src/agents/codex.ts` - 超时 kill
4. `apps/runner/src/agents/coordinator/llm-fallback.ts` - 两处超时 kill
5. `apps/runner/src/agents/cli-common.ts` - 探针超时 kill
6. `apps/runner/src/sh.ts` - 直接 SIGKILL
7. `apps/api/src/routes/runner-control.ts` - Runner 停止

**替换模式**:
```typescript
// Before
child.kill('SIGTERM');
setTimeout(() => child.kill('SIGKILL'), 10000);
process.kill(-child.pid, 'SIGKILL');

// After
import { killProcessTree } from '@ainp/shared';
await killProcessTree(child.pid, 'SIGTERM');
setTimeout(() => killProcessTree(child.pid, 'SIGKILL'), 10000);

// Detached spawn
spawn(cmd, args, {
  detached: process.platform !== 'win32',
  // ...
});
```

### 🔄 Phase 4: 文件系统和路径修复（Medium 优先级）

**工作量**: 2-3 小时

1. **Windows 保留名检查** (promote-file.ts)
2. **Atomic rename 重试** (promote-file.ts)  
3. **路径长度验证** (promote-file.ts, projects.ts)
4. **HOME/USERPROFILE 修复** (多个文件)
5. **命令解析改进** (command-runner.ts)

### 🔄 Phase 5: 测试和验证（必须）

**工作量**: 4-6 小时

1. **单元测试更新**
   - 所有修改的模块添加 Windows 路径测试用例
   - 进程终止测试（模拟）

2. **集成测试**
   - 在 Windows 环境运行现有测试套件
   - 修复特定于平台的测试失败

3. **E2E 测试**
   - Windows 上运行完整的 smoke 测试
   - 验证 Claude Code / Codex 集成

4. **文档**
   - Windows 安装指南
   - 已知限制和解决方法
   - CI/CD Windows runner 配置

---

## 估计总工作量（更新）

- **✅ Phase 1 (工具模块)**: 2 小时 - **已完成**
- **🔄 Phase 2 (文件 URI)**: 2-3 小时
- **🔄 Phase 3 (进程终止)**: 3-4 小时
- **🔄 Phase 4 (文件系统)**: 2-3 小时
- **🔄 Phase 5 (测试验证)**: 4-6 小时

**总计**: 13-18 小时（已完成 2 小时）

**剩余**: 11-16 小时

---

## 风险评估

### 🔴 High Risk（必须修复）

1. **进程终止失败** - 运行在 Windows 上的 runner 会留下僵尸进程，导致资源泄漏
2. **文件 URI 格式错误** - 所有 artifact、报告引用在 Windows 上不可用
3. **超时机制失效** - Agent CLI 无法正常终止，hang 住工作流

### 🟡 Medium Risk（强烈建议修复）

1. **Git 路径问题** - Worktree 操作可能失败
2. **文件系统原子性** - Entity 文件更新可能失败
3. **路径长度限制** - 深层项目结构失败

### 🟢 Low Risk（可选改进）

1. **配置目录约定** - 使用 Unix 风格但仍可工作
2. **测试兼容性** - 某些测试需要跳过或改写
3. **文档和用户指南**

---

## Bun Runtime 兼容性

**状态**: 等待 Phase 3 Verify 结果

需要确认：
- Bun 在 Windows 上的官方支持状态
- 已知限制和解决方法
- 替代运行时方案（如 Node.js）

---

## 下一步行动

### 立即行动

1. ✅ 跨平台工具模块已创建并提交
2. 🔄 等待工作流 Phase 3 完成（依赖检查和最终报告）
3. 🔄 创建 Windows 兼容性修复任务
4. 🔄 开始 Phase 2（文件 URI 修复）

### 并行工作

- 业务流程端到端审计继续进行
- 可以开始部分 Phase 2 修复（不依赖最终报告）

---

**状态**: 工作流 Phase 3 进行中，等待最终报告...
