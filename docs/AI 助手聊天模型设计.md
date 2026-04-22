# AI 助手聊天模型设计

本文档汇总**数据看板首页左侧「AI 助手」**的产品意图、界面与交互、与大模型调用相关的设计约定。实现以源码为准；若实现变更，应同步更新本文档。

**相关代码**

| 模块 | 路径 |
|------|------|
| 聊天面板组件 | `src/components/HomeAiChatPanel.tsx` |
| 看板布局（分栏、挂载聊天） | `src/components/Dashboard.tsx` |
| 看板页壳层（视口与主区域约束） | `src/components/AppShell.tsx` |
| 样式（分栏、气泡、流水线四步、动画） | `src/App.css`（`home-ai-pipeline*`、`shell--board-fill`、`main-area--home-board`、`home-page-split*`、`home-ai-chat*`） |
| 常驻知识 + 四步 LLM 提示与解析 | `src/utils/homeAssistantPrompt.ts` |
| 本机任务/提取历史行 JSON | `src/utils/homeAssistantDataRows.ts` |
| 常驻知识文档（人工维护） | `docs/核心记忆模块.md`（构建时以 `?raw` 打入前端） |
| 任务动态记忆（全表 TSV，随任务变） | `src/utils/taskDynamicMemory.ts`；`TaskContext` 中 `tasks` 变更时 `syncTaskDynamicMemoryFromTasks` |
| 日报动态记忆（提取历史摘要，随历史变） | `src/utils/reportDynamicMemory.ts`；`extractionHistoryStorage` 写库后 `rebuildReportDynamicMemoryFromHistory` |
| `production_report` 形态说明（报告助手注入） | `src/constants/reportProductionStructuredSchemaDoc.ts` |
| 报告范围筛选 / 结构化数组 | `src/utils/reportExtractionScopeFilter.ts`、`src/utils/homeAssistantReportPayload.ts` |
| LLM 环境读取与聊天 API | `src/utils/llmExtract.ts`（`readLlmEnv`、`callLlmChatJsonObject`） |
| 任务上下文（视角、可见任务数） | `src/context/TaskContext.tsx`（`useTasks`） |

---

## 1. 目标与范围

- **场景**：仅在路由为「**数据看板**」（`page === "board"`）时展示；与顶部 **「当前视角」** 同一套 `user.perspective` 与 `visibleTasks` 语义一致。
- **价值**：用自然语言回答与当前视角相关的**概况类、说明类**问题；**不替代**右侧看板上的精确数字与列表（模型输出可能不准确，需在提示词中约束并引导用户以界面为准）。
- **非目标（当前实现）**：不向模型注入完整任务/报告原文、不做服务端会话持久化、不做流式输出（SSE）、不与其他页面（报告管理、任务管理、数据中台）共用同一聊天实例。

---

## 2. 页面布局与滚动

### 2.1 分栏比例

- **左侧**：AI 助手区域，宽度为视口行宽的 **`calc(100% / 3 * 0.85)`**（在「约三分之一」基础上再缩小 15%），`flex: 0 0` + `max-width` 与之一致，避免被内容撑开。
- **右侧**：原有看板内容（任务看板 / 报告看板 Tab 及下方所有模块），`flex: 1 1 0%`、`min-width: 0`，占据剩余宽度。

### 2.2 滚动隔离（桌面）

- 数据看板激活时，外壳 `.shell.shell--board-fill` 使用 **`height: 100vh`** 且 **`overflow: hidden`**，避免整页随右侧内容滚动。
- 主内容区 `.main-area.main-area--home-board` 使用 **`min-height: 0`**、`overflow: hidden` 与纵向 flex，使内部 flex 子项能正确计算可滚动高度。
- **仅右侧** `.home-page-split-main` 设置 **`overflow-y: auto`**；左侧聊天列不随右侧滚动条移动，视觉上固定于主内容区左侧。
- 左侧卡片内 **消息列表** `.home-ai-chat-messages` 单独 **`overflow-y: auto`**，对话过长时在左栏内部滚动。

