# AI Native 云开发平台：Java / Maven Build Sandbox 与 Build Gate 设计记录

日期：2026-05-01

## 1. 当前阶段范围

当前阶段只考虑 Java 项目，构建工具先聚焦 Maven。

暂不展开：

```text
Gradle
C / C++
Python
Go
Node
多语言 monorepo
```

但整体设计仍保留 Build Service / Build Profile / BuildRun / Build Gate 抽象，方便后续扩展其他语言。

## 2. 基本原则

编译 / 测试是开发阶段必不可少的强门禁。

核心原则：

> Agent 可以写代码，但平台必须在沙箱里真实编译它。

不能让 Agent 口头声明：

```text
“我觉得能编译”
“测试应该能过”
```

必须由平台真实执行 Maven 命令，并记录：

```text
命令
退出码
stdout / stderr
耗时
JDK / Maven 版本
镜像
依赖缓存
测试报告
失败日志
```

## 3. 是否需要沙箱

需要。

原因：

```text
- Agent 生成的代码不可信
- Maven 插件和依赖构建脚本不可信
- 多租户项目之间必须隔离
- JDK / Maven / 系统环境需要可复现
- 构建过程可能访问私有仓库和 secret，必须 scope 隔离
```

MVP 可以用 Docker，每次 BuildRun 启动一个 container。

生产建议用 Kubernetes Job / Pod，后续可增强为 gVisor / Kata / Firecracker。

## 4. 开发流程中的位置

Java/Maven 开发流程建议：

```text
Implementation Agent 修改代码
  ↓
Diff Scope Gate
  ↓
Maven Compile Gate
  ↓
Maven Test Gate
  ↓
Review Gate
  ↓
Acceptance Gate
```

编译不过，不允许进入验收。

## 5. Maven 项目探测

Build Plan Resolver 先识别 Maven 项目。

探测文件：

```text
pom.xml
.mvn/
mvnw
mvnw.cmd
```

优先级：

```text
项目手动 Build Profile
  > mvnw wrapper
  > 系统 Maven
  > Agent 建议
```

如果存在 `mvnw`，优先使用：

```bash
./mvnw
```

否则使用：

```bash
mvn
```

## 6. Java / Maven Build Profile

每个项目应保存一个默认 Maven Build Profile。

示例：

```yaml
id: default-java-maven
language: java
buildTool: maven
image: eclipse-temurin:17
workingDirectory: .

commands:
  compile:
    - ./mvnw -B -DskipTests compile
  test:
    - ./mvnw -B test

cache:
  - ~/.m2/repository

artifacts:
  - target/surefire-reports
  - target/failsafe-reports
  - target/site/jacoco

timeouts:
  compileSeconds: 600
  testSeconds: 1200
```

如果项目没有 `mvnw`，命令改成：

```bash
mvn -B -DskipTests compile
mvn -B test
```

## 7. JDK 版本选择

优先级：

```text
项目配置的 JDK version
  > pom.xml 中 maven-compiler-plugin / properties
  > .java-version / .sdkmanrc
  > 平台默认 JDK
```

常见 Maven properties：

```xml
<maven.compiler.source>17</maven.compiler.source>
<maven.compiler.target>17</maven.compiler.target>
<java.version>17</java.version>
```

平台默认建议：

```text
JDK 17
```

但 UI 中必须允许项目修改为 8 / 11 / 17 / 21。

## 8. Maven 命令建议

### Compile Gate

```bash
./mvnw -B -DskipTests compile
```

目的：快速发现语法、类型、依赖、annotation processing 问题。

### Test Gate

```bash
./mvnw -B test
```

目的：执行单元测试。

### 可选 Package Gate

```bash
./mvnw -B package
```

适合需要验证打包产物的项目。

### 集成测试

Maven Failsafe 常见：

```bash
./mvnw -B verify
```

第一版可以不默认跑 `verify`，除非项目配置启用。

## 9. Maven 私有仓库和 Secret

企业 Java 项目常有私有 Maven 仓库。

不要把凭据写进 Build Profile 明文。

使用 secret 引用：

```yaml
secrets:
  - id: maven-settings
    mountPath: ~/.m2/settings.xml
    secretRef: secret://project/maven-settings
```

平台负责把 secret 挂载进 sandbox。

Agent 不应直接看到 secret 明文。

## 10. Maven 缓存

缓存路径：

```text
~/.m2/repository
```

缓存粒度建议：

```text
tenant / project / build-profile
```

不要跨租户共享不可信缓存。

缓存策略：

```text
- 默认启用 Maven 依赖缓存
- 支持手动清理缓存
- 构建失败时保留日志，不一定保留 workspace
```

## 11. Sandbox Runner

MVP：Docker。

执行方式：

```text
1. clone repo / checkout branch 到 workspace
2. 挂载 workspace 到 container
3. 挂载 Maven cache
4. 挂载必要 secret，例如 settings.xml
5. 执行 compile command
6. 执行 test command
7. 收集日志和 test reports
8. 销毁 container
```

生产：Kubernetes Job / Pod。

需要限制：

```text
CPU
Memory
Timeout
Network egress
Secret scope
Workspace volume
```

---

续篇：`2026-05-01-ai-native-platform-java-maven-build-gate-implementation.md`。
