/**
 * 报告看板「当日视角」日期选择：自定义月历弹层，便于将「有提取历史数据的日期」标为绿色（原生 input[type=date] 无法定制日历格样式）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toIsoDate(y: number, month1to12: number, day: number) {
  return `${y}-${pad2(month1to12)}-${pad2(day)}`;
}

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return null;
  return { y, m: mo, d };
}

function buildMonthCells(year: number, monthIndex0: number): ({ iso: string } | null)[] {
  const first = new Date(year, monthIndex0, 1);
  const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
  const startPad = (first.getDay() + 6) % 7;
  const cells: ({ iso: string } | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let day = 1; day <= lastDay; day++) {
    cells.push({ iso: toIsoDate(year, monthIndex0 + 1, day) });
  }
  return cells;
}

type ViewMonth = { y: number; m0: number };

export function ReportDashboardDateField(props: {
  value: string;
  onChange: (iso: string) => void;
  datesWithData: string[];
}) {
  const { value, onChange, datesWithData } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<ViewMonth>(() => {
    const p = parseIso(value);
    if (p) return { y: p.y, m0: p.m - 1 };
    const t = new Date();
    return { y: t.getFullYear(), m0: t.getMonth() };
  });

  const dataSet = useMemo(() => new Set(datesWithData), [datesWithData]);

  const syncMonthFromValue = useCallback(() => {
    const p = parseIso(value);
    if (p) setViewMonth({ y: p.y, m0: p.m - 1 });
    else {
      const t = new Date();
      setViewMonth({ y: t.getFullYear(), m0: t.getMonth() });
    }
  }, [value]);

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) syncMonthFromValue();
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = useMemo(
    () => buildMonthCells(viewMonth.y, viewMonth.m0),
    [viewMonth.y, viewMonth.m0],
  );

  const monthLabel = `${viewMonth.y}年${viewMonth.m0 + 1}月`;

  const goPrevMonth = () => {
    setViewMonth((vm) => {
      if (vm.m0 === 0) return { y: vm.y - 1, m0: 11 };
      return { y: vm.y, m0: vm.m0 - 1 };
    });
  };

  const goNextMonth = () => {
    setViewMonth((vm) => {
      if (vm.m0 === 11) return { y: vm.y + 1, m0: 0 };
      return { y: vm.y, m0: vm.m0 + 1 };
    });
  };

  const todayIso = useMemo(() => {
    const t = new Date();
    return toIsoDate(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }, []);

  return (
    <div className="report-dash-date-field" ref={rootRef}>
      <button
        type="button"
        className="fld report-dash-date-input report-dash-date-field-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`选择提取日期，当前 ${value}`}
        onClick={toggleOpen}
      >
        {value}
      </button>
      {open && (
        <div
          className="report-dash-cal-popover"
          role="dialog"
          aria-label="选择提取日期"
        >
          <div className="report-dash-cal-nav">
            <button type="button" className="report-dash-cal-nav-btn" onClick={goPrevMonth} aria-label="上一月">
              ‹
            </button>
            <span className="report-dash-cal-month-label">{monthLabel}</span>
            <button type="button" className="report-dash-cal-nav-btn" onClick={goNextMonth} aria-label="下一月">
              ›
            </button>
          </div>
          <div className="report-dash-cal-weekdays" aria-hidden>
            {WEEKDAYS.map((w) => (
              <span key={w} className="report-dash-cal-weekday">
                {w}
              </span>
            ))}
          </div>
          <div className="report-dash-cal-grid">
            {cells.map((cell, idx) => {
              if (!cell) {
                return <span key={`e-${idx}`} className="report-dash-cal-cell report-dash-cal-cell--empty" />;
              }
              const { iso } = cell;
              const hasData = dataSet.has(iso);
              const selected = iso === value;
              const isToday = iso === todayIso;
              return (
                <button
                  key={iso}
                  type="button"
                  className={[
                    "report-dash-cal-day",
                    hasData ? "report-dash-cal-day--has-data" : "",
                    selected ? "report-dash-cal-day--selected" : "",
                    isToday ? "report-dash-cal-day--today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={hasData ? "该日有已保存的日报提取记录" : undefined}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                >
                  {Number(iso.slice(8, 10))}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
