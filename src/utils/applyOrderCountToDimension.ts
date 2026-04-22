/**
 * 从销售分析底表为客户进货周期性分析各层计算「下单次数」（行数）并按树形自上而下顺序应用更新。
 */

import type { CustomerInboundDimensionRow } from "./buildCustomerInboundDimensionFromAnalysis";
import {
  dimGrammageKey,
  dimModelKey,
  dimNameKey,
  dimSpecKey,
} from "./buildCustomerInboundDimensionFromAnalysis";
import type { SalesAnalysisBaseRow } from "./salesAnalysisBaseFromPreview";

function normalizeCustomerKey(raw: string): string {
  return (raw ?? "").trim() || "-";
}

function filterRowsForCustomer(
  allRows: readonly SalesAnalysisBaseRow[],
  customerName: string,
): SalesAnalysisBaseRow[] {
  const key = normalizeCustomerKey(customerName);
  return allRows.filter((r) => normalizeCustomerKey(r.customerName) === key);
}

export type OrderCountCellPath =
  | { level: "customer"; customerName: string }
  | { level: "model"; customerName: string; model: string }
  | { level: "name"; customerName: string; model: string; productName: string }
  | { level: "spec"; customerName: string; model: string; productName: string; spec: string }
  | {
      level: "grammage";
      customerName: string;
      model: string;
      productName: string;
      spec: string;
      grammage: string;
    };

function orderCountForGrammagePath(
  allRows: readonly SalesAnalysisBaseRow[],
  path: OrderCountCellPath,
): string {
  if (path.level !== "grammage") return "0";
  const rowsC = filterRowsForCustomer(allRows, path.customerName);
  const rowsM = rowsC.filter((r) => dimModelKey(r) === path.model);
  const rowsN = rowsM.filter((r) => dimNameKey(r) === path.productName);
  const rowsS = rowsN.filter((r) => dimSpecKey(r) === path.spec);
  const rowsG = rowsS.filter((r) => dimGrammageKey(r) === path.grammage);
  return String(rowsG.length);
}

/**
 * 分析树上所有克重格路径：**自上而下**（先客户块顺序，再型号→品名→规格→克重深度优先），与 `CustomerDimensionModelTree` 渲染顺序一致。
 * 「计算订货间隔标准差」第一轮克重步序、与「计算下单次数」第一轮克重步序均据此（与 {@link listGrammageOrderCountStepsFromBase} 一致）。
 */
export function listGrammagePathsInTreeOrder(
  dim: readonly CustomerInboundDimensionRow[],
): Array<Extract<OrderCountCellPath, { level: "grammage" }>> {
  const out: Array<Extract<OrderCountCellPath, { level: "grammage" }>> = [];
  for (const cust of dim) {
    for (const mod of cust.models) {
      for (const nam of mod.names) {
        for (const sp of nam.specs) {
          for (const gr of sp.grammages) {
            out.push({
              level: "grammage",
              customerName: cust.customerName,
              model: mod.model,
              productName: nam.productName,
              spec: sp.spec,
              grammage: gr.grammage,
            });
          }
        }
      }
    }
  }
  return out;
}

function sumOrderCountDisplayStrings(cells: readonly string[]): string {
  let s = 0;
  for (const t of cells) {
    const v = (t ?? "").trim();
    if (v === "" || v === "—" || v === "-") continue;
    const n = parseInt(String(v).replace(/,/g, ""), 10);
    if (Number.isFinite(n)) s += n;
  }
  return String(s);
}

/**
 * 第一轮：仅最底级克重，自销售分析底表按行过滤计数。克重步序为维表树序（同 {@link listGrammagePathsInTreeOrder}）。
 */
export function listGrammageOrderCountStepsFromBase(
  dim: readonly CustomerInboundDimensionRow[],
  allRows: readonly SalesAnalysisBaseRow[],
): { path: OrderCountCellPath; orderCount: string }[] {
  return listGrammagePathsInTreeOrder(dim).map((path) => ({
    path,
    orderCount: orderCountForGrammagePath(allRows, path),
  }));
}

