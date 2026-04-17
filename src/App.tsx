/**
 * @fileoverview 应用壳：三页路由（看板 / 报告 / 任务）、`TaskProvider`、报告页懒加载。
 * 监听 `OPEN_REPORTS_PAGE_EVENT` 将路由切到报告页，供看板「跳转原文」与全局导航协同。
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

const ReportManagement = lazy(async () => {
  const m = await import("./components/ReportManagement");
  return { default: m.ReportManagement };
});

export default function App() {
  const [page, setPage] = useState<"board" | "reports" | "tasks">("board");

  useEffect(() => {
    const openReports = () => setPage("reports");
    window.addEventListener(OPEN_REPORTS_PAGE_EVENT, openReports);
    return () => window.removeEventListener(OPEN_REPORTS_PAGE_EVENT, openReports);
  }, []);

  return (
    <TaskProvider>
      <AppShell active={page} onNav={setPage}>
        {page === "board" ? (
          <Dashboard />
        ) : page === "reports" ? (
          <Suspense fallback={<div className="page-loading">报告模块加载中…</div>}>
            <ReportManagement />
          </Suspense>
        ) : (
          <TaskManagement />
        )}
      </AppShell>
    </TaskProvider>
  );
}
