# AI Native 云开发平台：Context Pack 修订（业务面 / 工程定位面双视图）

日期：2026-05-02
状态：修订稿，**取代** `2026-05-01-ai-native-platform-context-pack-notes.md` 中 §16-§20 的实现指导部分；§15（薄初始化 + 按需感知 + 验收回写）原则不变。

## 1. 修订动机

第一版 Context Pack 设计存在三个未约束的薄弱点，落地实现 (`apps/runner/src/agents/native.ts::renderContextPack`) 暴露后变成可见缺陷：

1. **语言面没分**——给用户看的内容和给后续 Agent 看的内容混在一份 markdown 里，导致需求阶段的对话被代码路径、类名、配置项污染。
2. **业务问题 vs 技术问题没分**——本应在设计阶段确认的事被前置到需求阶段问用户。
3. **召回入口设计错误**——把分词 + 关键词 grep 当主管道，对中文短句、跨语言代码库（中文需求 → 英文代码）召回率几乎为零，已在 `run_67c975dce9b9` 复现：keywords 提取为 none、相关代码 0 命中。

修订核心：

> **Context Pack 是一份产物的两个视图。业务面对人、工程定位面对码。同一次工程探索，两层皮。**

## 2. 双视图模型

```text
                      ┌──────────────────────────────────┐
   给用户看            │   业务面 (business view)          │
   用于需求拍板        │   语言：业务术语                  │
                      │   读者：产品经理 / 用户 / 业务方  │
                      │   目的：定义"做什么、不做什么"    │
                      └──────────────────────────────────┘
                                  ↑
                                  │ 翻译
                                  │
                      ┌──────────────────────────────────┐
   工程探索            │   一次工程探索 (shared probe)     │
   (AI 内部行为)       │   产出：候选模块、文件、引用      │
                      └──────────────────────────────────┘
                                  │
                                  │ 直接落档
                                  ↓
                      ┌──────────────────────────────────┐
   给后续 Agent 看     │   工程定位面 (technical view)     │
   用于设计阶段        │   语言：代码语言                  │
                      │   读者：Design Agent / Impl Agent │
                      │   目的：让设计阶段不必从头探索    │
                      └──────────────────────────────────┘
```

**关键约束**：

- 工程探索是技术行为，**结果必须翻译成业务语言才能进业务面**。
- 工程定位面**永远不直接呈现给用户**，是 Agent-to-Agent 传递。
- 用户在需求阶段看到的对话里，**不出现文件路径、类名、配置项、框架名**。

## 3. 业务面（business view）

### 3.1 必含字段

| 字段 | 内容 | 长度 |
|---|---|---|
| `engineering_context` | 这个工程是干什么的，本次需求会触及哪些**业务能力**（不是模块文件，而是业务功能名） | 100-300 字 |
| `current_business_flow` | 涉及功能现在的业务流程是什么样的，从用户视角描述 | 50-200 字 |
| `business_constraints` | 业务约束、合规要求、历史业务决策（不含技术决策） | 0-3 条 |
| `business_precedents` | 项目里有没有类似的业务先例（不含技术先例） | 0-3 条 |
| `clarifying_questions` | 5 类业务侧待确认问题（见 §3.3） | 3-5 条 |

### 3.2 写作禁忌（出现即视为污染）

业务面里**不允许出现**以下任何一项：

- 文件路径（`src/...`、`*.vue`、`*.java`）
- 类名 / 函数名 / 接口名（`LoginController`、`CaptchaService`）
- 配置文件名 / 配置项（`application.yml`、`spring.security.*`）
- 框架名 / 库名（Spring、Vue、Vuex、Maven）
- 技术名词（middleware、filter、interceptor、token、JWT、cookie、session）
- 数据库 / 表 / 字段名
- 工具链词汇（Webpack、Vite、Bun、CI、Docker）

**判定规则**（一句话）：

> 假设读者是不懂代码的产品经理。如果他必须问开发才能理解某句话，这句话就该挪到工程定位面。

### 3.3 业务面 5 类待确认问题模板

