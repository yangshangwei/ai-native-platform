# CodeStable Skill 与 AI Native 云开发平台讨论记录

日期：2026-05-01

## 1. CodeStable 是什么

CodeStable 当前不是传统意义上的应用代码工程，而是一套面向 AI 编码工具的 skill 包。

它的核心交付物是多个 `SKILL.md`：

- `cs/`：根入口，负责介绍体系与路由
- `cs-onboard/`：初始化项目的 CodeStable 目录结构
- `cs-feat-*`：新功能流程
- `cs-issue-*`：问题修复流程
- `cs-refactor-*`：重构流程
- `cs-learn` / `cs-trick` / `cs-decide` / `cs-explore`：知识沉淀流程

它的核心思想是：

> 编排软件生命周期，而不是只编排 Agent。

也就是把需求、架构、路线图、特性、问题、决策、经验等软件工程实体组织起来，让 AI 在长期项目中更稳定地工作。

## 2. 项目 idea 的来源

从 git 历史和 README 演进看，作者最初在开发另一个 Harness Agent 项目 MA 时大量使用 VibeCoding：人写设计和需求，AI 写代码和修 bug。

后来 Codex 在一个作者认为并不复杂的问题上反复失败，并且反复在同一个地方犯错。作者由此意识到：问题不只是 AI 能力不够，而是项目缺少流程约束和长期记忆结构。

作者调研过：

- OpenSpec：太简单，缺少复利工程，生成的 spec 抽象到人类不好读
- SuperPowers：能力散，流程约束弱，不知道该用哪个
- Oh-My-OpenAgent：太重，哲学上偏向“人越少介入越好”

CodeStable 的方向因此变成：

> 面向严肃工程，把 AI 编码过程中的需求、方案、bug 根因、架构决策和经验沉淀成可检索的项目资产。

## 3. 根入口 `cs/SKILL.md` 的设计

`cs/SKILL.md` 是一个导航型 skill，不是执行型 skill。

它的 frontmatter：

```yaml
---
name: cs
description: CodeStable 工作流根入口，介绍体系全貌并把诉求路由到对应 cs-* 子技能。触发：用户只输入 `cs`、说"介绍一下 codestable"、"该用哪个技能"、"不知道用哪个"，或诉求还很开放未收敛。本技能只做路由不做事。
---
```

关键设计点：

1. `name: cs` 让安装后出现 `/cs` 命令。
2. `description` 明确覆盖“不知道用哪个 skill”“介绍体系”“开放式诉求”等场景。
3. `cs` 只做两件事：
   - 用户带具体诉求时，匹配路由表并推荐具体 `cs-*`。
   - 用户想了解体系时，给精简体系速读。
4. `cs` 不做这些事：
   - 不写 spec
   - 不读写 `codestable/` 下的内容产物
   - 不替子技能做决策
   - 不直接开发或修 bug

`cs` 的流程可以抽象为：

```text
扫描项目是否已接入
  ↓
识别用户意图
  ↓
根据路由表选唯一技能
  ↓
提示用户下一步
  ↓
不自己执行
```

## 4. `npx skills add ...` 的原理

命令：

```bash
npx skills add https://github.com/liuzhengdongfortest/CodeStable
```

大致过程：

1. `npx` 从 npm registry 下载并运行 `skills` CLI。
2. `skills add` 识别 GitHub URL。
3. 它把 GitHub 仓库 clone 到临时目录。
4. 扫描仓库中包含 `SKILL.md` 的目录。
5. 让用户选择安装到 Claude Code、Codex、Cursor 等 agent。
6. 把 skill 复制或 symlink 到对应 agent 的 skills 目录。

常见路径：

- Claude Code 项目级：`.claude/skills/`
- Claude Code 全局：`~/.claude/skills/`
- Codex 项目级：`.agents/skills/`
- Codex 全局：`~/.codex/skills/`

它不是上传到云端，而是把 skill 文件安装到本机或当前项目的约定目录。

## 5. CodeStable 是否有 hooks / sub-agents

当前 CodeStable 没有实际配置 hooks，也没有正式配置 sub-agent。

仓库中没有看到类似：

```yaml
hooks:
  ...
```

也没有看到：

```yaml
context: fork
agent: Explore
```

`cs-libdoc` 中提到“可用 subagent 并行”，但那只是建议宿主 agent 可以这么做，不是 CodeStable 自己声明了子 agent。

所以 CodeStable 当前是：

> Markdown playbook + 文件树协议 + agent 自觉执行。

不是：

> hook 系统 / sub-agent orchestration / 自动化 runtime。

这不影响它作为流程型 skill 包的完整性，但意味着它的约束主要是软约束，不是强制拦截。

## 6. 初始化后的 `codestable/tools/`

初始化后项目里会出现：

```text
codestable/tools/
├── search-yaml.py
└── validate-yaml.py
```

源码中它们位于：

```text
cs-onboard/tools/
├── search-yaml.py
└── validate-yaml.py
```

`cs-onboard` 负责在项目初始化时把它们复制到：

```text
codestable/tools/
```

设计原因：skill 是独立安装单元，其他 skill 不应该直接引用 `cs-onboard/tools/`。所以共享工具要释放到用户项目中，其他 skill 统一用项目相对路径调用：

```bash
python codestable/tools/search-yaml.py ...
python codestable/tools/validate-yaml.py ...
```

### `search-yaml.py`

用于搜索带 YAML frontmatter 的 Markdown 文档。

典型命令：

```bash
python codestable/tools/search-yaml.py \
  --dir codestable/compound \
  --filter doc_type=decision \
  --filter status=active
```

支持：

- `key=value` 精确匹配
- `key~=value` 包含匹配
- 全文搜索 `--query`
- JSON 输出 `--json`
- 按 frontmatter 字段排序

### `validate-yaml.py`

用于校验 Markdown frontmatter 或纯 YAML 文件。

典型命令：

```bash
python codestable/tools/validate-yaml.py \
  --file codestable/features/xxx/xxx-design.md \
  --require doc_type \
  --require status
```

或校验纯 YAML：

```bash
python codestable/tools/validate-yaml.py \
  --file codestable/features/xxx/xxx-checklist.yaml \
  --yaml-only
```

## 7. Python 运行环境问题

这两个脚本需要 Python 运行环境。

macOS / Linux 通常使用：

```bash
python3 codestable/tools/search-yaml.py --help
python3 codestable/tools/validate-yaml.py --help
```

Windows 可能使用：

```powershell
python codestable/tools/search-yaml.py --help
py codestable/tools/search-yaml.py --help
```

不强制安装 PyYAML。脚本会优先使用 PyYAML；如果没有，会 fallback 到内置简易 parser。

最低要求是 Python 3。

---

续篇：`2026-05-01-ai-native-platform-workflow-design-notes.md`。

---

相关：`2026-05-01-ai-native-platform-completion-report-knowledge-capture-notes.md`。
