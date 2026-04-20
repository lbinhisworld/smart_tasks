/**
 * @fileoverview 任务列表与当前用户「视角」的 React Context：本地持久化、按当前视角过滤可见任务。
 *
 * **设计要点**
 * - `CurrentUser.perspective`：`集团领导` 或配置架构中的 `{名称}领导`。
 * - 任务可见性见 `taskVisibleForPerspective`；报告提取历史见 `extractionHistoryVisibleForPerspective`。
 *
 * @module TaskContext
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { SEED_TASKS } from "../data/seedTasks";
import {
  GROUP_LEADER_PERSPECTIVE,
  isBranchCompanyUnit,
  taskVisibleForPerspective,
} from "../utils/leaderPerspective";
import type {
  CurrentUser,
  Task,
  TaskCategory,
  TaskProgressEntry,
  TaskStatus,
} from "../types/task";

const STORAGE_KEY = "qifeng_smart_tasks_v1";
const USER_KEY = "qifeng_smart_tasks_user_v1";

function normalizeProgressTracking(raw: unknown): TaskProgressEntry[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const out: TaskProgressEntry[] = [];
  for (const el of raw) {
    if (!el || typeof el !== "object") continue;
    const o = el as Record<string, unknown>;
    const date = o.date;
    const description = o.description;
    if (typeof date !== "string" || typeof description !== "string") continue;
    const d = date.trim();
    const desc = description.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !desc) continue;
    out.push({ date: d, description: desc });
  }
  return out.length ? out : undefined;
}

function normalizeStoredTask(t: Task): Task {
  const execRaw =
    t.executingDepartment?.trim() ||
    (() => {
      const b = t.branch?.trim();
      if (b && isBranchCompanyUnit(b)) return b;
      return t.department?.trim() || "";
    })();
  let branch = t.branch ?? "";
  let workshop = t.workshop ?? null;
  if (isBranchCompanyUnit(execRaw)) {
    branch = execRaw;
  } else {
    branch = "";
    workshop = null;
  }
  const taskMotivation =
    typeof (t as { taskMotivation?: unknown }).taskMotivation === "string"
      ? (t as { taskMotivation: string }).taskMotivation.trim()
      : "";
  const progressTracking = normalizeProgressTracking(
    (t as { progressTracking?: unknown }).progressTracking,
  );
  return {
    ...t,
    executingDepartment: execRaw,
    branch,
    workshop,
    taskMotivation,
    ...(progressTracking ? { progressTracking } : {}),
  };
}

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEED_TASKS.map(normalizeStoredTask);
    const parsed = JSON.parse(raw) as Task[];
    if (!Array.isArray(parsed) || !parsed.length) return SEED_TASKS.map(normalizeStoredTask);
    return parsed.map((row) => normalizeStoredTask(row as Task));
  } catch {
    return SEED_TASKS.map(normalizeStoredTask);
  }
}

function migrateLegacyUser(raw: unknown): CurrentUser {
  if (raw && typeof raw === "object" && raw !== null && "perspective" in raw) {
    const p = (raw as { perspective?: unknown }).perspective;
    if (typeof p === "string" && p.trim()) return { perspective: p.trim() };
  }
  const o = raw as Record<string, unknown> | null;
  if (!o) return { perspective: GROUP_LEADER_PERSPECTIVE };
  const role = o.role as string | undefined;
  const department = typeof o.department === "string" ? o.department : "";
  const branch = typeof o.branch === "string" ? o.branch : "";
  if (role === "chairman") return { perspective: GROUP_LEADER_PERSPECTIVE };
  if (role === "functional" && department) return { perspective: `${department}领导` };
  if (role === "branch" && branch) return { perspective: `${branch}领导` };
  if (role === "workshop" && branch) return { perspective: `${branch}领导` };
  return { perspective: GROUP_LEADER_PERSPECTIVE };
}

function loadUser(): CurrentUser {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) return migrateLegacyUser(JSON.parse(raw) as unknown);
  } catch {
    /* ignore */
  }
  return { perspective: GROUP_LEADER_PERSPECTIVE };
}

interface TaskContextValue {
  tasks: Task[];
  visibleTasks: Task[];
  user: CurrentUser;
  setUser: (u: CurrentUser) => void;
  addTask: (input: Omit<Task, "id" | "code" | "createdAt"> & { code?: string }) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  removeTask: (id: string) => void;
  toggleFollow: (id: string) => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

/**
 * 挂载任务状态与持久化；应在应用根部包裹一次。
 */
export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [user, setUserState] = useState<CurrentUser>(() => loadUser());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const setUser = useCallback((u: CurrentUser) => {
    setUserState(u);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  }, []);

  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => taskVisibleForPerspective(t, user.perspective));
  }, [tasks, user.perspective]);

  const addTask = useCallback(
    (
      input: Omit<Task, "id" | "code" | "createdAt"> & {
        code?: string;
      },
    ): Task => {
      const id = `t_${Date.now()}`;
      const deptKey = (input.department?.trim() || "集").slice(0, 2);
      const execKey = (input.executingDepartment?.trim() || "执").slice(0, 2);
      const code =
        input.code ?? `QF-${deptKey}-${execKey}-${String(tasks.length + 1).padStart(3, "0")}`;
      const row: Task = {
        ...input,
        id,
        code,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      setTasks((prev) => [row, ...prev]);
      return row;
    },
    [tasks.length],
  );

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleFollow = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, followedByUser: !t.followedByUser } : t)),
    );
  }, []);

  const value = useMemo(
    () => ({
      tasks,
      visibleTasks,
      user,
      setUser,
      addTask,
      updateTask,
      removeTask,
      toggleFollow,
    }),
    [
      tasks,
      visibleTasks,
      user,
      setUser,
      addTask,
      updateTask,
      removeTask,
      toggleFollow,
    ],
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTasks must be used within TaskProvider");
  return ctx;
}

export const CATEGORIES: TaskCategory[] = ["安全生产", "技改项目", "质量与环保"];
export const STATUSES: TaskStatus[] = ["进行中", "已完成", "实质性进展"];
