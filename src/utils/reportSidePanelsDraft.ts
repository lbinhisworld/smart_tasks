/**
 * @fileoverview 报告提取页侧栏草稿：「现有任务进度更新」「日报计划任务生成」；刷新/切页后恢复；仅点击「解析」时由页面清空。
 */

import type { TaskStatus } from "../types/task";
import { formatExtractionDate } from "./llmExtract";

const STORAGE_KEY = "qifeng_report_side_panels_draft_v1";

export type StoredTaskProgressRowState = {
  taskId: string;
  code: string;
  description: string;
  currentStatus: TaskStatus;
  progressEdit: string;
  statusChoice: "" | TaskStatus;
  rowPhase: "pending" | "loading" | "done" | "error";
  rowError?: string;
};

export type StoredCompanyProgressCardState = {
  companyName: string;
  dailyPlainText: string;
  /** 写入任务进度跟踪时使用的日报日期 YYYY-MM-DD */
  reportDate: string;
  tasks: StoredTaskProgressRowState[];
  cardPhase: "pending" | "running" | "done";
};

export type StoredTaskProgressPanelState = {
  companies: StoredCompanyProgressCardState[];
};

export type StoredPlanGenRowState = {
  id: string;
  initiatingDepartment: string;
  executingDepartment: string;
  reportDate: string;
  requestDescription: string;
  leaderInstruction: string;
  rowPhase: "pending" | "generating" | "done" | "error";
  taskCode: string | null;
  rowError?: string;
};

export type StoredPlanGenCompanyState = {
  companyName: string;
  cardPhase: "pending" | "running" | "done";
  rows: StoredPlanGenRowState[];
  generatedCount: number;
};

export type StoredPlanGenPanelState = {
  companies: StoredPlanGenCompanyState[];
};

export type ReportSidePanelsDraftV1 = {
  version: 1;
  taskProgressPanel: StoredTaskProgressPanelState | null;
  planGenPanel: StoredPlanGenPanelState | null;
};

