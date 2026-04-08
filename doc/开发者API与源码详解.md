# 开发者文档：API 与源码细节

## 1. 文档目的

本文档面向开发者，重点不是介绍“这个项目能做什么”，而是解释：

- 后端如何启动
- 路由如何分发
- 每个 API 如何工作
- Session 与 SSE 如何配合
- 各条工作流如何组织
- Prompt / Schema / Structured Stage 如何保证输出稳定
- 如何继续开发、调试、扩展

建议配合以下文件一起阅读：

- `package.json`
- `src/server/index.js`
- `src/server/routes.js`
- `src/core/orchestrator.js`
- `src/core/dse-author-flow.js`
- `src/core/dse-agent-runtime.js`
- `src/core/structured-stage.js`
- `src/model/config.js`
- `src/model/client.js`
- `src/utils/events.js`
- `src/core/session-store.js`

---

## 2. 服务启动与总入口

### 2.1 启动脚本

`package.json:5-7`

```json
"scripts": {
  "start": "node src/server/index.js"
}
```

### 2.2 服务启动入口

`src/server/index.js:1-39`

职责：

1. 注册全局异常日志
2. 初始化全局会话存储
3. 初始化全局 SSE emitter 映射
4. 初始化 AI scheduler
5. 创建 HTTP server
6. 将所有请求交给 `routeRequest(req, res)`

### 2.3 全局运行时对象

在 `globalThis` 上挂载：

- `__MATH_SESSIONS__`
- `__MATH_SESSION_EMITTERS__`
- `__AI_SCHEDULER__`

这意味着：

- 会话数据是进程内内存态
- SSE 连接状态也是进程内管理
- 多个并发 AI 请求通过统一 scheduler 调度

### 2.4 端口

默认端口是 `3000`，可由 `PORT` 环境变量覆盖。

---

## 3. 路由系统

### 3.1 路由分发入口

`src/server/routes.js:652-669`

```js
if (pathname === '/api/solve') return handleSolve(req, res)
if (pathname === '/api/review') return handleReview(req, res)
if (pathname === '/api/review/followup') return handleReviewFollowup(req, res)
if (pathname === '/api/paper-review') return handlePaperReview(req, res)
if (pathname === '/api/paper-review-session') return handlePaperReviewSession(req, res)
if (pathname === '/api/debug/paper-review-sessions') return handlePaperReviewDebug(req, res)
if (pathname === '/api/dse-author/generate') return handleDseAuthorGenerate(req, res)
if (pathname === '/api/dse-author/followup') return handleDseAuthorFollowup(req, res)
if (pathname === '/api/dse-author/revalidate') return handleDseAuthorRevalidate(req, res)
if (pathname === '/api/dse-author/session') return handleDseAuthorSession(req, res)
if (pathname === '/api/debug-request-model') return handleDebugRequestModel(req, res)
if (pathname === '/api/providers') return handleProviders(req, res)
if (pathname === '/api/events') return handleEvents(req, res)
if (pathname === '/api/diagram') return handleDiagram(req, res)
return serveStatic(req, res)
```

### 3.2 路由分类

#### 静态页面

由 `serveStatic(...)` 提供，映射表在 `PUBLIC_FILES`：

- `/`
- `/simple`
- `/review`
- `/review-simple`
- `/paper-review`
- `/dse-author`
- 以及对应 JS / CSS / KaTeX 资源

#### API 路由

项目核心 API 有：

- `/api/providers`
- `/api/events`
- `/api/solve`
- `/api/review`
- `/api/review/followup`
- `/api/paper-review`
- `/api/paper-review-session`
- `/api/debug/paper-review-sessions`
- `/api/dse-author/generate`
- `/api/dse-author/followup`
- `/api/dse-author/revalidate`
- `/api/dse-author/session`
- `/api/debug-request-model`
- `/api/diagram`

---

## 4. HTTP 工具层

`src/utils/http.js:6-115`

### 4.1 `sendJson(res, statusCode, data)`

统一 JSON 响应函数。

### 4.2 `sendNotFound(res)`

统一 404。

### 4.3 `sendMethodNotAllowed(res)`

统一 405。

### 4.4 `readJsonBody(req)`

读取原始请求体并 `JSON.parse`。

### 4.5 `readMultipartPdfUpload(req)`

手动解析 multipart/form-data，用于整卷 PDF 上传。

特点：

