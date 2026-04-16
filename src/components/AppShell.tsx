import type { ReactNode } from "react";
import { useTasks, ROLE_LABELS } from "../context/TaskContext";
import type { UserRole } from "../types/task";

const DEPTS = [
  "集团办公室",
  "安全环保部",
  "设备工程部",
  "技术中心",
  "质量管理部",
  "生产管理部",
];

const BRANCHES_LIST = ["淄博本部", "广西齐峰"] as const;

export function AppShell({
  children,
  active,
  onNav,
}: {
  children: ReactNode;
  active: "board" | "tasks";
  onNav: (p: "board" | "tasks") => void;
}) {
  const { user, setUser } = useTasks();

  return (
    <div className="shell">
      <header className="top-header">
        <div className="brand">
          <div className="logo-mark">齐峰</div>
          <div>
            <div className="brand-title">齐峰新材 · 重点任务管理系统</div>
            <div className="brand-sub">立体贯通：集团 — 职能部门 — 分公司 — 车间</div>
          </div>
        </div>
        <div className="slogan">夯实基础 · 提质增效 · 安全绿色高质量发展</div>
        <nav className="main-nav">
          <button
            type="button"
            className={active === "board" ? "nav-btn active" : "nav-btn"}
            onClick={() => onNav("board")}
          >
            数据看板
          </button>
          <button
            type="button"
            className={active === "tasks" ? "nav-btn active" : "nav-btn"}
            onClick={() => onNav("tasks")}
          >
            任务管理
          </button>
        </nav>
      </header>

      <div className="role-bar">
        <span className="role-label">当前视角</span>
        <select
          className="role-select"
          value={user.role}
          onChange={(e) => {
            const role = e.target.value as UserRole;
            if (role === "chairman") setUser({ role });
            if (role === "functional") setUser({ role, department: DEPTS[0] });
            if (role === "branch") setUser({ role, branch: BRANCHES_LIST[0] });
            if (role === "workshop")
              setUser({
                role,
                branch: BRANCHES_LIST[0],
                workshop: "造纸一车间",
              });
          }}
        >
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>

        {user.role === "functional" && (
          <select
            className="role-select"
            value={user.department ?? DEPTS[0]}
            onChange={(e) => setUser({ ...user, department: e.target.value })}
          >
            {DEPTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}

        {user.role === "branch" && (
          <select
            className="role-select"
            value={user.branch ?? BRANCHES_LIST[0]}
            onChange={(e) => setUser({ ...user, branch: e.target.value })}
          >
            {BRANCHES_LIST.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}

        {user.role === "workshop" && (
          <>
            <select
              className="role-select"
              value={user.branch ?? BRANCHES_LIST[0]}
              onChange={(e) =>
                setUser({
                  ...user,
                  branch: e.target.value,
                  workshop: "造纸一车间",
                })
              }
            >
              {BRANCHES_LIST.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <select
              className="role-select"
              value={user.workshop ?? "造纸一车间"}
              onChange={(e) => setUser({ ...user, workshop: e.target.value })}
            >
              {(user.branch === "广西齐峰"
                ? ["造纸一车间", "造纸二车间", "环保工段"]
                : ["造纸一车间", "造纸二车间", "造纸三车间", "辅料仓库", "环保工段"]
              ).map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <main className="main-area">{children}</main>
    </div>
  );
}
