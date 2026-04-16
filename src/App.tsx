import { lazy, Suspense, useState } from "react";
import "./App.css";
import { TaskProvider } from "./context/TaskContext";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./components/Dashboard";
import { TaskManagement } from "./components/TaskManagement";

const ReportManagement = lazy(async () => {
  const m = await import("./components/ReportManagement");
  return { default: m.ReportManagement };
});

export default function App() {
  const [page, setPage] = useState<"board" | "reports" | "tasks">("board");

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