- 自己解析 boundary
- 只接受字段名 `pdf`
- 只接受 `.pdf`
- 把上传文件写入临时目录
- 返回 `cleanup()`，供调用方清理临时目录

这说明项目没有引入 express/multer，而是保持轻量纯 Node 实现。

---

## 5. Provider 与模型调用层

## 5.1 Provider 注册入口

`src/model/config.js`

### `getProviderRegistry()`

- 开发环境：使用 `config/test-api.js`
- 生产环境：使用环境变量拼装 provider 列表

### `listModelPresets()`

供前端的 `/api/providers` 使用，返回：

- `defaultProviderId`
- `providers[]`
  - `id`
  - `label`
  - `providerType`
  - `modelHint`
  - `description`

### `ensureModelConfig(providerId)`

在真正请求模型前确保配置完整。

按 provider 类型校验：

- Azure OpenAI：检查 endpoint / apiKey / deployment / apiVersion
- Gemini：检查 apiKey / model
- OpenAI-compatible：检查 baseUrl / apiKey / model

## 5.2 模型请求主入口

`src/model/client.js`

这是项目最复杂的底层之一。它把多家模型供应商收敛为同一调用接口。

### 核心职责

- 读取 provider 配置
- 创建 client
- 处理 text / image / PDF 输入
- 支持 stream / non-stream
- 支持 retry
- 支持 scheduler
- 兼容 Gemini 特殊请求模式

### 5.3 createClient(providerId)

根据 provider 类型创建：

- AzureOpenAI client
- OpenAI-compatible client
- Gemini（无 OpenAI SDK client，走自定义 HTTP）

### 5.4 PDF 输入处理

#### OpenAI / Azure 路径

- 先上传文件
- 获取 `file_id`
- 再在 responses input 中引用 `input_file`

#### Gemini 路径

- 直接把 PDF 读入 base64
- 作为 `inlineData` 发送

### 5.5 图片输入处理

- 浏览器前端会把图片转 base64
- 后端按不同 provider 的要求映射为 image input

### 5.6 Gemini 特殊调用

`requestGeminiApi(...)`：

- 用 `curl` 直接发请求
- 请求体会先写到临时 json 文件
- 默认带本地代理环境变量

这意味着 Gemini 在本项目中并不是通过 OpenAI SDK 风格统一接入，而是专门维护了一条原生 HTTP 路径。

### 5.7 自动重试

`withRetries(task)`：

对以下状态做重试：

- 408
- 429
- 500
- 502
- 503
- 504

最多 3 次。

### 5.8 调度器

`withScheduler(task, options)` 把模型调用纳入全局 scheduler。

scheduler 实现在 `src/core/ai-scheduler.js:4-48`：

- `minIntervalMs`
- `maxConcurrent`
- queue pump 模式

默认 server 启动时设为：

- `minIntervalMs: 0`
- `maxConcurrent: 24`

---

## 6. Session 与 SSE 机制

## 6.1 Session Store

`src/core/session-store.js`

### 主要接口

- `setSession(sessionId, session)`
- `getSession(sessionId)`
- `getAllSessions()`
- `updateSession(sessionId, updater)`
- `appendFollowupMessage(sessionId, message)`
- `appendSessionMessage(sessionId, message)`
- `appendToolCall(sessionId, toolCall)`
- `getSessionDebugLog()`

### 设计特点

- 仅使用内存 Map
- 会记录操作日志到 `__MATH_SESSION_DEBUG__`
- 适合本地工作台
- 服务重启后 session 会丢失

## 6.2 SSE

`src/server/sse.js`

### `initSse(res)`

设置：

- `content-type: text/event-stream`
- `cache-control: no-cache, no-transform`
- `connection: keep-alive`
- `access-control-allow-origin: *`

### `sendSseEvent(res, event)`

按 SSE 规范输出：

```txt
event: <type>
data: <payload>
```

## 6.3 事件连接流程

`src/server/routes.js:75-102` 的 `handleEvents(...)`：

1. 检查 `sessionId`
2. 初始化 SSE
3. 为该 session 注册 emitter
4. 连接关闭时移除 emitter
5. 立即发送 `session_created`

## 6.4 事件常量定义

`src/utils/events.js`

事件分成几大类：

- solve
- review
- paper-review
- dse-author / dse-agent
- model_call
- diagram
- final_explanation
- stage_repair / failed
- session_error

开发时应尽量复用现有事件名，而不是随意新增不一致命名。

---

## 7. Structured Stage：统一结构化阶段执行器