const STATUSES_SET = new Set<TaskStatus>(["进行中", "已完成", "实质性进展"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseTaskStatus(v: unknown): TaskStatus | null {
  if (v === "进行中" || v === "已完成" || v === "实质性进展") return v;
  return null;
}

function parseTaskProgressRow(v: unknown): StoredTaskProgressRowState | null {
  if (!isRecord(v)) return null;
  const taskId = v.taskId;
  const code = v.code;
  const description = v.description;
  const currentStatus = parseTaskStatus(v.currentStatus);
  const progressEdit = v.progressEdit;
  const statusChoiceRaw = v.statusChoice;
  const rowPhase = v.rowPhase;
  const rowError = v.rowError;
  if (typeof taskId !== "string" || typeof code !== "string" || typeof description !== "string") {
    return null;
  }
  if (!currentStatus) return null;
  if (typeof progressEdit !== "string") return null;
  let statusChoice: "" | TaskStatus = "";
  if (statusChoiceRaw === "" || statusChoiceRaw == null) {
    statusChoice = "";
  } else if (typeof statusChoiceRaw === "string" && STATUSES_SET.has(statusChoiceRaw as TaskStatus)) {
    statusChoice = statusChoiceRaw as TaskStatus;
  } else {
    return null;
  }
  if (rowPhase !== "pending" && rowPhase !== "loading" && rowPhase !== "done" && rowPhase !== "error") {
    return null;
  }
  return {
    taskId,
    code,
    description,
    currentStatus,
    progressEdit,
    statusChoice,
    rowPhase,
    rowError: typeof rowError === "string" ? rowError : undefined,
  };
}

function parseCompanyProgress(v: unknown): StoredCompanyProgressCardState | null {
  if (!isRecord(v)) return null;
  const companyName = v.companyName;
  const dailyPlainText = v.dailyPlainText;
  const reportDateRaw = v.reportDate;
  const cardPhase = v.cardPhase;
  const tasksRaw = v.tasks;
  if (typeof companyName !== "string" || typeof dailyPlainText !== "string") return null;
  const reportDate =
    typeof reportDateRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(reportDateRaw.trim())
      ? reportDateRaw.trim()
      : formatExtractionDate();
  if (cardPhase !== "pending" && cardPhase !== "running" && cardPhase !== "done") return null;
  if (!Array.isArray(tasksRaw)) return null;
  const tasks: StoredTaskProgressRowState[] = [];
  for (const t of tasksRaw) {
    const row = parseTaskProgressRow(t);
    if (row) tasks.push(row);
  }
  return { companyName, dailyPlainText, reportDate, tasks, cardPhase };
}

function parseTaskProgressPanel(v: unknown): StoredTaskProgressPanelState | null {
  if (!isRecord(v)) return null;
  const companiesRaw = v.companies;
  if (!Array.isArray(companiesRaw)) return null;
  const companies: StoredCompanyProgressCardState[] = [];
  for (const c of companiesRaw) {
    const co = parseCompanyProgress(c);
    if (co) companies.push(co);
  }
  return { companies };
}

function parsePlanGenRow(v: unknown): StoredPlanGenRowState | null {
  if (!isRecord(v)) return null;
  const id = v.id;
  if (typeof id !== "string") return null;
  const initiatingDepartment = v.initiatingDepartment;
  const executingDepartment = v.executingDepartment;
  const reportDate = v.reportDate;
  const requestDescription = v.requestDescription;
  const leaderInstruction = v.leaderInstruction;
  const rowPhase = v.rowPhase;
  const taskCode = v.taskCode;
  const rowError = v.rowError;
  if (
    typeof initiatingDepartment !== "string" ||
    typeof executingDepartment !== "string" ||
    typeof reportDate !== "string" ||
    typeof requestDescription !== "string" ||
    typeof leaderInstruction !== "string"
  ) {
    return null;
  }
  if (rowPhase !== "pending" && rowPhase !== "generating" && rowPhase !== "done" && rowPhase !== "error") {
    return null;
  }
  if (taskCode != null && typeof taskCode !== "string") return null;
  return {
    id,
    initiatingDepartment,
    executingDepartment,
    reportDate,
    requestDescription,
    leaderInstruction,
    rowPhase,
    taskCode: taskCode == null ? null : taskCode,
    rowError: typeof rowError === "string" ? rowError : undefined,
  };
}

function parsePlanGenCompany(v: unknown): StoredPlanGenCompanyState | null {
  if (!isRecord(v)) return null;
  const companyName = v.companyName;
  const cardPhase = v.cardPhase;
  const rowsRaw = v.rows;
  const generatedCount = v.generatedCount;
  if (typeof companyName !== "string") return null;
  if (cardPhase !== "pending" && cardPhase !== "running" && cardPhase !== "done") return null;
  if (!Array.isArray(rowsRaw)) return null;
  if (typeof generatedCount !== "number" || !Number.isFinite(generatedCount)) return null;
  const rows: StoredPlanGenRowState[] = [];
  for (const r of rowsRaw) {
    const row = parsePlanGenRow(r);
    if (row) rows.push(row);
  }
  return { companyName, cardPhase, rows, generatedCount };
}

function parsePlanGenPanel(v: unknown): StoredPlanGenPanelState | null {
  if (!isRecord(v)) return null;
  const companiesRaw = v.companies;
  if (!Array.isArray(companiesRaw)) return null;
  const companies: StoredPlanGenCompanyState[] = [];
  for (const c of companiesRaw) {
    const co = parsePlanGenCompany(c);
    if (co) companies.push(co);
  }
  return { companies };
}

function tryParseDraft(raw: string): ReportSidePanelsDraftV1 | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.version !== 1) return null;
  let taskProgressPanel: StoredTaskProgressPanelState | null = null;
  let planGenPanel: StoredPlanGenPanelState | null = null;
  if (data.taskProgressPanel != null) {
    taskProgressPanel = parseTaskProgressPanel(data.taskProgressPanel);
  }
  if (data.planGenPanel != null) {
    planGenPanel = parsePlanGenPanel(data.planGenPanel);
  }
  return { version: 1, taskProgressPanel, planGenPanel };
}

/** 刷新后避免永久转圈：运行中一律视为待继续。 */
export function normalizeTaskProgressPanelAfterLoad(
  panel: StoredTaskProgressPanelState | null,
): StoredTaskProgressPanelState | null {
  if (!panel) return null;
  return {
    companies: panel.companies.map((c) => ({
      ...c,
      cardPhase: c.cardPhase === "running" ? "pending" : c.cardPhase,
      tasks: c.tasks.map((t) => ({
        ...t,
        rowPhase: t.rowPhase === "loading" ? "pending" : t.rowPhase,
      })),
    })),
  };
}

export function normalizePlanGenPanelAfterLoad(
  panel: StoredPlanGenPanelState | null,
): StoredPlanGenPanelState | null {
  if (!panel) return null;
  return {
    companies: panel.companies.map((c) => ({
      ...c,
      cardPhase: c.cardPhase === "running" ? "pending" : c.cardPhase,
      rows: c.rows.map((r) => ({
        ...r,
        rowPhase: r.rowPhase === "generating" ? "pending" : r.rowPhase,
      })),
    })),
  };
}

export function loadReportSidePanelsDraft(): ReportSidePanelsDraftV1 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return tryParseDraft(raw);
  } catch {
    return null;
  }
}

export function saveReportSidePanelsDraft(draft: ReportSidePanelsDraftV1): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* quota */
  }
}

export function clearReportSidePanelsDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