function walkSpecsInTreeOrder(dim: readonly CustomerInboundDimensionRow[]): OrderCountCellPath[] {
  const out: OrderCountCellPath[] = [];
  for (const cust of dim) {
    for (const mod of cust.models) {
      for (const nam of mod.names) {
        for (const sp of nam.specs) {
          out.push({
            level: "spec",
            customerName: cust.customerName,
            model: mod.model,
            productName: nam.productName,
            spec: sp.spec,
          });
        }
      }
    }
  }
  return out;
}

function walkNamesInTreeOrder(dim: readonly CustomerInboundDimensionRow[]): OrderCountCellPath[] {
  const out: OrderCountCellPath[] = [];
  for (const cust of dim) {
    for (const mod of cust.models) {
      for (const nam of mod.names) {
        out.push({
          level: "name",
          customerName: cust.customerName,
          model: mod.model,
          productName: nam.productName,
        });
      }
    }
  }
  return out;
}

function walkModelsInTreeOrder(dim: readonly CustomerInboundDimensionRow[]): OrderCountCellPath[] {
  const out: OrderCountCellPath[] = [];
  for (const cust of dim) {
    for (const mod of cust.models) {
      out.push({ level: "model", customerName: cust.customerName, model: mod.model });
    }
  }
  return out;
}

function walkCustomersInTreeOrder(dim: readonly CustomerInboundDimensionRow[]): OrderCountCellPath[] {
  return dim.map((c) => ({ level: "customer" as const, customerName: c.customerName }));
}

export const listSpecPathsInTreeOrder = walkSpecsInTreeOrder;
export const listNamePathsInTreeOrder = walkNamesInTreeOrder;
export const listModelPathsInTreeOrder = walkModelsInTreeOrder;
export const listCustomerPathsInTreeOrder = walkCustomersInTreeOrder;

/**
 * 在分析树上按路径定位节点，用「直接下层」的下单次数加总，得到本格应写入的值（二–五轮用）。
 * 先完成克重更新后调 spec，再 name → model → customer。
 */
export function orderCountByAggregatingFromChildren(
  dim: readonly CustomerInboundDimensionRow[],
  path: OrderCountCellPath,
): string {
  switch (path.level) {
    case "grammage":
      return "0";
    case "spec": {
      for (const c of dim) {
        if (c.customerName !== path.customerName) continue;
        for (const m of c.models) {
          if (m.model !== path.model) continue;
          for (const n of m.names) {
            if (n.productName !== path.productName) continue;
            const sp = n.specs.find((s) => s.spec === path.spec);
            if (sp) return sumOrderCountDisplayStrings(sp.grammages.map((g) => g.orderCount));
          }
        }
      }
      return "0";
    }
    case "name": {
      for (const c of dim) {
        if (c.customerName !== path.customerName) continue;
        for (const m of c.models) {
          if (m.model !== path.model) continue;
          const nam = m.names.find((n) => n.productName === path.productName);
          if (nam) return sumOrderCountDisplayStrings(nam.specs.map((s) => s.orderCount));
        }
      }
      return "0";
    }
    case "model": {
      for (const c of dim) {
        if (c.customerName !== path.customerName) continue;
        const mod = c.models.find((m) => m.model === path.model);
        if (mod) return sumOrderCountDisplayStrings(mod.names.map((n) => n.orderCount));
      }
      return "0";
    }
    case "customer": {
      const c = dim.find((r) => r.customerName === path.customerName);
      if (c) return sumOrderCountDisplayStrings(c.models.map((m) => m.orderCount));
      return "0";
    }
  }
}

/**
 * 仅将某一单元格的 orderCount 设为给定值，其余不动。
 */