`src/core/structured-stage.js:91-234`

这是所有结构化 AI 阶段的通用骨架。

## 7.1 输入参数

主要参数包括：

- `stageKey`
- `emit`
- `request`
- `mainPrompt`
- `compactPrompt`
- `buildRepairPrompt`
- `validator`
- `startedEvent`
- `deltaEvent`
- `repairingEvent`
- `compactRetryEvent`
- `failedEvent`
- `fallback`
- `modelCall`

## 7.2 标准执行链路

1. 发送主 prompt
2. 收集文本输出
3. `parseJsonFromText(...)`
4. `validator(...)`
5. 失败则发 repair prompt
6. 再失败则走 compact retry
7. 再失败则 fallback 或抛错

## 7.3 事件发射

structured stage 会自动发：

- model call started / delta / done / failed
- repairing
- compact retry
- failed

## 7.4 为什么重要

这层把所有“模型可能输出坏 JSON”的不稳定性收敛成统一行为，是整个项目工程化的关键基础。

---

## 8. API 详细说明

## 8.1 `GET /api/providers`

### 作用

返回当前前端可选的模型列表。

### 后端

- `handleProviders(...)`
- 位置：`src/server/routes.js:450-453`

### 返回

```json
{
  "defaultProviderId": "api1",
  "providers": [
    {
      "id": "api1",
      "label": "...",
      "providerType": "azure-openai",
      "modelHint": "gpt-5.1",
      "description": "..."
    }
  ]
}
```

### 前端使用点

所有页面启动时几乎都会先请求它。

---

## 8.2 `GET /api/events?sessionId=...`

### 作用

建立某个 session 的 SSE 流。

### 后端

- `handleEvents(...)`
- `src/server/routes.js:75-102`

### 错误场景

- 缺少 `sessionId` -> 400

### 使用要求

多数生成 / 批改 API 在正式启动后台流程前，都要求前端先连好事件流；否则有些流程会直接返回 409。

---

## 8.3 `POST /api/solve`

### 作用

启动单题解题流程。

### 后端

- `handleSolve(...)`
- `src/server/routes.js:104-140`

### 请求体

由 `src/schemas/input.js:8-31` 校验。

支持：

- 文本题
- 图片题
- `mode: simple | hard`

### 基本规则

- `text` 和 `imageBase64` 二选一
- 至少提供一个

### 返回

```json
{ "sessionId": "..." }
```

### 后台行为

返回后，后端通过 `process.nextTick(...)` 调用：

- `runSolveFlow(...)`

---

## 8.4 `POST /api/review`

### 作用

启动学生作答批改流程。

### 后端

- `handleReview(...)`
- `src/server/routes.js:142-178`

### 请求体

由 `validateReviewRequest(...)` 校验。

通常包括：

- 题目文本或图片
- 学生过程文本或图片
- 可选学生答案文本或图片
- mode
- providerId

### 返回

```json
{ "sessionId": "..." }
```

### 后台行为

后台调用：

- `runReviewFlow(...)`

---

## 8.5 `POST /api/review/followup`

### 作用

对已有 review session 继续追问。

### 后端

- `handleReviewFollowup(...)`
- `src/server/routes.js:180-217`

### 请求体

- `sessionId`
- `question`

### 依赖条件

- session 必须存在
- flowType 必须是 `review`
- 该 session 必须已有 SSE emitter

### 错误场景

- 找不到 session -> 404
- 未建立事件连线 -> 409

---

## 8.6 `POST /api/paper-review`

### 作用

启动整卷 PDF 批改。

### 后端

- `handlePaperReview(...)`
- `src/server/routes.js:219-315`

### 支持输入

#### 方式 1：multipart 上传 PDF

字段：

- `pdf`
- `providerId`
- `sessionId`（可选）

#### 方式 2：JSON 请求

- `pdfPath`
- `providerId`
- `sessionId`（可选）

### 返回

```json
{ "sessionId": "..." }
```

### 后台行为

- 初始化 paper-review session
- 启动 `runPaperReviewFlow(...)`
- 完成后清理上传临时文件

---

## 8.7 `GET /api/paper-review-session`

### 作用

获取整卷批改 session 的投影结果。

### 后端

- `handlePaperReviewSession(...)`
- `src/server/routes.js:434-448`

### 输出特点

不会直接返回原始 session，而是返回投影后的安全结构：

- `questions`
- `questionResults`
- `report`
- `phaseTimings`
- `groupTimings`

