/**
 * @fileoverview 将「需公司协调 + 下步计划」正文拆成多条待交办条目（JSON），再交由既有流水线生成任务。
 */

import { callLlmChatJsonObject, parseJsonSafe, type LlmEnv } from "./llmExtract";

const SYSTEM = `你是造纸企业的「日报计划」拆解助手。用户会提供某分公司日报中与「需公司协调」「下步计划」相关的文字节选。
请将其拆成若干条独立的、可交办的任务请求。

规则：
- 每条须具体可执行，用完整中文描述；
- initiatingDepartment：发起方，一般为输入中的分公司名称；若正文明确其它发起单位则跟随文意；
- executingDepartment：主要承办/落实单位（职能部门或分公司、车间）；若仅为本公司内部下步工作，可填分公司名或具体部门/车间；
- requestDescription：该条目的完整说明，体现协调诉求或计划动作；可合并同一主题的细则为一条；
- 若节选实质为空或仅为「暂无」，不要编造，可返回空数组；
- 只输出一个 JSON 对象，唯一键为 items，值为数组；元素形如 {"initiatingDepartment":"","executingDepartment":"","requestDescription":""}；
- 不要 markdown，不要其它顶层键。`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface RawDailyPlanSplitItem {
  initiatingDepartment: string;
  executingDepartment: string;
  requestDescription: string;
}

const MAX_BLOCK = 14_000;

export async function llmSplitDailyPlanItemsFromSections(
  env: LlmEnv,
  args: {
    companyName: string;
    reportDate: string;
    coordinationSection: string;
    nextPlanSection: string;
  },
): Promise<RawDailyPlanSplitItem[]> {
  const co = args.coordinationSection.trim();
  const pl = args.nextPlanSection.trim();
  if (!co && !pl) return [];
  const coT = co.length > MAX_BLOCK ? co.slice(0, MAX_BLOCK) : co;
  const plT = pl.length > MAX_BLOCK ? pl.slice(0, MAX_BLOCK) : pl;
  const user = `分公司名称：${args.companyName}
日报日期（YYYY-MM-DD，将作为任务发起日期）：${args.reportDate}

【需公司协调 相关正文】
${coT || "（本节无摘录）"}

【下步计划 相关正文】
${plT || "（本节无摘录）"}

请输出 items。若无任何可交办事项，返回 {"items":[]}。`;

  const res = await callLlmChatJsonObject(env, SYSTEM, user);
  let root: unknown;
  try {
    root = parseJsonSafe(res.content);
  } catch {
    return [];
  }
  if (!isRecord(root)) return [];
  const items = root.items;
  if (!Array.isArray(items)) return [];
  const out: RawDailyPlanSplitItem[] = [];
  for (const el of items) {
    if (!isRecord(el)) continue;
    const a = el.initiatingDepartment;
    const b = el.executingDepartment;
    const c = el.requestDescription;
    if (typeof c !== "string" || !c.trim()) continue;
    out.push({
      initiatingDepartment: typeof a === "string" && a.trim() ? a.trim() : args.companyName,
      executingDepartment: typeof b === "string" && b.trim() ? b.trim() : args.companyName,
      requestDescription: c.trim().replace(/\s+/g, " "),
    });
  }
  return out;
}