export function setOrderCountOnDimension(
  dim: readonly CustomerInboundDimensionRow[],
  path: OrderCountCellPath,
  orderCount: string,
): CustomerInboundDimensionRow[] {
  if (path.level === "customer") {
    return dim.map((c) =>
      c.customerName === path.customerName ? { ...c, orderCount } : c,
    );
  }
  if (path.level === "model") {
    return dim.map((c) => {
      if (c.customerName !== path.customerName) return c;
      return {
        ...c,
        models: c.models.map((m) => (m.model === path.model ? { ...m, orderCount } : m)),
      };
    });
  }
  return dim.map((c) => {
    if (c.customerName !== path.customerName) return c;
    return {
      ...c,
      models: c.models.map((m) => {
        if (m.model !== path.model) return m;
        if (path.level === "name") {
          return {
            ...m,
            names: m.names.map((n) =>
              n.productName === path.productName ? { ...n, orderCount } : n,
            ),
          };
        }
        return {
          ...m,
          names: m.names.map((n) => {
            if (n.productName !== path.productName) return n;
            if (path.level === "spec") {
              return {
                ...n,
                specs: n.specs.map((s) => (s.spec === path.spec ? { ...s, orderCount } : s)),
              };
            }
            if (path.level === "grammage") {
              return {
                ...n,
                specs: n.specs.map((s) => {
                  if (s.spec !== path.spec) return s;
                  return {
                    ...s,
                    grammages: s.grammages.map((g) =>
                      g.grammage === path.grammage ? { ...g, orderCount } : g,
                    ),
                  };
                }),
              };
            }
            return n;
          }),
        };
      }),
    };
  });
}

/**
 * 仅将某一节点（客户→型号→品名→规格→克重）的「订货间隔标准差」字段设为给定值，其余不动。路径同 {@link setOrderCountOnDimension}。
 */
export function setOrderIntervalStdDevOnDimension(
  dim: readonly CustomerInboundDimensionRow[],
  path: OrderCountCellPath,
  orderIntervalStdDev: string,
): CustomerInboundDimensionRow[] {
  if (path.level === "customer") {
    return dim.map((c) =>
      c.customerName === path.customerName ? { ...c, orderIntervalStdDev } : c,
    );
  }
  if (path.level === "model") {
    return dim.map((c) => {
      if (c.customerName !== path.customerName) return c;
      return {
        ...c,
        models: c.models.map((m) => (m.model === path.model ? { ...m, orderIntervalStdDev } : m)),
      };
    });
  }
  return dim.map((c) => {
    if (c.customerName !== path.customerName) return c;
    return {
      ...c,
      models: c.models.map((m) => {
        if (m.model !== path.model) return m;
        if (path.level === "name") {
          return {
            ...m,
            names: m.names.map((n) =>
              n.productName === path.productName ? { ...n, orderIntervalStdDev } : n,
            ),
          };
        }
        return {
          ...m,
          names: m.names.map((n) => {
            if (n.productName !== path.productName) return n;
            if (path.level === "spec") {
              return {
                ...n,
                specs: n.specs.map((s) => (s.spec === path.spec ? { ...s, orderIntervalStdDev } : s)),
              };
            }
            if (path.level === "grammage") {
              return {
                ...n,
                specs: n.specs.map((s) => {
                  if (s.spec !== path.spec) return s;
                  return {
                    ...s,
                    grammages: s.grammages.map((g) =>
                      g.grammage === path.grammage ? { ...g, orderIntervalStdDev } : g,
                    ),
                  };
                }),
              };
            }
            return n;
          }),
        };
      }),
    };
  });
}

/**
 * 仅将某一节点「订货间隔的平均值」字段设为给定值，其余不动。路径同 {@link setOrderCountOnDimension}。
 */
