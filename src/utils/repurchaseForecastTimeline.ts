/**
 * 数据看板「复购预测」：从销售预测持久化数据抽取进货周期模式块的「预计下次下单日期」，
 * 按日期由近及远分组，供时间线展示（与 SalesForecast 进货模式挖掘同源）。
 */

import type { InboundPeriodicityPatternItem } from "./inboundPeriodicityPatternMining";
import { listInboundPeriodicityPatterns } from "./inboundPeriodicityPatternMining";
import type { StrongPatternNextQtyPrediction } from "./inboundStrongPatternNextQtyPrediction";
import type { WeakPatternNextQtyPrediction } from "./inboundWeakPatternNextQtyPrediction";
import { loadSalesForecastPersisted } from "./salesForecastStorage";

export type RepurchaseStrength = "strong" | "weak";

export type RepurchaseTimelineCardModel = {
  key: string;
  strength: RepurchaseStrength;
  item: InboundPeriodicityPatternItem;
  strongPred: StrongPatternNextQtyPrediction | null;
  weakPred: WeakPatternNextQtyPrediction | null;
  /** 已格式化的预计采购量文案（含单位或失败原因） */
  qtyDisplay: string;
};

export type RepurchaseTimelineBucketModel = {
  /** 当日 0 点本地时间戳，用于排序 */
  sortMs: number;
  /** 展示用日期（归一化 YYYY-MM-DD 或原始） */
  dateLabel: string;
  /** 该日下强周期卡片成功预测的 `predictedQty` 之和（吨） */
  strongForecastQtySumTon: number;
  /** 该日下弱周期 interval 型卡片的 `minVolume` 之和（吨）；mode 型无 minVolume，不计入。 */
  weakForecastMinVolumeSumTon: number;
  cards: RepurchaseTimelineCardModel[];
};

export type RepurchaseForecastTimelineResult =
  | { ok: false; reason: string }
  | { ok: true; buckets: RepurchaseTimelineBucketModel[] };

function inboundPatternListSignatureFromItems(patterns: InboundPeriodicityPatternItem[]): string {
  return patterns
    .map((p) => `${p.key}:${p.purchaseTimeline.map((n) => `${n.date}|${n.quantity}`).join(";")}`)
    .join("§");
}

function splitInboundPatternsStrongWeak(all: InboundPeriodicityPatternItem[]) {
  const strong: InboundPeriodicityPatternItem[] = [];
  const weak: InboundPeriodicityPatternItem[] = [];
  for (const p of all) {
    const first = p.periodicityLabel.trim().split("\n")[0]?.trim();
    if (first === "强周期性") strong.push(p);
    else if (first === "弱周期性") weak.push(p);
  }
  return { strong, weak };
}