同时会把 page image 相关字段压成：

- `hasImageBase64`
- `cropApplied`
- `cropFallback`

---

## 8.8 `GET /api/debug/paper-review-sessions`

### 作用

调试 paper-review 运行时状态。

### 后端

- `handlePaperReviewDebug(...)`
- `src/server/routes.js:318-335`

### 返回内容

- 当前进程 pid
- session 列表摘要
- session debug 日志尾部

适合排查：

- 为什么报告一直 pending
- 为什么 questionResults 数量不对

---

## 8.9 `POST /api/dse-author/generate`

### 作用

启动 DSE 出卷流程。

### 后端

- `handleDseAuthorGenerate(...)`
- `src/server/routes.js:474-513`

### 请求体校验

见 `src/schemas/dse-author-input.js:45-75`

支持字段：

- `mode`
- `questionType`
- `language`
- `difficultyBand`
- `paperType`
- `topicCoverage`
- `avoidTopics`
- `mustHaveQuestionCount`
- `marksPerQuestion`
- `needsDiagram`
- `useRealWorldContext`
- `teacherGoal`
- `customConstraints`
- `conversation`

### 行为

- 立即回 `sessionId`
- 后台调用 `runDseAgentFlow(...)`

---

## 8.10 `POST /api/dse-author/followup`

### 作用

向已有 DSE session 继续发送老师消息。

### 后端

- `handleDseAuthorFollowup(...)`
- `src/server/routes.js:515-553`

### 请求体校验

见 `src/schemas/dse-author-input.js:77-94`

字段：

- `sessionId`
- `message`

### 依赖条件

- session 存在
- `flowType === 'dse-author'`
- SSE 已连接

### 后台行为

调用：

- `runDseAgentFollowupFlow(...)`

---

## 8.11 `POST /api/dse-author/revalidate`

### 作用

对某题草稿重新验算。

### 后端

- `handleDseAuthorRevalidate(...)`
- `src/server/routes.js:555-588`

### 请求体校验

见 `src/schemas/dse-author-input.js:96-125`

字段：

- `sessionId`
- `draft`
  - `title`
  - `questionTextZh`
  - `questionTextEn`
  - `answer`
  - `working`
  - `markingScheme`
  - `options`
  - `needsDiagram`
  - `diagramInstructions`

### 返回

```json
{
  "sessionId": "...",
  "generatedQuestions": []
}
```

---

## 8.12 `GET /api/dse-author/session`

### 作用

读取 DSE author session 投影结果。

### 后端

- `handleDseAuthorSession(...)`
- `src/server/routes.js:590-613`

### 输出内容

经 `projectDseAuthorSession(...)` 投影后返回：

- `intent`
- `blueprint`
- `generatedQuestions`
- `questionTasks`
- `paper`
- `exportArtifact`
- `followupMessages`
- `finalExplanation`
- `diagramImage`
- `messages`
- `toolCalls`
- `verificationHistory`
- `diagramHistory`
- `agentState`

### 调试特点

如果找不到 session，返回内容中还可能包含：

- `debug`
- `verifyDebug`
- `requestModelDebug`

非常适合定位 DSE 流程状态丢失问题。

---

## 8.13 `POST /api/diagram`

### 作用

对已有 session 单独触发图形生成。

### 后端

- `handleDiagram(...)`
- `src/server/routes.js:615-650`

### 请求体

- `sessionId`

### 依赖条件

- session 必须存在
- SSE 已建立

### 返回

```json
{
  "sessionId": "...",
  "imageDataUrl": "data:image/jpeg;base64,..."
}
```

---

## 8.14 `POST /api/debug-request-model`

### 作用

直接测试底层 `requestModel(...)`。

### 后端

- `handleDebugRequestModel(...)`
- `src/server/routes.js:455-472`

### 用途

适合定位：

- provider 是否可用
- prompt 是否能返回结果
- 某模型是否返回错误

---

## 9. Solve / Review / Paper Review Runtime 说明

主文件：`src/core/orchestrator.js`

这个文件负责多条主业务流：

- `runSolveFlow(...)`
- `runReviewFlow(...)`
- `runReviewFollowupFlow(...)`
- `runPaperReviewFlow(...)`
- `runDiagramFlow(...)`

### 共同模式

这些流程普遍具有下列结构：

1. 发 session started / input received
2. 进行标准化或索引阶段
3. 调用多个 prompt / schema stage
4. 不断 emit 事件
5. 更新 session
6. 最终输出聚合结果

