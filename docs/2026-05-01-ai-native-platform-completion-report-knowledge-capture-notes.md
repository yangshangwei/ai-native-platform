# AI Native 云开发平台：Completion Report 与 Knowledge Capture 设计记录

日期：2026-05-01

## 1. 基本判断

每个需求、bug、重构流程结束时，都必须产出正式报告。

但报告不应该只是“总结我做了什么”。建议设计成平台正式环节：

> Completion Report + Knowledge Capture Pipeline

流程结束时产出两类东西：

```text
1. Completion Report：给人看的完整交付报告 / 可追溯记录
2. Knowledge Items：给未来 Agent 检索复用的项目经验 / 决策 / 技巧 / 坑点
```

二者相关，但不能混为一谈。

## 2. Completion Report 的价值

Completion Report 解决：

```text
这次到底做了什么？
为什么这么做？
改了哪些地方？
满足了哪些需求？
跑了哪些测试？
哪些 Gate 通过了？
还有什么风险？
谁批准了什么？
```

它是一次 workflow 的审计记录和交付说明。

后期追溯时能回答：

```text
当时需求是什么？
设计为什么这么选？
哪些测试覆盖了？
谁批准了跳过某项？
为什么改了这个文件？
```

## 3. Knowledge Capture 的价值

Completion Report 是一次工作的完整记录，但太长、太具体，不适合每次都塞给未来 Agent。

未来 Agent 需要的是提炼后的长期经验：

```text
以后遇到类似问题，要注意什么？
项目有什么长期约束？
哪个实现模式值得复用？
这个 bug 暴露了什么坑？
哪个设计决策以后不能随便推翻？
```

因此要从 Completion Report 和 workflow artifacts 中提炼 Knowledge Items。

## 4. Report 与 Knowledge 的区别

| 类型 | 面向谁 | 内容粒度 | 生命周期 | 用途 |
|---|---|---|---|---|
| Completion Report | 人、审计、项目记录 | 完整、具体、一次性 | 跟随 workflow 永久归档 | 追溯这次发生了什么 |
| Knowledge Item | 未来 Agent、人 | 提炼、可复用 | 长期维护，可更新/废弃 | 下次需求/设计/修 bug 时检索复用 |

简单说：

```text
Report 记录“这次做了什么”；
Knowledge 记录“以后应该记住什么”。
```

## 5. Feature Completion Report 结构

建议结构：

```text
1. 基本信息
   - workflow id
   - feature title
   - 时间
   - 发起人
   - 关联 PR / branch / commit

2. 原始需求
   - requirement id
   - 用户目标
   - success criteria
   - non-goals

3. 工程上下文
   - Context Pack 摘要
   - 关键 evidence refs
   - 历史 decision / bug / architecture 影响

4. 设计方案摘要
   - 选定方案
   - 主要 tradeoff
   - 被拒方案
   - 关键接口 / 模块变化

5. 实现摘要
   - changed files
   - 每个 changed file 对应哪个 design / checklist step
   - scope 是否有变化

6. 测试与验证
   - compile / build result
   - test runs
   - Gate results
   - human verification

7. 需求覆盖矩阵
   - success criterion
   - design coverage
   - implementation evidence
   - test evidence
   - acceptance status

8. 风险与遗留问题
   - known risks
   - skipped items
   - human-approved exceptions

9. 最终结论
   - completed / partially completed / blocked
   - 是否可 merge / release

10. 知识沉淀建议
   - decision candidates
   - learning candidates
   - trick candidates
   - architecture update candidates
```

## 6. Bug Fix Completion Report 结构

Bug 修复报告重点不同：

```text
1. 基本信息
2. 问题报告
   - 现象
   - 影响范围
   - 复现方式
   - 日志 / trace
3. 根因分析
   - root cause
   - evidence refs
   - 被排除的假设
4. 修复方案
   - 选定方案
   - 其他方案为什么不用
5. 实现摘要
   - changed files
   - 修复点
6. 回归测试
   - 新增 / 修改测试
   - 测试命令
   - TestRun result
7. 验收
   - bug 是否复现失败
   - 相关功能是否未破坏
8. 风险与遗留
9. 知识沉淀建议
   - pitfall / learning
   - decision
   - trick
```

## 7. Report 不能由 LLM 自说自话

Completion Report 可以由 Report Agent 起草，但事实来源必须来自平台事实源：

```text
Requirement Artifact
Context Pack
Design Artifact
Git Diff
BuildRun
TestRun
GateRun
Human Approval
PR / Commit
AgentRun logs
```

LLM 可以组织语言，但不能编造事实。

Completion Report Gate 应校验：

```text
- report 引用了 workflow id
- report 引用了 requirement / design / diff / test / gate
- 每个 success criterion 都有状态
- pass 的 criterion 必须有 evidence
- skipped 必须有人批准
- changed files 来自真实 git diff
- test result 来自真实 TestRun
```

---

续篇：`2026-05-01-ai-native-platform-knowledge-capture-notes.md`。