export function setOrderIntervalMeanOnDimension(
  dim: readonly CustomerInboundDimensionRow[],
  path: OrderCountCellPath,
  orderIntervalMean: string,
): CustomerInboundDimensionRow[] {
  if (path.level === "customer") {
    return dim.map((c) =>
      c.customerName === path.customerName ? { ...c, orderIntervalMean } : c,
    );
  }
  if (path.level === "model") {
    return dim.map((c) => {
      if (c.customerName !== path.customerName) return c;
      return {
        ...c,
        models: c.models.map((m) => (m.model === path.model ? { ...m, orderIntervalMean } : m)),
      };
    });
  }
  return dim.map((c) => {
    if (c.customerName !== path.customerName) return c;
    return {
      ...c,
      models: c.models.map((m) => {
        if (m.model !== path.model) return m;
        if (path.level === "name") {
          return {
            ...m,
            names: m.names.map((n) =>
              n.productName === path.productName ? { ...n, orderIntervalMean } : n,
            ),
          };
        }
        return {
          ...m,
          names: m.names.map((n) => {
            if (n.productName !== path.productName) return n;
            if (path.level === "spec") {
              return {
                ...n,
                specs: n.specs.map((s) => (s.spec === path.spec ? { ...s, orderIntervalMean } : s)),
              };
            }
            if (path.level === "grammage") {
              return {
                ...n,
                specs: n.specs.map((s) => {
                  if (s.spec !== path.spec) return s;
                  return {
                    ...s,
                    grammages: s.grammages.map((g) =>
                      g.grammage === path.grammage ? { ...g, orderIntervalMean } : g,
                    ),
                  };
                }),
              };
            }
            return n;
          }),
        };
      }),
    };
  });
}

/**
 * 「计算订货间隔平均值」用：自**顶**（客户）向**下**（克重）的前序路径序列，与界面折叠树一致。
 * 与「计算订货间隔标准差」的克重→…→客户顺序（自下而上写回）不同。
 */
export function listOrderIntervalMeanCellPathsTopDown(
  dim: readonly CustomerInboundDimensionRow[],
): OrderCountCellPath[] {
  const out: OrderCountCellPath[] = [];
  for (const cust of dim) {
    out.push({ level: "customer", customerName: cust.customerName });
    for (const mod of cust.models) {
      out.push({ level: "model", customerName: cust.customerName, model: mod.model });
      for (const nam of mod.names) {
        out.push({
          level: "name",
          customerName: cust.customerName,
          model: mod.model,
          productName: nam.productName,
        });
        for (const sp of nam.specs) {
          out.push({
            level: "spec",
            customerName: cust.customerName,
            model: mod.model,
            productName: nam.productName,
            spec: sp.spec,
          });
          for (const gr of sp.grammages) {
            out.push({
              level: "grammage",
              customerName: cust.customerName,
              model: mod.model,
              productName: nam.productName,
              spec: sp.spec,
              grammage: gr.grammage,
            });
          }
        }
      }
    }
  }
  return out;
}

/**
 * 仅将某一节点「周期性标签」字段设为给定值，其余不动。路径同 {@link setOrderCountOnDimension}。
 */
export function setPeriodicityLabelOnDimension(
  dim: readonly CustomerInboundDimensionRow[],
  path: OrderCountCellPath,
  periodicityLabel: string,
): CustomerInboundDimensionRow[] {
  if (path.level === "customer") {
    return dim.map((c) =>
      c.customerName === path.customerName ? { ...c, periodicityLabel } : c,
    );
  }
  if (path.level === "model") {
    return dim.map((c) => {
      if (c.customerName !== path.customerName) return c;
      return {
        ...c,
        models: c.models.map((m) => (m.model === path.model ? { ...m, periodicityLabel } : m)),
      };
    });
  }
  return dim.map((c) => {
    if (c.customerName !== path.customerName) return c;
    return {
      ...c,
      models: c.models.map((m) => {
        if (m.model !== path.model) return m;
        if (path.level === "name") {
          return {
            ...m,
            names: m.names.map((n) =>
              n.productName === path.productName ? { ...n, periodicityLabel } : n,
            ),
          };
        }
        return {
          ...m,
          names: m.names.map((n) => {
            if (n.productName !== path.productName) return n;
            if (path.level === "spec") {
              return {
                ...n,
                specs: n.specs.map((s) => (s.spec === path.spec ? { ...s, periodicityLabel } : s)),
              };
            }
            if (path.level === "grammage") {
              return {
                ...n,
                specs: n.specs.map((s) => {
                  if (s.spec !== path.spec) return s;
                  return {
                    ...s,
                    grammages: s.grammages.map((g) =>
                      g.grammage === path.grammage ? { ...g, periodicityLabel } : g,
                    ),
                  };
                }),
              };
            }
            return n;
          }),
        };
      }),
    };
  });
}

