/**
 * @fileoverview 任务列表与当前用户「视角」的 React Context：本地持久化、按领导视角与范围筛选可见任务。
 *
 * **设计要点**
 * - `CurrentUser.perspective`：`集团领导` 或配置架构中的 `{名称}领导`。
 * - 任务可见性见 `taskVisibleForPerspective`；报告提取历史见 `extractionHistoryVisibleForPerspective`。
 * - `scopeFilter`：`all` | `group` | `branch:名称` | `workshop:分公司:车间`，在已通过视角过滤的 `tasks` 上再筛一层。
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
import { GROUP_LEADER_PERSPECTIVE, taskVisibleForPerspective } from "../utils/leaderPerspective";
import type { CurrentUser, Task, TaskCategory, TaskStatus } from "../types/task";

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
  scopeFilter: string;
  setScopeFilter: (s: string) => void;
  addTask: (input: Omit<Task, "id" | "code" | "createdAt"> & { code?: string }) => void;
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
      if (!taskVisibleForPerspective(t, user.perspective)) return false;
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
  }, [tasks, user.perspective, scopeFilter]);

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

/** 看板组织范围下拉的默认车间（配置中未单独维护车间清单时使用） */
export const DEFAULT_WORKSHOPS_FOR_SCOPE = [
  "造纸一车间",
  "造纸二车间",
  "造纸三车间",
  "辅料仓库",
  "环保工段",
];

export const WORKSHOPS_BY_BRANCH: Record<string, string[]> = {
  淄博本部: ["造纸一车间", "造纸二车间", "造纸三车间", "辅料仓库", "环保工段"],
  广西齐峰: ["造纸一车间", "造纸二车间", "环保工段"],
  广西分公司: ["造纸一车间", "造纸二车间", "环保工段"],
  华林分公司: ["造纸一车间", "造纸二车间", "造纸三车间", "辅料仓库", "环保工段"],
  欧华分公司: ["造纸一车间", "造纸二车间", "造纸三车间", "辅料仓库", "环保工段"],
  欧木分公司: ["造纸一车间", "造纸二车间", "造纸三车间", "辅料仓库", "环保工段"],
  卫材分公司: ["造纸一车间", "造纸二车间", "环保工段"],
};

export const CATEGORIES: TaskCategory[] = ["安全生产", "技改项目", "质量与环保"];
export const STATUSES: TaskStatus[] = ["进行中", "已完成", "实质性进展"];
