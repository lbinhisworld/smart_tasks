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
import {
  coerceTaskCategoryPair,
  getDefaultCategoryPair,
  LEGACY_FLAT_CATEGORY_MAP,
} from "../data/taskCategories";
import { SEED_TASKS } from "../data/seedTasks";
import {
  GROUP_LEADER_PERSPECTIVE,
  isBranchCompanyUnit,
  taskVisibleForPerspective,
} from "../utils/leaderPerspective";
import { loadExtractionHistory } from "../utils/extractionHistoryStorage";
import { rebuildReportDynamicMemoryFromHistory } from "../utils/reportDynamicMemory";
import { syncTaskDynamicMemoryFromTasks } from "../utils/taskDynamicMemory";
import { buildAutoTaskCode } from "../utils/taskCode";
import {
  type CurrentUser,
  normalizeTaskStatusField,
  type Task,
  type TaskProgressEntry,
  type TaskStatus,
} from "../types/task";
import { reconcileTaskStatusByDueDate } from "../utils/taskDueDate";
import { schedulePushNewTaskToSmartsheet } from "../utils/smartsheetTaskPush";

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

function normalizeTaskCategories(raw: Task & { category?: string }): {
  categoryLevel1: string;
  categoryLevel2: string;
} {
  const any = raw as Task & { category?: string; categoryLevel1?: string; categoryLevel2?: string };
  const l1 = any.categoryLevel1?.trim() ?? "";
  const l2 = any.categoryLevel2?.trim() ?? "";
  if (l1 && l2) return coerceTaskCategoryPair(l1, l2);
  const leg = any.category?.trim();
  if (leg && LEGACY_FLAT_CATEGORY_MAP[leg]) {
    const m = LEGACY_FLAT_CATEGORY_MAP[leg];
    return coerceTaskCategoryPair(m.categoryLevel1, m.categoryLevel2);
  }
  if (l1 || l2) return coerceTaskCategoryPair(l1, l2);
  return getDefaultCategoryPair();
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
  const row = t as Task & { category?: string };
  const {
    category: _legacyCategory,
    coordinationParty: _cpIn,
    leaderInstruction: _liIn,
    ...rest
  } = row;
  const cats = normalizeTaskCategories(row);
  const status = normalizeTaskStatusField(row.status);
  const cpRaw =
    typeof (row as { coordinationParty?: unknown }).coordinationParty === "string"
      ? (row as { coordinationParty: string }).coordinationParty.trim()
      : "";
  const coordinationParty = status === "卡住待协调" && cpRaw ? cpRaw : undefined;
  const leaderInstruction =
    typeof _liIn === "string" && _liIn.trim() ? _liIn.trim() : undefined;

  const smartsheetPushStatus = row.smartsheetPushStatus;
  const smartsheetPushError = row.smartsheetPushError;

  return reconcileTaskStatusByDueDate({
    ...rest,
    executingDepartment: execRaw,
    branch,
    workshop,
    taskMotivation,
    status,
    categoryLevel1: cats.categoryLevel1,
    categoryLevel2: cats.categoryLevel2,
    ...(coordinationParty ? { coordinationParty } : {}),
    ...(leaderInstruction ? { leaderInstruction } : {}),
    ...(progressTracking ? { progressTracking } : {}),
    ...(smartsheetPushStatus ? { smartsheetPushStatus } : {}),
    ...(smartsheetPushError ? { smartsheetPushError } : {}),
  });
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

  useEffect(() => {
    syncTaskDynamicMemoryFromTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    rebuildReportDynamicMemoryFromHistory(loadExtractionHistory());
  }, []);

  const setUser = useCallback((u: CurrentUser) => {
    setUserState(u);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  }, []);

  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => taskVisibleForPerspective(t, user.perspective));
  }, [tasks, user.perspective]);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? reconcileTaskStatusByDueDate({ ...t, ...patch }) : t)),
    );
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addTask = useCallback(
    (
      input: Omit<Task, "id" | "code" | "createdAt"> & {
        code?: string;
      },
    ): Task => {
      const id = `t_${Date.now()}`;
      const createdAt = new Date().toISOString().slice(0, 10);
      let row!: Task;
      setTasks((prev) => {
        const code =
          input.code ??
          buildAutoTaskCode(input.department ?? "", input.categoryLevel1 ?? "", prev);
        row = reconcileTaskStatusByDueDate({
          ...input,
          id,
          code,
          createdAt,
        });
        return [row, ...prev];
      });
      schedulePushNewTaskToSmartsheet(row, updateTask);
      return row;
    },
    [updateTask],
  );

  const toggleFollow = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? reconcileTaskStatusByDueDate({ ...t, followedByUser: !t.followedByUser })
          : t,
      ),
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
    [tasks, visibleTasks, user, setUser, addTask, updateTask, removeTask, toggleFollow],
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTasks must be used within TaskProvider");
  return ctx;
}

/** 任务列表状态选项（含由日期自动归并的「已超时」） */
export const STATUSES: TaskStatus[] = [
  "进行中",
  "实质性进展",
  "已超时",
  "卡住待协调",
  "已完成",
];
