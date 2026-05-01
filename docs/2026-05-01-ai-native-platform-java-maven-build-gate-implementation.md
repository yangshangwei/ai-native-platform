# AI Native 云开发平台：Java / Maven Build Gate 实现细节

日期：2026-05-01

## 12. BuildRun 记录

每次 Maven 构建都要记录。

```ts
type BuildRun = {
  id: string
  workflowRunId: string
  stepRunId: string
  buildProfileId: string
  language: 'java'
  buildTool: 'maven'
  image: string
  jdkVersion: string
  mavenCommand: string
  status: 'passed' | 'failed' | 'timeout' | 'cancelled'
  startedAt: string
  completedAt: string
  commandRuns: CommandRun[]
  logsUri: string
  artifacts: ArtifactRef[]
}
```

CommandRun：

```ts
type CommandRun = {
  stage: 'compile' | 'test' | 'package' | 'verify'
  command: string
  exitCode: number
  stdoutUri: string
  stderrUri: string
  durationMs: number
}
```

## 13. Maven Test Report 解析

Maven Surefire 默认报告：

```text
target/surefire-reports/*.xml
```

Failsafe 报告：

```text
target/failsafe-reports/*.xml
```

平台应解析 XML，生成 TestRun：

```ts
type TestRun = {
  id: string
  buildRunId: string
  framework: 'maven-surefire' | 'maven-failsafe'
  total: number
  passed: number
  failed: number
  skipped: number
  errors: number
  reportUri: string
}
```

Test Gate 不只看 Agent 描述，要看：

```text
mvn exitCode
surefire / failsafe report
```

## 14. Compile Gate 规则

```text
- BuildProfile 存在
- JDK image 可用
- Maven command 可执行
- compile command exitCode = 0
- 没有 timeout
- 没有 OOM killed
```

失败时阻断进入 Test Gate。

## 15. Test Gate 规则

```text
- test command exitCode = 0
- surefire reports 可解析
- failed = 0
- errors = 0
- required tests 没有全部 skipped
```

如果项目配置了覆盖率，再检查 coverage threshold。

## 16. 编译 / 测试失败后的流程

失败后不要让 Implementation Agent 盲修。

流程：

```text
BuildRun failed
  ↓
Debug Agent 分析 stderr / surefire report
  ↓
分类失败类型：
    - 编译错误
    - 类型错误
    - 依赖缺失
    - 测试失败
    - 环境缺失
    - flaky
  ↓
Coordinator 决定：
    - route_to Implementation Agent 修代码
    - route_to BuildConfig Agent 修 Build Profile
    - pause_for_human 缺少私有仓库 / secret / 外部服务
```

Debug Agent 可以解释失败，但不能把失败改成通过。

## 17. BuildConfig Agent

建议后续引入专门的 BuildConfig Agent。

职责：

```text
- 分析 pom.xml / mvnw / Maven profile
- 判断 JDK 版本是否不匹配
- 判断是否缺 settings.xml / 私有仓库凭据
- 建议 Build Profile 修改
```

但 Build Profile 的高风险变更应由人确认。

## 18. UI 设计

Project Settings 里增加：

```text
Build Profiles
```

字段：

```text
语言：Java
构建工具：Maven
JDK 版本
镜像
工作目录
compile command
test command
Maven settings secret
cache path
artifact path
最后一次成功运行
```

Workflow 页面显示：

```text
Maven Compile Gate
- Command: ./mvnw -B -DskipTests compile
- Status: failed
- Exit code: 1
- Duration: 2m31s
- Logs: 查看
- Debug Agent analysis: 查看
```

## 19. MVP 范围

第一版只做：

```text
- Maven 项目自动探测
- JDK 17 默认镜像
- 支持用户改 JDK 版本
- 支持 mvnw 优先
- 支持 mvn fallback
- 支持 Maven cache
- 支持 settings.xml secret mount
- Docker sandbox 执行
- BuildRun / CommandRun 记录
- Surefire report 解析
- Compile Gate / Test Gate
- 失败日志交给 Debug Agent 分析
```

暂不做：

```text
- Gradle
- 多模块复杂 profile 自动推断
- 集成测试 verify 默认启用
- 覆盖率强制门禁
- Kubernetes / microVM 高级隔离
```

## 20. 最终结论

Java / Maven 编译测试应该作为平台一级能力：

```text
Build Service
Build Profile
BuildRun
Compile Gate
Test Gate
Sandbox Runner
```

一句话：

> Implementation Agent 负责写代码；Build Service 负责真实编译；Build Gate 负责阻断；Debug Agent 负责解释失败；Coordinator 负责路由下一步。
