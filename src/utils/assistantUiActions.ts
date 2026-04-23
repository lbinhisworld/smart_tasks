/**
 * @fileoverview AI 助手「行操作」：将模型输出的受控令牌映射为前端导航与模块内动作（CustomEvent）。
 */

export const ASSISTANT_UI_ACTION_EVENT = "qifeng-assistant-ui-action";

/** 任务页打开「手工新建任务」抽屉 */
export const TASK_OPEN_MANUAL_NEW_EVENT = "qifeng-task-open-manual-new";

/** 报告页切换到「报告提取」Tab */
export const REPORT_FOCUS_EXTRACTION_EVENT = "qifeng-report-focus-extraction";

/** 在已挂载的报告模块上触发与「解析」按钮相同的逻辑（不清路由；用户可仍在数据看板） */
export const ASSISTANT_REPORT_PARSE_EVENT = "qifeng-assistant-report-parse";

/** 报告模块单次解析结束，向数据看板助手回传摘要（仅 `assistantChatFollowup` 为 true 时派发） */
export const ASSISTANT_REPORT_PARSE_RESULT_EVENT = "qifeng-assistant-report-parse-result";

/** 将聊天区收集的日报正文写入报告提取区文本框（与核心记忆 1.2.2 一致） */
export const ASSISTANT_SET_REPORT_MANUAL_TEXT_EVENT = "qifeng-assistant-set-report-manual-text";

export function dispatchAssistantSetReportManualText(text: string): void {
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_SET_REPORT_MANUAL_TEXT_EVENT, { detail: { text } }),
  );
}

/** `ASSISTANT_REPORT_PARSE_EVENT` 的 detail（可选） */
export type AssistantReportParseRequest = {
  /** 与当前文本框解耦，避免 React 闭包未更新时解析读到旧正文 */
  sourceText?: string;
  /** 为 true 时解析结束后向助手派发 `ASSISTANT_REPORT_PARSE_RESULT_EVENT` */
  assistantChatFollowup?: boolean;
  /**
   * 为 true 且单卡解析成功时：在环节 1 完成后**自动顺序**执行环节 2（同「保存并更新现有任务进度」的进度推断，quiet 模式不写入提取历史、不刷新日报列表）、环节 3（仅拆解计划表；须用户点「生成任务」写入任务）。
   * 须与 `assistantChatFollowup` 同时为 true 方生效。
   */
  chainCoreMemorySteps?: boolean;
};

export function dispatchAssistantReportParse(req?: AssistantReportParseRequest): void {
  window.dispatchEvent(new CustomEvent(ASSISTANT_REPORT_PARSE_EVENT, { detail: req ?? {} }));
}

export type AssistantReportParseResultDetail = {
  ok: boolean;
  extractionDate: string;
  companyName: string;
  error: string | null;
  /** 若存在，聊天窗优先展示此说明（如数据中台多分支摘要） */
  summaryLine?: string;
  /** 为 true 时表示解析后将自动串联环节 2、3（聊天文案提示用） */
  willChainCoreMemory?: boolean;
};

export function dispatchAssistantReportParseResult(detail: AssistantReportParseResultDetail): void {
  window.dispatchEvent(new CustomEvent(ASSISTANT_REPORT_PARSE_RESULT_EVENT, { detail }));
}

/** 助手驱动：环节 2+3 自动串联结束后回传聊天窗（与 `chainCoreMemorySteps` 配套） */
export const ASSISTANT_REPORT_CHAIN_DONE_EVENT = "qifeng-assistant-report-chain-done";

export type AssistantReportChainDoneDetail = {
  progressUpdated: number;
  /** `no_env` | `no_slices` 等，见 ReportManagement 内约定 */
  progressSkipped: string | null;
  planGenerated: number;
  planSkipped: string | null;
  chainError: string | null;
};

export function dispatchAssistantReportChainDone(detail: AssistantReportChainDoneDetail): void {
  window.dispatchEvent(new CustomEvent(ASSISTANT_REPORT_CHAIN_DONE_EVENT, { detail }));
}

export type AssistantUiAction =
  | { kind: "navigate"; page: "board" | "reports" | "tasks" | "sync" }
  | { kind: "open_task_manual_new" }
  | { kind: "focus_report_extraction" }
  | { kind: "trigger_report_parse" };

/** 写入用户/模型 payload，与 parse 允许的令牌一致 */
export const ASSISTANT_UI_ACTION_TOKENS_HELP = `仅允许使用下列字符串作为 ui_action_tokens 数组元素（拼写完全一致）：
- navigate_board / navigate_reports / navigate_tasks / navigate_sync — 兼容旧提示词；**AI 助手场景下不会切换当前页面**（模块在后台保持挂载），可省略。
- open_task_manual_new — 在已挂载的任务模块上打开「手工新建任务」抽屉（用户仍可在数据看板侧栏使用助手）。
- focus_report_extraction — 将报告模块切到「报告提取」Tab（无需切换整页）。
- parse_report — 触发报告模块「解析」按钮同等逻辑：会先清空当前报告提取预览/卡片状态再按正文或附件执行解析（须已有日报正文或文件）。`;

export function mapUiActionTokens(tokens: string[]): AssistantUiAction[] {
  const out: AssistantUiAction[] = [];
  for (const raw of tokens) {
    const t = raw.trim();
    switch (t) {
      case "navigate_board":
        out.push({ kind: "navigate", page: "board" });
        break;
      case "navigate_reports":
        out.push({ kind: "navigate", page: "reports" });
        break;
      case "navigate_tasks":
        out.push({ kind: "navigate", page: "tasks" });
        break;
      case "navigate_sync":
        out.push({ kind: "navigate", page: "sync" });
        break;
      case "open_task_manual_new":
        out.push({ kind: "open_task_manual_new" });
        break;
      case "focus_report_extraction":
        out.push({ kind: "focus_report_extraction" });
        break;
      case "parse_report":
      case "trigger_report_parse":
        out.push({ kind: "trigger_report_parse" });
        break;
      default:
        break;
    }
  }
  return out;
}

export function dispatchAssistantUiActions(actions: AssistantUiAction[]): void {
  window.dispatchEvent(new CustomEvent(ASSISTANT_UI_ACTION_EVENT, { detail: { actions } }));
}