### 设计风格

`orchestrator.js` 更偏“传统工作流编排器”：

- 明确阶段顺序
- 明确输入输出
- 明确每阶段事件

而 DSE runtime 已明显更 agent 化。

---

## 10. DSE Runtime 深度说明

DSE 相关核心文件：

- `src/core/dse-author-flow.js`
- `src/core/dse-agent-runtime.js`

## 10.1 `dse-author-flow.js`

这是较直线型的 DSE 流程实现。

### 主流程 `runDseAuthorFlow(...)`

大致阶段：

1. `AUTHOR_INTAKE_STARTED`
2. 意图识别（intent）
3. 若信息不足，生成 followup 请求并提前返回
4. blueprint 生成
5. 逐题生成
6. 逐题验证
7. compile paper
8. 生成 final explanation
9. session ready

### 验证链路 `runQuestionVerification(...)`

对于长题：

- Solver A
- Solver B
- Judge

对于 MC：

- 直接利用答案 / 文字构造 judge prompt

### 作用

即使未来全面切到 agent runtime，这个文件仍然很有参考价值，因为它清楚展示了 DSE 出题业务的基础结构。

## 10.2 `dse-agent-runtime.js`

这是当前更重要的 DSE 核心。

### 主要职责

- 管理 DSE agent session
- 维护 messages / toolCalls
- 管理 questionTasks
- 选择 action
- 驱动 question draft / solution / verify
- 处理图形生成
- 处理 followup
- 合并结果回草稿

### 内部关键函数类型

- session 摘要 / 序列化
- question task 生成与更新
- 文本草稿 prompt 构造
- solution prompt 构造
- 草稿文本解析
- solution 文本解析
- teacher message 抽取
- tool call / message 追踪

### 为什么复杂

因为它不是“一次请求，一次输出”，而是：

- 有会话状态
- 有 agent message
- 有 tool calls
- 有子 agent / 子任务
- 有 pending questionTasks
- 有 followup 多轮对话

这使它更接近一个 agent workbench。

---

## 11. Diagram 子系统源码说明

核心文件：

- `src/prompts/diagram.js`
- `src/diagram/python-runner.js`

## 11.1 Prompt 输出格式

要求模型只返回：

```json
{
  "reasoningSummary": "",
  "imageFormat": "jpg",
  "expectedFilename": "diagram.jpg",
  "canvasType": "square|portrait|landscape|wide",
  "pythonCode": "..."
}
```

## 11.2 Python 执行约束

`src/diagram/python-runner.js` 会先做静态校验：

- 必须包含 `__OUTPUT_IMAGE_PATH__`
- 必须包含 `__FIGSIZE__`
- 禁止硬编码 `figsize`
- 禁止 `tight_layout()`
- 禁止图上写解题过程

## 11.3 执行流程

1. 创建临时目录
2. 生成随机图片文件名
3. 把占位符替换成实际值
4. 写入 `diagram.py`
5. 调用 `python3`
6. 校验 JPG 是否生成成功
7. 返回 `data:image/jpeg;base64,...`

## 11.4 设计价值

相比直接生成图片，这条路径：

- 更可验证
- 更可调试
- 更容易 repair
- 更适合数学几何图

---

## 12. PDF 子系统源码说明

核心文件：

- `src/pdf/renderer.js`
- `src/pdf/cropper.js`

## 12.1 `renderPdfToImages(pdfPath)`

职责：

- 使用 `pdfinfo -box` 读取页面尺寸
- 计算两种缩放：
  - paper index 用
  - review 用（300dpi）
- 用 `pdftoppm` 生成图片
- 返回 page image + review image

### 输出字段

每页包含：

- `pageNumber`
- `imagePath`
- `imageBase64`
- `reviewImagePath`
- `reviewImageBase64`
- `mediaType`
- `renderWidth` / `renderHeight`
- `reviewRenderWidth` / `reviewRenderHeight`
- `sourceWidthPoints` / `sourceHeightPoints`
- `renderMode`
- `reviewRenderMode`

## 12.2 `cropPageImage(...)`

目前只支持：

- upper / top-half
- lower / bottom-half

依赖 macOS `sips` 完成裁切。

这意味着当前 PDF 裁切逻辑偏启发式，还不是通用版复杂版面分析。

---

## 13. 前端源码组织方式

所有前端都保持类似模式：

1. 缓存 DOM 引用
2. `loadProviders()`
3. `connectEvents(sessionId)`
4. 提交表单
5. 根据事件更新 UI