function parseNextOrderDateMs(s: string): number | null {
  const t = (s ?? "").trim();
  if (!t || t === "—" || t === "-") return null;
  const slash = t.replace(/\//g, "-");
  let n = Date.parse(slash);
  if (!Number.isNaN(n)) return n;
  const m = t.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    n = Date.parse(`${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function localDayStartMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatYmdLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function weakMinVolumeForAggregateTon(pred: WeakPatternNextQtyPrediction | null): number | null {
  if (!pred || !pred.ok || pred.kind !== "interval") return null;
  return pred.minVolume;
}

function sumBucketForecastTons(cards: RepurchaseTimelineCardModel[]): {
  strongForecastQtySumTon: number;
  weakForecastMinVolumeSumTon: number;
} {
  let strongSum = 0;
  let weakSum = 0;
  for (const c of cards) {
    if (c.strength === "strong" && c.strongPred?.ok) {
      strongSum += c.strongPred.predictedQty;
    }
    if (c.strength === "weak") {
      const w = weakMinVolumeForAggregateTon(c.weakPred);
      if (w !== null) weakSum += w;
    }
  }
  return { strongForecastQtySumTon: strongSum, weakForecastMinVolumeSumTon: weakSum };
}

function formatQtyDisplay(
  strength: RepurchaseStrength,
  strongPred: StrongPatternNextQtyPrediction | null,
  weakPred: WeakPatternNextQtyPrediction | null,
): string {
  if (strength === "strong") {
    if (!strongPred) return "—（请在销售预测中运行强周期「预测下一次下单量」）";
    if (strongPred.ok) return `${strongPred.predictedQty.toFixed(2)} 吨`;
    return `— ${strongPred.reason}`;
  }
  if (!weakPred) return "—（请在销售预测中运行弱周期「预测下一次下单量」）";
  if (weakPred.ok) {
    if (weakPred.kind === "mode") return `${weakPred.predictedQty.toFixed(2)} 吨`;
    return `${weakPred.minVolume.toFixed(2)} ～ ${weakPred.maxVolume.toFixed(2)} 吨`;
  }
  return `— ${weakPred.reason}`;
}

function hydratePredictions(stored: NonNullable<ReturnType<typeof loadSalesForecastPersisted>>): {
  strong: Record<string, StrongPatternNextQtyPrediction>;
  weak: Record<string, WeakPatternNextQtyPrediction>;
} {
  const dim = stored.customerInboundDimension;
  const rows = stored.analysisBase?.rows;
  if (!dim?.length || !rows?.length || !stored.periodicityLabelsComputeCompleted) {
    return { strong: {}, weak: {} };
  }
  const all = listInboundPeriodicityPatterns(dim, rows);
  const { strong, weak } = splitInboundPatternsStrongWeak(all);
  const sigStrong = inboundPatternListSignatureFromItems(strong);
  const sigWeak = inboundPatternListSignatureFromItems(weak);
  const strongPred =
    stored.strongPatternNextQtyListSignature === sigStrong ? stored.strongPatternNextQtyPredictions : {};
  const weakPred =
    stored.weakPatternNextQtyListSignature === sigWeak ? stored.weakPatternNextQtyPredictions : {};
  return { strong: strongPred, weak: weakPred };
}

/**
 * 读取当前 localStorage 中的销售预测数据，构建复购时间线（仅含可解析「预计下次下单日期」的模式块）。
 */
export function buildRepurchaseForecastTimeline(): RepurchaseForecastTimelineResult {
  const stored = loadSalesForecastPersisted();
  if (!stored) {
    return { ok: false, reason: "暂无销售预测持久化数据。请在「销售预测」中完成分析并保存。" };
  }
  const dim = stored.customerInboundDimension;
  const rows = stored.analysisBase?.rows;
  if (!dim?.length || !rows?.length) {
    return { ok: false, reason: "销售预测中尚无客户进货树与底表。请先完成拆解与进货周期性分析。" };
  }
  if (!stored.periodicityLabelsComputeCompleted) {
    return { ok: false, reason: "请先在「销售预测」中完成「生成周期性标签」，再查看复购预测。" };
  }

  const all = listInboundPeriodicityPatterns(dim, rows);
  const { strong: strongPredMap, weak: weakPredMap } = hydratePredictions(stored);

  const bucketMap = new Map<number, RepurchaseTimelineCardModel[]>();

  for (const item of all) {
    const first = item.periodicityLabel.trim().split("\n")[0]?.trim();
    const strength: RepurchaseStrength | null =
      first === "强周期性" ? "strong" : first === "弱周期性" ? "weak" : null;
    if (!strength) continue;

    const ms = parseNextOrderDateMs(item.nextOrderDate);
    if (ms === null) continue;

    const dayStart = localDayStartMs(ms);
    const strongPred = strength === "strong" ? (strongPredMap[item.key] ?? null) : null;
    const weakPred = strength === "weak" ? (weakPredMap[item.key] ?? null) : null;
    const card: RepurchaseTimelineCardModel = {
      key: item.key,
      strength,
      item,
      strongPred,
      weakPred,
      qtyDisplay: formatQtyDisplay(strength, strongPred, weakPred),
    };
    const list = bucketMap.get(dayStart) ?? [];
    list.push(card);
    bucketMap.set(dayStart, list);
  }

  if (bucketMap.size === 0) {
    return { ok: false, reason: "当前没有可解析「预计下次下单日期」的强/弱周期模式；请检查销售预测进货模式挖掘数据。" };
  }

  const buckets: RepurchaseTimelineBucketModel[] = [...bucketMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([sortMs, cards]) => {
      const sorted = cards.sort((c, d) => {
        const cn = c.item.customerName.localeCompare(d.item.customerName, "zh");
        if (cn !== 0) return cn;
        return c.key.localeCompare(d.key);
      });
      const { strongForecastQtySumTon, weakForecastMinVolumeSumTon } = sumBucketForecastTons(sorted);
      return {
        sortMs,
        dateLabel: formatYmdLocal(sortMs),
        strongForecastQtySumTon,
        weakForecastMinVolumeSumTon,
        cards: sorted,
      };
    });

  return { ok: true, buckets };
}