每次需求阶段输出 3-5 个问题，从下表选取，按相关性裁剪：

| 类别 | 问题原型 | 决策什么 |
|---|---|---|
| **范围** | 这次改动只针对 X 场景，还是 X+Y+Z 都要一起？ | 功能边界 |
| **角色** | 这个能力由谁触发 / 谁配置 / 谁能改？ | 用户类型 & 权限 |
| **默认** | 默认状态对所有环境/所有用户/所有场景都一致吗？ | 缺省行为 |
| **业务影响** | 这次改动后，最终用户**看到 / 操作**的差异是什么？ | UX 边界 |
| **兜底** | 极端 / 异常情况下，业务上希望系统怎么反应？ | 安全 / 退化策略 |

**反例**（技术污染）：

```text
✗ "feature flag 用 yml 配置还是数据库表？"
✗ "captcha 校验放在 filter 还是 controller？"
✗ "需要新增独立的 captcha-service 吗？"
✗ "token 协议是否兼容现有 SSO？"
```

**正例**（业务化）：

```text
✓ "这个开关由谁切？运维部署时定死、还是管理员后台动态切？"
✓ "关闭后，登录页那个验证码输入框还显示吗？"
✓ "异常登录尝试时，业务上希望系统自动重新启用验证码吗？"
```

### 3.4 业务面输出样例（登录验证码场景）

```markdown
## 业务背景
项目 uom2026 是一个运维部署管理平台。本次需求触及的业务能力：
- 用户登录认证
- 登录验证码（当前用作防暴力登录 / 防机器登录的业务保护）

## 当前业务流程
用户输入账号密码 + 看图填验证码 → 提交 → 校验通过进入系统。

## 业务约束
（暂未发现相关业务决策；项目历史上未做过同类"安全功能可开关"先例）

## 待确认问题
1. [范围] 这次的"屏蔽"只针对登录页验证码，还是注册、忘记密码等
       其它需要验证码的入口也一起？
2. [角色] 这个开关由谁切？运维部署时定死，还是系统管理员能在后台
       动态打开关闭？
3. [默认] "默认屏蔽"对所有部署环境一致，还是仅内部/测试默认屏蔽、
       生产仍然默认开启？
4. [业务影响] 关掉验证码后，登录页那个验证码输入框还显示吗？
5. [兜底] 当系统检测到异常登录（同一账号短时间多次失败），
       业务上是否希望自动重新启用验证码？
```

## 4. 工程定位面（technical view）

### 4.1 必含字段

| 字段 | 内容 | 上限 |
|---|---|---|
| `intent_translation` | LLM 把用户原句翻译成的结构化检索意图（业务概念 → 代码概念映射表） | 完整保留 |
| `candidate_modules` | 探索命中的模块列表（路径 + 业务能力标签） | ≤ 10 |
| `candidate_files` | 候选文件 + 命中行 + 命中关键词 | ≤ 15 |
| `reusable_assets` | 已识别的可复用类 / 服务 / 组件，及它的代码引用 | ≤ 5 |
| `historical_refs` | 相关 commit / decision / past artifact 的引用 | ≤ 5 |
| `probe_log` | 这次探索打开了哪些目录、grep 了什么、为什么停 | 完整 |

### 4.2 这一面给谁用

- **设计阶段** Design Agent 直接读，作为方案落点的依据。
- **实现阶段** Implementation Agent 用作初始上下文。
- **不展示给用户**。如果 UI 要可见，应在 Web UI 上设为可折叠且默认折叠，且 label 不能是"工程背景"（避免误导用户它是需求阶段产物）。

### 4.3 输出样例（同一场景）