### 2.3 窄屏（≤900px）

- 取消视口锁高与主区域 `overflow: hidden`，改为**上下堆叠**：上方为聊天区（全宽、`max-height` 约 360px），下方为看板内容自然随页面滚动，避免小屏左右挤压不可用。

---

## 3. 界面与交互

### 3.1 四动作流水线 + 动作提示语 / 结果反馈语

界面始终展示 **4 个动作**。**大模型调用次数**：主题 **报告管理** 时为 **3 次**（第 4 步仅展示第 3 步返回的 `answer`）；**任务管理 / 综合** 时为 **4 次**。

| 序号 | 动作名称 | 动作提示语 | 大模型输入概要 | 结果反馈提示语（示例形态） |
|------|----------|------------|----------------|----------------------------|
| 1 | 主题判断 | `我正在进行【主题判断】` + 旋转动画 | 用户问题 + **仅核心记忆** | `已经确认查询主题：***`（报告管理 / 任务管理 / 综合或其它） |
| 2 | 数据范围判断 | 同上 | 用户问题 + **主题判断结果** | **报告主题**：`涉及报告日期：…` + `报告主体（分公司名称）：…`（模型输出 `report_dates` / `branch_companies`）；**非报告**：`已明确数据范围：…` |
| 3 | 数据记录判断 | 同上 | **报告主题**：用户询问 + **`production_report` 结构化说明**（`reportProductionStructuredSchemaDoc.ts`）+ **本机匹配条目的完整结构化 JSON 数组**（`buildReportStructuredArrayForLlm`）→ 模型输出 `record_set_summary` + **`answer`**；**非报告**：用户问题 + 主题 + 范围 + **任务与日报动态记忆** → `task_codes` / `extraction_history_ids` | **报告**：`已经确定数据记录集` + `record_set_summary`；**非报告**：`已经确定数据记录集` + 编号/id |
| 4 | 具体数据返回 | 同上 | **报告主题**：**不再调用**大模型，直接展示第 3 步的 `answer`；**非报告**：用户问题 + **本机数据行 JSON**（任务 + 提取节选） | **Markdown** 渲染（`.home-ai-pipeline-result--md`；小标题蓝色） |

- **进行中**：动作行末尾显示 **CSS 旋转动画**（`.home-ai-pipeline-spin`）。  
- **完成后**：动画位置改为 **✅**，并在下方 **结果反馈** 区域展示对应文案。  
- **等待中**：尚未轮到的动作显示「等待前序步骤完成…」。  
- UI 容器：`AssistantPipelineBlock`（`home-ai-pipeline*`）。

首条欢迎消息为普通文本，不参与流水线。

### 3.2 结构

- **标题区**：文案「AI 助手」+ 副文案展示 **当前视角**（与 `role-bar` 选择一致）。
- **消息区**：用户气泡右对齐；助手消息分为**普通文本气泡**（欢迎语）或**流水线气泡**（四动作）；`role="log"`、`aria-live="polite"`。
- **输入区**：多行文本框 + 「发送」按钮（`primary-btn`）；与现有表单样式 `fld` 一致。

### 3.3 输入与发送

- **Enter**：发送（`preventDefault`，避免误换行）。
- **Shift+Enter**：换行。
- **请求进行中**：输入框与发送按钮 **`disabled`**；进度由流水线各步动画体现，**不再**使用单独的全局占位气泡。

### 3.4 消息列表行为

- 消息仅存于组件 **React 状态**，**刷新页面即清空**；不做 localStorage / 后端会话。
- 每次 `messages` 或 `busy` 变化时，将消息容器 **`scrollTop` 滚至底部**，保证最新内容可见。

### 3.5 首条助手消息（冷启动）

- 说明 **四动作流水线**；报告主题下第 4 步为第 3 步答复的展示，任务主题为「数据行 JSON → 第四次模型调用」。

### 3.6 交互类型：操作（`operation`）

