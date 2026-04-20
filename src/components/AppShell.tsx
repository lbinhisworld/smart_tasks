import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTasks } from "../context/TaskContext";
import { buildPerspectiveOptions } from "../utils/leaderPerspective";
import { getOrgStructureLines, ORG_STRUCTURE_CHANGED_EVENT } from "../utils/orgStructureStorage";
import { AppConfigModal } from "./AppConfigModal";

export function AppShell({
  children,
  active,
  onNav,
}: {
  children: ReactNode;
  active: "board" | "reports" | "tasks" | "sync";
  onNav: (p: "board" | "reports" | "tasks" | "sync") => void;
}) {
  const { user, setUser } = useTasks();
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [orgEpoch, setOrgEpoch] = useState(0);

  const perspectiveOptions = useMemo(() => {
    return buildPerspectiveOptions(getOrgStructureLines());
  }, [orgEpoch]);

  useEffect(() => {
    const bump = () => setOrgEpoch((n) => n + 1);
    window.addEventListener(ORG_STRUCTURE_CHANGED_EVENT, bump);
    return () => window.removeEventListener(ORG_STRUCTURE_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (perspectiveOptions.length === 0) return;
    if (!perspectiveOptions.includes(user.perspective)) {
      setUser({ perspective: perspectiveOptions[0] });
    }
  }, [perspectiveOptions, user.perspective, setUser]);

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
        <div className="slogan">长久的环保.长久的企业</div>
        <nav className="main-nav">
          <button
            type="button"
            className="nav-btn nav-config nav-config-icon"
            onClick={() => setConfigModalOpen(true)}
            title="打开系统配置（大模型 Key、部门架构）"
            aria-label="打开系统配置"
          >
            <svg
              className="nav-config-gear"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              width="20"
              height="20"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.292.24-.437.613-.43.992a6.723 6.723 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.634 6.634 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.213-1.281Z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0Z" />
            </svg>
          </button>
          <button
            type="button"
            className={active === "board" ? "nav-btn active" : "nav-btn"}
            onClick={() => onNav("board")}
          >
            数据看板
          </button>
          <button
            type="button"
            className={active === "reports" ? "nav-btn active" : "nav-btn"}
            onClick={() => onNav("reports")}
          >
            报告管理
          </button>
          <button
            type="button"
            className={active === "tasks" ? "nav-btn active" : "nav-btn"}
            onClick={() => onNav("tasks")}
          >
            任务管理
          </button>
          <button
            type="button"
            className={active === "sync" ? "nav-btn active" : "nav-btn"}
            onClick={() => onNav("sync")}
          >
            数据中台
          </button>
        </nav>
      </header>

      <AppConfigModal open={configModalOpen} onClose={() => setConfigModalOpen(false)} />

      <div className="role-bar">
        <span className="role-label">当前视角</span>
        <select
          className="role-select role-select--perspective"
          value={
            perspectiveOptions.includes(user.perspective)
              ? user.perspective
              : perspectiveOptions[0] ?? ""
          }
          onChange={(e) => setUser({ perspective: e.target.value })}
          aria-label="当前视角"
          disabled={perspectiveOptions.length === 0}
        >
          {perspectiveOptions.length === 0 ? (
            <option value="">请在系统配置中维护部门架构</option>
          ) : (
            perspectiveOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))
          )}
        </select>
        <span className="muted tiny role-bar-hint">
          选项与系统配置中的部门架构一致。切换视角后，任务与报告的可见范围随发起部门、执行部门、分公司归属及接收方变化。
        </span>
      </div>

      <main className="main-area">{children}</main>
    </div>
  );
}