```yaml
intent_translation:
  user_request: 登录页面的验证码，希望加一个开关，默认能够屏蔽掉
  business_concepts:
    - 登录认证
    - 验证码（防机器/暴力登录）
    - 配置开关
  code_concepts:
    - login / signin / authenticate
    - captcha / verify_code / verification_image
    - feature_flag / toggle / config_property
  search_layers:
    - frontend_login_page
    - backend_login_endpoint
    - security_filter_chain
    - config_files

candidate_modules:
  - path: web-vue/src/views/login
    role: 前端登录页
  - path: modules/server/src/main/java/.../security
    role: 后端安全过滤
  - path: modules/server/src/main/resources
    role: 配置

candidate_files:
  - path: modules/server/.../LoginController.java
    line: 47
    keyword: captcha
  - path: web-vue/src/views/Login.vue
    line: 112
    keyword: verifyCode
  ...

reusable_assets:
  - kind: config_pattern
    ref: modules/server/.../FeatureToggleConfig.java
    note: 项目已有 feature toggle 配置范式
```

## 5. 工程探索的目的修订

旧版理解：探索是为了"找出该改的地方"。

修订后理解：

> 探索是为了**同时**支撑两件事：
> 1. **业务范围澄清**——通过看到代码反推"这个需求究竟覆盖几个业务入口"
> 2. **设计阶段定位**——让 Design Agent 不必从零探索

第 1 件事的产出是业务面问题，**用代码事实校准业务范围**，但表述时剥离技术细节。
第 2 件事的产出是工程定位面，原样保留代码引用。

## 6. 召回管道修订

### 6.1 取消中文分词作为入口

不再使用 `tokenizeRequest` + `searchCodeForKeywords` 作为主管道。原因：

1. 中文请求切词 → 拿中文词去 grep 英文代码，跨语言注定 miss
2. 用户输入不准确时（"那个登录前烦人的小图片"），关键词法整条管道崩
3. 强行修复中文分词只是让烂管道跑通，不解决召回质量

### 6.2 改用 LLM 概念翻译 + 定向 probe + agentic 多轮

```text
Step 1  LLM 读 (用户原句, profile 摘要, 项目语言/框架)
        → 输出 intent_translation：业务概念 / 代码概念 / 搜索层

Step 2  按 intent_translation.search_layers 定向打开目录
        （白名单按 profile 推断：Vue 项目 → web-vue/src，
        Maven 项目 → modules/**/src/main，等）

Step 3  在白名单内 grep code_concepts（英文/代码层关键词）

Step 4  LLM 看一眼 Step 3 命中文件名，判断是否要继续 probe
        （多轮 agentic retrieval，最多 3 轮）

Step 5  汇总 → 翻译成业务面 + 落档工程定位面
```

**关键差异**：分词消失，召回的关键词来自 LLM 概念翻译（已是代码语言），不是用户原句切碎。

### 6.3 兜底降级

LLM 调用失败 / 超时时降级路径：

1. 直接输出 profile 摘要 + accepted_knowledge 命中条目
2. 业务面只产出 1 个问题：「请用一两句话告诉我这次改动主要影响哪些用户场景？」
3. 工程定位面留空，备注 `probe_skipped: llm_unavailable`
4. 标记本次 Context Pack 为 `quality: degraded`，需求 Gate 应识别此标记并要求人工补全

## 7. 产物 Schema

替代当前单文件 `context_pack.md`：

```text
artifacts/{run_id}/context_pack/
  ├── business.md         # 业务面（用户对话用、Requirement Agent 主输入）
  ├── technical.json      # 工程定位面（Design Agent 主输入）
  ├── evidence.json       # 跨产物 evidence refs（业务约束、历史决策来源）
  └── probe.log           # 探索过程日志（审计、debug）
```

| 文件 | 内容类型 | 主要消费者 |
|---|---|---|
| `business.md` | markdown | UI 展示、Requirement Agent |
| `technical.json` | JSON | Design Agent、Impl Agent |
| `evidence.json` | JSON | Acceptance Gate（traceability 校验） |
| `probe.log` | text | Debug / Audit |

Requirement Gate 检查：
- `business.md` 必须存在且包含 `clarifying_questions` ≥ 3 条
- 业务面**不允许出现**禁忌词（§3.2 黑名单字符串静态扫描）
- `technical.json` 存在但**不参与** Requirement Gate 校验

## 8. 度的衡量（更新版）