- **触发**：意图判断（动作 1）输出 `interaction_mode: "operation"`（见 `docs/ai_chat_skill.md` · 意图判断）。
- **权威来源**：`docs/核心记忆模块.md` · **「主要操作描述」**（模块主题、所需输入、操作路径各环节之触发条件 / 操作按钮 / 过程反馈）。助手须将用户诉求**落位**到已文档化的 **### 操作：…**（当前含「输入报告」「手工新建任务」等），不得编造未文档化流程。
- **调试模式流水线**：三步——**意图判断** → **确认操作及范围** → **行操作执行**（替换原四步询问流水线）。
- **用户模式**：流式阶段同上；最终答复由确认摘要、行操作 `rationale` 与已派发令牌摘要拼接而成（见 `homeAiUserModePipeline.ts`）。
- **执行边界**：应用壳层对四页路由**同时挂载、以 `display` 切换可见**（`App.tsx`），以便在**数据看板**使用 AI 助手时，后台仍可驱动报告/任务逻辑。`ASSISTANT_UI_ACTION_EVENT` 处理中 **`navigate_*` 不调用 `setPage`**，避免整页跳转。令牌能力见 `assistantUiActions.ts`：`focus_report_extraction`、`parse_report`（等同「解析」，会先清空提取预览再跑解析）、`open_task_manual_new` 等。文档要求但**尚无令牌**的步骤须在 `rationale` 中按核心记忆引导用户到报告管理内点击。
- **客户端纠正**：`homeAssistantPrompt.ts` 中 `coerceOperationModeForReportIntake` 在路由解析后执行：当用户话语文面为**录入/新建日报**而非**请教或统计**时，将误输出的 `inquiry` + 报告相关主题强制改为 `operation` + `report_management`，避免进入报告问答链路并编造整份日报。
- **调试模式展示**：操作路径下三步（意图判断、确认操作及范围、行操作执行）均在结果区展示**解析摘要** + **【模型返回原文】**（过长截断）；每步在完成状态下提供 **「优化」** 按钮，映射至 `intent` / `operation_confirm` / `operation_execute` 技能（`pipelineContext.pipelineKind === "operation"`）。

---

## 4. 大模型调用设计

### 4.1 环境解析（与全站一致）

聊天与报告提取、数据中台等**共用** `readLlmEnv()`（`llmExtract.ts`），优先级为：

1. **本地持久化的 DeepSeek Key**（`localStorage`，与系统配置弹窗一致）；开发环境请求走 **`/api/deepseek`**，生产直连 DeepSeek 官方 Chat Completions URL，模型名为 **`deepseek-chat`**。
2. 否则回退 **构建期环境变量** `VITE_LLM_*`（含可选 `VITE_LLM_VIA_PROXY=1` 走 `/api/llm` 等），详见 `readLlmEnvFromBuildEnv`。

若返回 **`null`**，聊天不发起网络请求，仅回复离线说明（引导用户打开右上角系统配置或配置构建变量）。

### 4.2 常驻系统知识与动态记忆（何时注入）

- **动作 1（意图判断）**：**核心记忆**全文（`resolveTopicRouterSystemPrompt`）；输出含 `interaction_mode` + `topic`。  
- **若为 `inquiry`（询问）**  
  - **动作 2**：**报告**用 `buildDataScopeSystemPromptForReport`；**非报告**用 `buildDataScopeSystemPrompt`。  
  - **动作 3**：**报告**用 `buildReportDataRecordSystemPrompt` + 形态说明 + 结构化 JSON；**非报告**用双动态记忆 + `parseDataRecordJson`。  
  - **动作 4**：仅 **非报告** `buildFinalDataAnswerSystemPrompt`；报告路径跳过第四次调用。  