## 13.1 页面脚本一览

- `public/app.js`：困难版 solve
- `public/simple-app.js`：简单版 solve
- `public/review-app.js`：困难版 review
- `public/review-simple-app.js`：简单版 review
- `public/paper-review-app.js`：paper review
- `public/dse-author-app.js`：DSE workbench

## 13.2 `dse-author-app.js` 的特殊性

相比其他页面，它额外处理：

- modal
- split pane
- transcript 渲染
- model call / tool call 面板
- raw event panel
- draft card 渲染
- followup pending indicator
- 下载导出

因此它既是一个页面脚本，也几乎是一个前端小型工作台 runtime。

---

## 14. 常见扩展点

## 14.1 新增一个页面

需要同步修改：

1. `public/*.html`
2. `public/*-app.js`
3. `src/server/routes.js` 中 `PUBLIC_FILES`
4. 如果需要新工作流，则在 `src/core/` 新增 runtime
5. 补充对应 prompt/schema

## 14.2 新增一个 API

建议步骤：

1. 在 `src/server/routes.js` 增加 handler
2. 在 `src/utils/http.js` 复用 JSON / multipart 工具
3. 如涉及结构化模型输出，优先走 `runStructuredStage(...)`
4. 如需前端流式更新，补充 `SESSION_EVENT_TYPES`
5. 前端 `connectEvents(...)` 中接入新事件

## 14.3 新增一个结构化阶段

建议最小路径：

1. 新建 prompt 文件
2. 新建 schema validator
3. 在 `src/prompts/index.js` 导出
4. 在 `src/schemas/index.js` 导出
5. 在 runtime 中通过 `runStructuredStage(...)` 使用

## 14.4 新增 provider

- 开发环境改 `config/test-api.js`
- 生产环境改 `src/model/config.js`
- 如果是新类型 provider，可能还需扩展 `src/model/client.js`

---

## 15. 调试建议

## 15.1 先看哪一层坏了

建议按层排查：

1. 页面是否正确发请求
2. `sessionId` 是否正确
3. SSE 是否建立成功
4. handler 是否被调用
5. runtime 是否真正开始执行
6. 是否发出了事件
7. 前端是否监听了对应事件
8. 是否是 prompt / schema / repair 失败

## 15.2 常用排查入口

- `src/server/routes.js`
- `src/core/session-store.js`
- `src/utils/events.js`
- `src/core/structured-stage.js`
- `/api/debug/paper-review-sessions`
- `/api/dse-author/session`
- `/api/debug-request-model`

## 15.3 DSE 问题优先看什么

- `src/core/dse-agent-runtime.js`
- `public/dse-author-app.js`
- `src/schemas/dse-author-input.js`
- `src/utils/events.js`

## 15.4 Diagram 问题优先看什么

- `src/prompts/diagram.js`
- `src/diagram/python-runner.js`
- 调用 diagram 的 runtime 文件

## 15.5 Paper Review 问题优先看什么

- `src/pdf/renderer.js`
- `src/pdf/cropper.js`
- `src/core/orchestrator.js`
- `public/paper-review-app.js`

---

## 16. 推荐阅读顺序（开发者版）

建议顺序：

1. `package.json`
2. `src/server/index.js`
3. `src/server/routes.js`
4. `src/utils/http.js`
5. `src/server/sse.js`
6. `src/core/session-store.js`
7. `src/utils/events.js`
8. `src/model/config.js`
9. `src/model/client.js`
10. `src/core/ai-scheduler.js`
11. `src/core/structured-stage.js`
12. `src/core/orchestrator.js`
13. `src/core/dse-author-flow.js`
14. `src/core/dse-agent-runtime.js`
15. `src/pdf/renderer.js`
16. `src/pdf/cropper.js`
17. `src/prompts/index.js`
18. `src/schemas/index.js`
19. 最后再看 `public/*.js`

---

## 17. 开发者总结

这个项目最值得开发者理解的不是单个页面，而是以下几个“共通骨架”：

1. **routeRequest**：所有入口集中在一处
2. **session + SSE**：异步流程可视化的核心机制
3. **requestModel**：多 provider 统一入口
4. **runStructuredStage**：结构化输出稳定化骨架
5. **runtime 分层**：solve/review/paper-review 与 DSE 分别由不同 runtime 承担

理解了这 5 点，再扩展页面、加 API、换模型、补阶段，都会容易很多。