| 项 | 上限 | 说明 |
|---|---|---|
| `business.md` 总长度 | ≤ 1500 tokens / ~5KB | 超过就裁，业务面追求"够用就好" |
| `technical.json` candidate_files | ≤ 15 条 | 设计阶段也用不上更多 |
| `clarifying_questions` | 3-5 条 | 少于 3 视为信号弱 → 触发 deep probe；多于 5 视为没拍准重点 |
| 5 类问题分布 | 同一类 ≤ 2 条 | 避免全部堆在"范围"维度 |

深度档位（沿用前一版思路，触发条件简化）：

```text
shallow   →  请求是单文件级 / 文案级
standard  →  默认
deep      →  命中敏感路径 / 跨前后端 / accepted_knowledge 有相关条目
```

## 9. 与三层模型的关系

| 层 | 旧版 §15 描述 | 修订后 |
|---|---|---|
| 项目薄地图（init 时生成） | 不变 | 增加约束：薄地图本身就要分"业务能力清单"和"工程模块清单"两节 |
| 需求 Context Pack | 一份带 evidence 的文档 | **本文档定义的双视图产物** |
| 验收后回写 | 写到 requirements/architecture/decisions | 增加约束：写回的内容也要分业务面（requirements/）和工程面（architecture/）两类，不混淆 |

## 10. 对当前实现的修订步骤

针对 `apps/runner/src/agents/native.ts`：

| 步骤 | 改动 | 影响范围 |
|---|---|---|
| 1 | 删除 `tokenizeRequest` 和 `STOPWORDS` | -20 行 |
| 2 | 新增 `translateIntent(userRequest, profile)` ——LLM 调用 | 新文件或同文件新函数 |
| 3 | 新增 `probeWithIntent(intent, workspace)` 替代 `searchCodeForKeywords` | 重写召回部分 |
| 4 | 拆分 `renderContextPack` → `renderBusinessView` + `dumpTechnicalView` | 同文件 |
| 5 | 修改 `NativeBackend.run` 在 `context_pack` 分支输出 4 个文件而非 1 个 | `single` → `multiple` |
| 6 | `requirement` 分支的 `contextPackExcerpt` 改为只读 `business.md` | 防止技术污染需求文档 |
| 7 | Requirement Gate 增加禁忌词静态扫描（§3.2） | gate-engine 侧改动 |
| 8 | Web UI 把 Context Pack 拆两个 tab：业务面（默认展开）/ 工程定位面（默认折叠） | apps/web 侧 |

NativeBackend 在没有 LLM 接入前：
- 仍然产出 4 个文件，但 `business.md` 内容只有"用户原句 + 一个兜底问题"，标 `quality: degraded`
- `technical.json` 仍然可以做基于 profile 的目录定位（不依赖 LLM）

## 11. 未决问题

1. **5 类业务问题模板要不要随领域扩展？** 比如金融领域加"合规"类、IoT 加"实时性"类。当前先以这 5 类起步。
2. **`technical.json` 的 schema 怎么和 Design Agent 对齐？** 需要在 design-notes 里同步定义消费协议。
3. **业务面禁忌词清单怎么维护？** §3.2 现在是固定列表，需要随项目语言/框架扩展（比如 Python 项目要加 `decorator`、`fastapi` 等）。建议放到 profile 里按项目类型生成。
4. **用户回答 clarifying_questions 后怎么 lock 到需求文档？** 需要 Requirement Agent 把问答对结构化写入 `requirement.json` 的 `userScenarios` / `nonGoals` / `acceptanceCriteria`。这是下一份设计稿要解决的。

## 12. 一句话原则

> **业务面的语言对人，工程定位面的语言对码。
> 同一次工程探索，两层皮。
> 需求阶段不泄露技术，设计阶段不丢失探索。**

---

相关文档：
- 前置：`2026-05-01-ai-native-platform-context-pack-notes.md`（§15 三层模型保留）
- 业务流程：`2026-05-01-ai-native-platform-business-flow-integrated.md` §5
- 实现：`apps/runner/src/agents/native.ts::renderContextPack`
