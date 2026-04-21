/**
 * @fileoverview 应用壳：四页路由（看板 / 报告 / 任务 / 数据中台）、`TaskProvider`。
 * 四页组件**同时挂载**，以 `display` 切换可见，便于在数据看板使用 AI 助手时后台驱动报告解析等逻辑而**不切换整页**。
 * `OPEN_REPORTS_PAGE_EVENT` 仍将路由切到报告页（用户从看板「跳转原文」等）。
 * `ASSISTANT_UI_ACTION_EVENT` 中导航类令牌不调用 `setPage`。
 *
 * @module App
 */

import { lazy, Suspense, useEffect, useState } from "react";
import "./App.css";
import { TaskProvider } from "./context/TaskContext";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./components/Dashboard";
import { TaskManagement } from "./components/TaskManagement";
import { OPEN_REPORTS_PAGE_EVENT } from "./utils/reportCitation";
import {
  ASSISTANT_UI_ACTION_EVENT,
  ASSISTANT_REPORT_PARSE_EVENT,
  REPORT_FOCUS_EXTRACTION_EVENT,
  TASK_OPEN_MANUAL_NEW_EVENT,
  type AssistantUiAction,
} from "./utils/assistantUiActions";

const ReportManagement = lazy(async () => {
  const m = await import("./components/ReportManagement");
  return { default: m.ReportManagement };
});

const DataSync = lazy(async () => {
  const m = await import("./components/DataSync");
  return { default: m.DataSync };
});

export default function App() {
  const [page, setPage] = useState<"board" | "reports" | "tasks" | "sync">("board");

  useEffect(() => {
    const openReports = () => setPage("reports");
    window.addEventListener(OPEN_REPORTS_PAGE_EVENT, openReports);
    return () => window.removeEventListener(OPEN_REPORTS_PAGE_EVENT, openReports);
  }, []);

  useEffect(() => {
    const handler = (ev: Event) => {
      const actions = (ev as CustomEvent<{ actions: AssistantUiAction[] }>).detail?.actions ?? [];
      void (async () => {
        for (const a of actions) {
          if (a.kind === "navigate") {
            // AI 助手不切换整页：各模块在后台保持挂载，仅由 focus/parse 等驱动
            continue;
          }
          if (a.kind === "open_task_manual_new") {
            window.dispatchEvent(new CustomEvent(TASK_OPEN_MANUAL_NEW_EVENT));
          } else if (a.kind === "focus_report_extraction") {
            window.dispatchEvent(new CustomEvent(REPORT_FOCUS_EXTRACTION_EVENT));
          } else if (a.kind === "trigger_report_parse") {
            window.dispatchEvent(new CustomEvent(ASSISTANT_REPORT_PARSE_EVENT, { detail: {} }));
          }
          await new Promise((r) => setTimeout(r, 0));
        }
      })();
    };
    window.addEventListener(ASSISTANT_UI_ACTION_EVENT, handler);
    return () => window.removeEventListener(ASSISTANT_UI_ACTION_EVENT, handler);
  }, []);

  const paneHidden = (p: typeof page) => page !== p;

  return (
    <TaskProvider>
      <AppShell active={page} onNav={setPage}>
        <div
          className="app-route-pane app-route-pane--board"
          style={page === "board" ? undefined : { display: "none" }}
          aria-hidden={paneHidden("board")}
        >
          <Dashboard />
        </div>
        <div
          className="app-route-pane"
          style={{ display: page === "reports" ? "block" : "none" }}
          aria-hidden={paneHidden("reports")}
        >
          <Suspense fallback={<div className="page-loading">报告模块加载中…</div>}>
            <ReportManagement />
          </Suspense>
        </div>
        <div
          className="app-route-pane"
          style={{ display: page === "tasks" ? "block" : "none" }}
          aria-hidden={paneHidden("tasks")}
        >
          <TaskManagement />
        </div>
        <div
          className="app-route-pane"
          style={{ display: page === "sync" ? "block" : "none" }}
          aria-hidden={paneHidden("sync")}
        >
          <Suspense fallback={<div className="page-loading">数据中台加载中…</div>}>
            <DataSync />
          </Suspense>
        </div>
      </AppShell>
    </TaskProvider>
  );
}
