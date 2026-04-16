import { useState } from "react";
import "./App.css";
import { TaskProvider } from "./context/TaskContext";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./components/Dashboard";
import { TaskManagement } from "./components/TaskManagement";

export default function App() {
  const [page, setPage] = useState<"board" | "tasks">("board");

  return (
    <TaskProvider>
      <AppShell active={page} onNav={setPage}>
        {page === "board" ? <Dashboard /> : <TaskManagement />}
      </AppShell>
    </TaskProvider>
  );
}
