/**
 * 按「周期性标签」首行是否「不规则」筛掉客户维树下各级节点，用于「隐藏不规则模式」。
 */

import type {
  CustomerInboundGrammageRow,
  CustomerInboundModelRow,
  CustomerInboundNameRow,
  CustomerInboundSpecRow,
} from "./buildCustomerInboundDimensionFromAnalysis";

function mainPeriodicityLine(periodicityLabel: string): string {
  return (periodicityLabel ?? "").trim().split("\n")[0]?.trim() ?? "";
}

export function isIrregularPatternPeriodicity(periodicityLabel: string): boolean {
  return mainPeriodicityLine(periodicityLabel) === "不规则";
}

function filterGrammages(
  grammages: readonly CustomerInboundGrammageRow[],
  hide: boolean,
): CustomerInboundGrammageRow[] {
  if (!hide) return grammages as unknown as CustomerInboundGrammageRow[];
  return grammages.filter((g) => !isIrregularPatternPeriodicity(g.periodicityLabel));
}

function filterSpecs(
  specs: readonly CustomerInboundSpecRow[],
  hide: boolean,
): CustomerInboundSpecRow[] {
  if (!hide) return specs as unknown as CustomerInboundSpecRow[];
  return specs
    .filter((s) => !isIrregularPatternPeriodicity(s.periodicityLabel))
    .map((s) => ({ ...s, grammages: filterGrammages(s.grammages, hide) }));
}

function filterNames(
  names: readonly CustomerInboundNameRow[],
  hide: boolean,
): CustomerInboundNameRow[] {
  if (!hide) return names as unknown as CustomerInboundNameRow[];
  return names
    .filter((n) => !isIrregularPatternPeriodicity(n.periodicityLabel))
    .map((n) => ({ ...n, specs: filterSpecs(n.specs, hide) }));
}

function filterModels(
  models: readonly CustomerInboundModelRow[],
  hide: boolean,
): CustomerInboundModelRow[] {
  if (!hide) return models as unknown as CustomerInboundModelRow[];
  return models
    .filter((m) => !isIrregularPatternPeriodicity(m.periodicityLabel))
    .map((m) => ({ ...m, names: filterNames(m.names, hide) }));
}

/**
 * 在 `hide` 为真时，去掉首行为「不规则」的型号/品名/规格/克重节点。为假时原样返回同一引用，避免无意义拷贝。
 */
export function filterCustomerModelsForHideIrregular(
  models: readonly CustomerInboundModelRow[],
  hide: boolean,
): CustomerInboundModelRow[] {
  if (!hide) {
    return models as unknown as CustomerInboundModelRow[];
  }
  return filterModels(models, true);
}
