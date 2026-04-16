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
import type { CurrentUser, Task, TaskCategory, TaskStatus, UserRole } from "../types/task";

const STORAGE_KEY = "qifeng_smart_tasks_v1";
const USER_KEY = "qifeng_smart_tasks_user_v1";

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEED_TASKS;
    const parsed = JSON.parse(raw) as Task[];
    return Array.isArray(parsed) && parsed.length ? parsed : SEED_TASKS;
  } catch {
    return SEED_TASKS;
  }
}

function loadUser(): CurrentUser {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) return JSON.parse(raw) as CurrentUser;
  } catch {
    /* ignore */
  }
  return {
    role: "chairman",
  };
}

function taskVisibleForUser(task: Task, user: CurrentUser): boolean {
  if (user.role === "chairman") return true;
  if (user.role === "functional") {
    return user.department ? task.department === user.department : true;
  }
  if (user.role === "branch") {
    return user.branch ? task.branch === user.branch : true;
  }
  if (user.role === "workshop") {
    if (!user.branch || !user.workshop) return false;
    return task.branch === user.branch && task.workshop === user.workshop;
  }
  return true;
}

interface TaskContextValue {
  tasks: Task[];
  visibleTasks: Task[];
  user: CurrentUser;
  setUser: (u: CurrentUser) => void;
  scopeFilter: string;
  setScopeFilter: (s: string) => void;
  addTask: (input: Omit<Task, "id" | "code" | "createdAt"> & { code?: string }) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  removeTask: (id: string) => void;
  toggleFollow: (id: string) => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [user, setUserState] = useState<CurrentUser>(() => loadUser());
  const [scopeFilter, setScopeFilter] = useState<string>("all");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const setUser = useCallback((u: CurrentUser) => {
    setUserState(u);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  }, []);

  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (!taskVisibleForUser(t, user)) return false;
      if (scopeFilter === "all") return true;
      if (scopeFilter === "group") return t.workshop === null;
      if (scopeFilter.startsWith("branch:")) {
        const b = scopeFilter.slice("branch:".length);
        return t.branch === b;
      }
      if (scopeFilter.startsWith("workshop:")) {
        const [, branch, workshop] = scopeFilter.split(":");
        return t.branch === branch && t.workshop === workshop;
      }
      return true;
    });
  }, [tasks, user, scopeFilter]);

  const addTask = useCallback(
    (
      input: Omit<Task, "id" | "code" | "createdAt"> & {
        code?: string;
      },
    ) => {
      const id = `t_${Date.now()}`;
      const code =
        input.code ??
        `QF-${input.branch.slice(0, 2)}-${(input.workshop ?? "本部").slice(0, 2)}-${String(tasks.length + 1).padStart(3, "0")}`;
      const row: Task = {
        ...input,
        id,
        code,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      setTasks((prev) => [row, ...prev]);
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
      scopeFilter,
      setScopeFilter,
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
      scopeFilter,
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

export const ROLE_LABELS: Record<UserRole, string> = {
  chairman: "董事长 / 集团领导",
  functional: "职能部门",
  branch: "分公司负责人",
  workshop: "车间负责人",
};

export const BRANCHES = ["淄博本部", "广西齐峰"] as const;
export const WORKSHOPS_BY_BRANCH: Record<string, string[]> = {
  淄博本部: ["造纸一车间", "造纸二车间", "造纸三车间", "辅料仓库", "环保工段"],
  广西齐峰: ["造纸一车间", "造纸二车间", "环保工段"],
};

export const CATEGORIES: TaskCategory[] = ["安全生产", "技改项目", "质量与环保"];
export const STATUSES: TaskStatus[] = ["进行中", "已完成", "实质性进展"];
