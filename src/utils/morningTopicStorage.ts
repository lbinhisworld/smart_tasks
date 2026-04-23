/**
 * @fileoverview 晨会议题列表的 localStorage 持久化。
 *
 * @module utils/morningTopicStorage
 */

import type { MorningTopic } from "../types/morningTopic";

const STORAGE_KEY = "qifeng_morning_topics_v1";

function isTopic(x: unknown): x is MorningTopic {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.code === "string" &&
    typeof o.description === "string" &&
    typeof o.category === "string" &&
    Array.isArray(o.participants) &&
    typeof o.discussionDate === "string" &&
    typeof o.createdAt === "string" &&
    typeof o.status === "string" &&
    typeof o.notes === "string" &&
    typeof o.operatorName === "string"
  );
}

/**
 * 读取全部议题，按创建时间降序（同日内按 id）。
 */
export function loadMorningTopics(): MorningTopic[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const list = arr.filter(isTopic);
    const normalized = list.map((t) => ({
      ...t,
      finalConclusion: typeof (t as MorningTopic).finalConclusion === "string" ? (t as MorningTopic).finalConclusion : "",
      reusableExperience:
        typeof (t as MorningTopic).reusableExperience === "string" ? (t as MorningTopic).reusableExperience : "",
    }));
    return normalized.sort((a, b) => {
      const c = b.createdAt.localeCompare(a.createdAt);
      if (c !== 0) return c;
      return b.id.localeCompare(a.id);
    });
  } catch {
    return [];
  }
}

/**
 * 覆盖保存议题列表。
 * @param topics 全量列表
 */
export function saveMorningTopics(topics: MorningTopic[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(topics));
  } catch {
    /* quota */
  }
}

/**
 * 生成展示编号（短码便于口头沟通）。
 */
export function buildMorningTopicCode(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6);
  return `YT-${y}${m}${day}-${rand}`;
}