- **若为 `operation`（操作）**  
  - **动作 2（确认）**：`buildOperationConfirmSystemPrompt` / `buildOperationConfirmUserPayload`——system 再次注入 **核心记忆**，模型须对齐 **「主要操作描述」** 输出 `module` / `operation` / `operation_info` / `user_facing_summary`（`parseOperationConfirmJson`）。  
  - **动作 3（行操作）**：`buildOperationExecuteSystemPrompt` / `buildOperationExecuteUserPayload`——system 仍含 **核心记忆**，结合上一步 JSON 输出 `ui_action_tokens` + `rationale`（`parseOperationExecuteJson`），随后 `runAssistantOperationUiActions` 派发受控事件（见 §3.6）。

### 4.3 调用接口

- 均使用 **`callLlmChatJsonObject`**；温度与 `postChatCompletion` 一致（`0.2`）。  
- 建议 **`maxCompletionTokens`**：动作 1～2 约 **1024**；**报告**动作 3 **8192**（JSON 较大）；**非报告**动作 3 **2048**，动作 4 **4096**。  
- 每步 **单条 system + 单条 user**，无对话历史拼接。

### 4.4 响应处理

- **动作 1**：`parseTopicRouterJson`（含 `interaction_mode`）；失败用 `ROUTER_FALLBACK`。  
- **`inquiry` 分支**  
  - **动作 2**：**报告** `parseDataScopeReportJson`；**非报告** `parseDataScopeJson`。  
  - **动作 3**：**报告** `parseReportDataRecordJudgmentJson`；**非报告** `parseDataRecordJson` + 本机过滤行。  
  - **动作 4**：仅 **非报告** `parseFinalAnswerJson`；**报告**使用动作 3 的 `answer`。  
- **`operation` 分支**  
  - **动作 2**：`parseOperationConfirmJson`（失败时用占位确认对象，避免中断）。  
  - **动作 3**：`parseOperationExecuteJson` + `runAssistantOperationUiActions`（仅映射已知令牌）。  
- **异常**：将当前 `running` 步标为 `error`，后续步保持 `waiting`。

---

## 5. 与「报告提取」等 LLM 能力的边界

| 能力 | 用途 | 与聊天的关系 |
|------|------|----------------|
| `callProductionReportExtraction` | 日报结构化 JSON | 独立；聊天不使用 |
| `callLlmChatJsonObject` | 通用 JSON 对象输出 | **聊天使用**：`inquiry` 时报告主题 **3 次** / 其它 **4 次**；`operation` 时 **3 次**（意图 + 确认 + 行操作） |
| `callLlmChatText` | 自由文本 | 报告/数据中台等其它功能使用 |
| `readLlmEnv` | 统一解析 Key / URL / model | **共享** |

聊天侧 **使用** `json_object`，但 **不使用** 报告提取专用 system/user 提示。

---

## 6. 后续扩展建议（未实现）

以下若落地，需更新本文档与验收标准：

- **多轮上下文**：将最近 N 条消息拼入 `messages` 数组，并设总长度/token 上限。
- **结构化上下文**：从 `visibleTasks` 或报告提取结果摘要生成短文本注入 system 或 user，需注意隐私与体积。
- **流式输出**：改用流式 API，边生成边更新最后一条助手消息。
- **持久化**：会话 ID、按用户/视角存储（需后端或加密本地存储策略）。
- **埋点与审计**：记录提问类别、是否调用成功（不记录 Key）。

---

## 7. 文档维护

- 修改四动作流水线、`homeAssistantPrompt`、`homeAssistantDataRows`、`readLlmEnv` / `callLlmChatJsonObject` 的聊天相关约定、或看板分栏滚动策略时，**应同步修订本文**。
- 调整三大业务模块的功能描述时，优先改 **`docs/核心记忆模块.md`**，并确认与 **`docs/设计文档.md`**、源码无矛盾。
- **销售预测/客户进货周期性分析/数据看板销售 Tab** 的权威业务说明见 **`docs/销售预测设计.md`**、**`docs/数据看板设计.md`**；与助手**非**同一聊天管线，但可在常驻知识中引用。
- 全局视角、任务可见性等产品规则仍以 **`docs/设计文档.md`** 为准；本文仅覆盖 **AI 助手聊天** 垂直切片。
