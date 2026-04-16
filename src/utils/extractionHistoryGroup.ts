import type { ExtractionHistoryItem } from "../types/extractionHistory";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 从记录中读取「提取日期」YYYY-MM-DD，缺省用保存时间日期 */
export function pickExtractionDate(item: ExtractionHistoryItem): string {
  const from = (o: Record<string, unknown>) => {
    const d = o["提取日期"];
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim();
    return null;
  };
  if (item.parsedJson != null && isRecord(item.parsedJson)) {
    const x = from(item.parsedJson);
    if (x) return x;
  }
  try {
    const o = JSON.parse(item.rawModelResponse) as unknown;
    if (isRecord(o)) {
      const x = from(o);
      if (x) return x;
    }
  } catch {
    /* ignore */
  }
  return item.savedAt.slice(0, 10);
}

/** 从记录中读取「分公司名称」 */
export function pickBranchCompany(item: ExtractionHistoryItem): string {
  const from = (o: Record<string, unknown>) => {
    const b = o["分公司名称"];
    if (typeof b === "string" && b.trim()) return b.trim().replace(/[/\\]/g, "·");
    return "暂无";
  };
  if (item.parsedJson != null && isRecord(item.parsedJson)) {
    return from(item.parsedJson);
  }
  try {
    const o = JSON.parse(item.rawModelResponse) as unknown;
    if (isRecord(o)) return from(o);
  } catch {
    /* ignore */
  }
  return "暂无";
}

export interface TimelineDateGroup {
  date: string;
  /** 该日期下全部记录（按保存时间降序） */
  items: ExtractionHistoryItem[];
  totalItems: number;
  /** 该日期下去重后的分公司数量（仅用于摘要，不单独展示标签） */
  branchCount: number;
}

/** 按提取日期降序；同一日期内记录按保存时间降序；摘要统计涉及的分公司个数 */
export function buildTimelineGroups(items: ExtractionHistoryItem[]): TimelineDateGroup[] {
  const byDate = new Map<string, ExtractionHistoryItem[]>();
  for (const item of items) {
    const d = pickExtractionDate(item);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(item);
  }

  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

  return dates.map((date) => {
    const list = byDate.get(date)!;
    list.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    const branchSet = new Set(list.map((it) => pickBranchCompany(it)));
    return {
      date,
      items: list,
      totalItems: list.length,
      branchCount: branchSet.size,
    };
  });
}
