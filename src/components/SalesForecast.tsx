/**
 * @fileoverview 销售预测：主卡片下「用户显示模式 / 调试显示模式」双 Tab；CSV、底表与客户进货周期性分析等均在调试 Tab。
 *
 * @module SalesForecast
 */

import {
  type ChangeEvent,
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  calculateOrderSegments,
  classifyOrderQuantityLabel,
  type OrderSegmentLabel,
  type OrderSegmentResult,
} from "../utils/calculateOrderSegments";
import {
  listCustomerPathsInTreeOrder,
  listGrammageOrderCountStepsFromBase,
  listGrammagePathsInTreeOrder,
  listModelPathsInTreeOrder,
  listNamePathsInTreeOrder,
  listSpecPathsInTreeOrder,
  orderCountByAggregatingFromChildren,
  listOrderIntervalMeanCellPathsTopDown,
  setOrderCountOnDimension,
  setOrderIntervalMeanOnDimension,
  setOrderIntervalStdDevOnDimension,
  setPeriodicityLabelOnDimension,
} from "../utils/applyOrderCountToDimension";
import {
  buildCustomerInboundDimensionFromAnalysis,
  type CustomerInboundDimensionMetrics,
  type CustomerInboundDimensionRow,
  type CustomerInboundModelRow,
} from "../utils/buildCustomerInboundDimensionFromAnalysis";
import { decodeTextBytesAuto } from "../utils/decodeTextBytesAuto";
import {
  filterCustomerModelsForHideIrregular,
  isIrregularPatternPeriodicity,
} from "../utils/filterCustomerInboundTreeHideIrregular";
import {
  listInboundPeriodicityPatterns,
  type InboundPeriodicityPatternItem,
} from "../utils/inboundPeriodicityPatternMining";
import { formatCustomerPreviewName } from "../utils/formatCustomerPreviewName";
import { parseCsvText } from "../utils/parseCsvText";
import { MATERIAL_TAG_LEGEND } from "../utils/parseMaterialCode";
import {
  averageOrderIntervalStdDevFromDirectChildren,
  computeOrderIntervalMeanForCellPath,
  computePeriodicityLabelForPath,
  computeOrderIntervalStdDevForGrammagePath,
  orderIntervalStdDevForNamePathWithFallback,
  orderIntervalStdDevForSpecPathWithFallback,
} from "../utils/customerOrderIntervalStats";
import {
  buildSalesAnalysisBaseFromPreview,
  findSalesCustomerSourceColumnIndex,
  SALES_ANALYSIS_BASE_HEADERS,
  type SalesAnalysisBaseRow,
} from "../utils/salesAnalysisBaseFromPreview";
import {
  loadSalesForecastPersisted,
  readSalesForecastViewTab,
  saveSalesForecastPersisted,
  writeSalesForecastViewTab,
} from "../utils/salesForecastStorage";
import { CustomerDimLabelIcon } from "./CustomerDimLabelIcon";

const CSV_ACCEPT = ".csv,text/csv";

const ORDER_QTY_SEG_TAG_CLASS: Record<OrderSegmentLabel, string> = {
  高: "sales-order-qty-seg-tag sales-order-qty-seg-tag--high",
  低: "sales-order-qty-seg-tag sales-order-qty-seg-tag--low",
  零散: "sales-order-qty-seg-tag sales-order-qty-seg-tag--fragmented",
};

/** 与维树一致的底表日期展示串解析（用于时间线间隔天数） */
function parsePurchaseTimelineDateMs(s: string): number | null {
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

function daysBetweenPurchaseDates(prevDate: string, nextDate: string): number | null {
  const a = parsePurchaseTimelineDateMs(prevDate);
  const b = parsePurchaseTimelineDateMs(nextDate);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
}

/** 进货周期性模式挖掘：标题栏时间线按钮图标 */
function InboundPatternTimelineIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** 进货周期性模式挖掘：产品参数与底表「物料标签」同款 pill */
function InboundPatternProductParamTags({ item }: { item: InboundPeriodicityPatternItem }) {
  return (
    <div
      className="sales-material-tags-cell sales-inbound-pattern-materials"
      role="group"
      aria-label="产品参数模式"
    >
      {item.isProductScopeTotal ? (
        <span className="sales-material-tag sales-material-tag--id">总体</span>
      ) : (
        item.productMaterialTags.map((t) => (
          <span key={t.kind} className={`sales-material-tag sales-material-tag--${t.kind}`}>
            {t.text}
          </span>
        ))
      )}
    </div>
  );
}

function InboundPatternSubcardView({ p }: { p: InboundPeriodicityPatternItem }) {
  const isStrong = p.periodicityLabel.trim().split("\n")[0]?.trim() === "强周期性";
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [drawerEntered, setDrawerEntered] = useState(false);
  const timelineTitleId = useId();

  const closeTimeline = useCallback(() => setTimelineOpen(false), []);

  useEffect(() => {
    if (!timelineOpen) {
      setDrawerEntered(false);
      return;
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setDrawerEntered(true));
    });
    return () => cancelAnimationFrame(id);
  }, [timelineOpen]);

  useEffect(() => {
    if (!timelineOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTimelineOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timelineOpen]);

  useEffect(() => {
    if (!timelineOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [timelineOpen]);

  return (
    <div
      className={[
        "sales-inbound-pattern-subcard",
        isStrong ? "sales-inbound-pattern-subcard--strong" : "sales-inbound-pattern-subcard--weak",
      ].join(" ")}
      role="listitem"
    >
      <div className="sales-inbound-pattern-subhead">
        <span className="sales-inbound-pattern-subhead-title task-text-wrap">{p.customerName}</span>
        <div className="sales-inbound-pattern-subhead-right">
          <button
            type="button"
            className="sales-inbound-pattern-timeline-trigger"
            onClick={() => setTimelineOpen((o) => !o)}
            aria-expanded={timelineOpen}
            aria-controls={timelineOpen ? `${p.key}-timeline-drawer` : undefined}
            title="查看采购时间线"
            aria-label="查看当前参数模式下的采购时间线"
          >
            <InboundPatternTimelineIcon />
          </button>
          <span
            className="sales-inbound-pattern-cv-pill"
            title={`CV ${p.cv}`}
            aria-label={`CV 值 ${p.cv}`}
          >
            {p.cv}
          </span>
        </div>
      </div>
      <div className="sales-inbound-pattern-subbody">
        <dl className="sales-inbound-pattern-dl">
          <div className="sales-inbound-pattern-row--inline">
            <dt>销售名称</dt>
            <dd className="task-text-wrap">{p.salesName}</dd>
          </div>
          <div className="sales-inbound-pattern-dl--param">
            <dt>产品参数模式</dt>
            <dd>
              <InboundPatternProductParamTags item={p} />
            </dd>
          </div>
          <div className="sales-inbound-pattern-row--inline">
            <dt>上一次发货日期</dt>
            <dd className="task-text-wrap">{p.lastShipDate}</dd>
          </div>
          <div className="sales-inbound-pattern-row--inline">
            <dt>订货间隔平均值</dt>
            <dd>{p.orderIntervalMean}</dd>
          </div>
          <div className="sales-inbound-pattern-row--inline">
            <dt>预计下次下单日期</dt>
            <dd className="task-text-wrap">{p.nextOrderDate}</dd>
          </div>
          <div className="sales-inbound-pattern-row--inline">
            <dt>对应平均下单量</dt>
            <dd>{p.avgOrderQty}</dd>
          </div>
        </dl>
      </div>
      {timelineOpen
        ? createPortal(
            <div
              id={`${p.key}-timeline-drawer`}
              className={[
                "sales-inbound-pattern-drawer-root",
                drawerEntered ? "sales-inbound-pattern-drawer-root--open" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <button
                type="button"
                className="sales-inbound-pattern-drawer-scrim"
                aria-label="关闭采购时间线"
                onClick={closeTimeline}
              />
              <aside
                className="sales-inbound-pattern-drawer-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby={timelineTitleId}
              >
                <div className="sales-inbound-pattern-drawer-panel-inner">
                  <div className="sales-inbound-pattern-drawer-head">
                    <span id={timelineTitleId} className="sales-inbound-pattern-drawer-title">
                      采购时间线
                    </span>
                    <button
                      type="button"
                      className="sales-inbound-pattern-drawer-close"
                      onClick={closeTimeline}
                      aria-label="关闭采购时间线"
                    >
                      关闭
                    </button>
                  </div>
                  <p className="sales-inbound-pattern-drawer-scope muted small">
                    {p.customerName}
                    {!p.isProductScopeTotal && p.productMaterialTags.length > 0 ? (
                      <>
                        {" · "}
                        {p.productMaterialTags.map((t) => t.text).join(" / ")}
                      </>
                    ) : null}
                    {p.isProductScopeTotal ? " · 总体" : null}
                  </p>
                  <div className="sales-inbound-pattern-drawer-body">
                    {p.purchaseTimeline.length === 0 ? (
                      <p className="sales-inbound-pattern-drawer-empty muted small" role="status">
                        暂无对应底表采购行。
                      </p>
                    ) : (
                      <ol className="sales-inbound-pattern-drawer-steps">
                        {p.purchaseTimeline.map((node, idx) => {
                          const gapDays =
                            idx > 0
                              ? daysBetweenPurchaseDates(p.purchaseTimeline[idx - 1]!.date, node.date)
                              : null;
                          const gapLabel =
                            gapDays === null
                              ? "间隔 —"
                              : gapDays >= 0
                                ? `+${gapDays}天`
                                : `${gapDays}天`;
                          return (
                            <Fragment key={`${p.key}-tl-${idx}`}>
                              {idx > 0 ? (
                                <li className="sales-inbound-pattern-drawer-step sales-inbound-pattern-drawer-step--interval">
                                  <span className="sales-inbound-pattern-drawer-interval-rail" aria-hidden />
                                  <span className="sales-inbound-pattern-drawer-interval-badge">{gapLabel}</span>
                                </li>
                              ) : null}
                              <li className="sales-inbound-pattern-drawer-step sales-inbound-pattern-drawer-step--card">
                                <span className="sales-inbound-pattern-drawer-node-dot" aria-hidden />
                                <div className="sales-inbound-pattern-drawer-node-card">
                                  <div className="sales-inbound-pattern-drawer-node-row">
                                    <span className="sales-inbound-pattern-drawer-node-label">采购日期</span>
                                    <span className="sales-inbound-pattern-drawer-node-value sales-inbound-pattern-drawer-node-value--date">
                                      {node.date}
                                    </span>
                                  </div>
                                  <div className="sales-inbound-pattern-drawer-node-row">
                                    <span className="sales-inbound-pattern-drawer-node-label">下单数量</span>
                                    <span className="sales-inbound-pattern-drawer-node-value sales-inbound-pattern-drawer-node-value--qty">
                                      {node.quantity}
                                    </span>
                                  </div>
                                </div>
                              </li>
                            </Fragment>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </div>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function formatCustomerDimMetricValue(label: string, raw: string): string {
  const v = raw.trim();
  if (v === "" || v === "—" || v === "-") return "—";
  if (label === "订货间隔的标准差" || label === "订货间隔的平均值") {
    const n = Number(String(v).replace(/,/g, ""));
    if (Number.isFinite(n)) return n.toFixed(2);
    return v;
  }
  return v;
}

function CustomerDimPeriodicityValue({ value, alignStrip }: { value: string; alignStrip?: boolean }) {
  const v = (value ?? "").trim();
  if (v === "" || v === "—" || v === "-") {
    return <span className="sales-customer-dim-metric-value">—</span>;
  }
  const lines = v.split("\n");
  const main = (lines[0] ?? "").trim();
  const sub = (lines[1] ?? "").trim();
  if (main === "强周期性" || main === "弱周期性") {
    const isStrong = main === "强周期性";
    return (
      <div
        className={[
          "sales-customer-dim-periodicity-wrap",
          alignStrip ? "sales-customer-dim-periodicity-wrap--end" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span
          className={[
            "sales-customer-dim-periodicity-pill",
            isStrong ? "sales-customer-dim-periodicity-pill--strong" : "sales-customer-dim-periodicity-pill--weak",
          ].join(" ")}
        >
          {main}
        </span>
        {sub ? <span className="sales-customer-dim-periodicity-cvnote">{sub}</span> : null}
      </div>
    );
  }
  if (main === "不规则") {
    return (
      <div
        className={[
          "sales-customer-dim-periodicity-wrap",
          alignStrip ? "sales-customer-dim-periodicity-wrap--end" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="sales-customer-dim-periodicity-irregular">{main}</span>
        {sub ? <span className="sales-customer-dim-periodicity-cvnote">{sub}</span> : null}
      </div>
    );
  }
  return <span className="sales-customer-dim-metric-value">{v}</span>;
}

function CustomerDimMetricGrid({
  lastOrderDate,
  orderCount,
  orderIntervalStdDev,
  orderIntervalMean,
  periodicityLabel,
  compact,
  alignStrip,
}: CustomerInboundDimensionMetrics & { compact?: boolean; alignStrip?: boolean }) {
  const item = (label: string, value: string) => {
    if (label === "周期性标签") {
      return (
        <div
          className={[
            compact ? "sales-customer-dim-metric sales-customer-dim-metric--compact" : "sales-customer-dim-metric",
            alignStrip ? "sales-customer-dim-metric--strip" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="sales-customer-dim-metric-label">{label}</span>
          <CustomerDimPeriodicityValue value={value} alignStrip={alignStrip} />
        </div>
      );
    }
    return (
      <div
        className={[
          compact ? "sales-customer-dim-metric sales-customer-dim-metric--compact" : "sales-customer-dim-metric",
          alignStrip ? "sales-customer-dim-metric--strip" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="sales-customer-dim-metric-label">{label}</span>
        <span className="sales-customer-dim-metric-value">
          {formatCustomerDimMetricValue(label, value)}
        </span>
      </div>
    );
  };
  const rootClass = [
    compact ? "sales-customer-dim-metrics sales-customer-dim-metrics--compact" : "sales-customer-dim-metrics",
    alignStrip ? "sales-customer-dim-metrics--align-strip" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={rootClass}>
      {item("最近一次下单日期", lastOrderDate)}
      {item("下单次数", orderCount)}
      {item("订货间隔的标准差", orderIntervalStdDev)}
      {item("订货间隔的平均值", orderIntervalMean)}
      {item("周期性标签", periodicityLabel)}
    </div>
  );
}

function CustomerDimensionModelTree({
  customerName,
  models,
  listEmptyByFilter,
}: {
  customerName: string;
  models: CustomerInboundModelRow[];
  /** 原数据有子级，但在「隐藏不规则模式」下全部被筛空 */
  listEmptyByFilter?: boolean;
}) {
  /** 记入 Set 的节点为收起；默认空集表示各级展开 */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setCollapsed(new Set());
  }, [customerName]);

  const toggleNode = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const isOpen = (key: string) => !collapsed.has(key);

  if (models.length === 0) {
    return (
      <p className="muted small sales-customer-dim-sku-empty">
        {listEmptyByFilter
          ? "在「隐藏不规则模式」下，该客户下暂无可见的型号/品名/规格/克重（子级可能均为「不规则」）。"
          : "该客户暂无型号下钻数据。"}
      </p>
    );
  }

  return (
    <ul className="sales-customer-dim-sku-list sales-customer-dim-models-root" role="group">
      {models.map((mod) => {
        const modelKey = `m\u001f${customerName}\u001f${mod.model}`;
        const modelOpen = isOpen(modelKey);
        return (
          <li
            key={modelKey}
            className={`sales-customer-dim-model-item${modelOpen ? "" : " sales-customer-dim-node--collapsed"}`}
          >
            <div className="sales-customer-dim-level-card sales-customer-dim-level-card--model">
              <div className="sales-customer-dim-level-line">
                <div className="sales-customer-dim-level-tree">
                  <button
                    type="button"
                    className="sales-customer-dim-node-toggle"
                    aria-expanded={modelOpen}
                    onClick={() => toggleNode(modelKey)}
                    aria-label={`${modelOpen ? "收起" : "展开"}型号「${mod.model}」的品名下钻`}
                  >
                    <span className="sales-customer-dim-node-chevron" aria-hidden>
                      {modelOpen ? "▲" : "▼"}
                    </span>
                    <span className="sales-customer-dim-node-toggle-main">
                      <span className="sales-customer-dim-level-label">
                        <CustomerDimLabelIcon kind="model" />
                        型号
                      </span>
                      <span className="sales-customer-dim-level-value">{mod.model}</span>
                    </span>
                  </button>
                </div>
                <div className="sales-customer-dim-level-metric-wrap">
                  <CustomerDimMetricGrid
                    lastOrderDate={mod.lastOrderDate}
                    orderCount={mod.orderCount}
                    orderIntervalStdDev={mod.orderIntervalStdDev}
                    orderIntervalMean={mod.orderIntervalMean}
                    periodicityLabel={mod.periodicityLabel}
                    compact
                    alignStrip
                  />
                </div>
              </div>
            </div>
            {modelOpen && (
              <ul className="sales-customer-dim-nested sales-customer-dim-level--names" role="group">
                {mod.names.map((nam) => {
                  const nameKey = `n\u001f${customerName}\u001f${mod.model}\u001f${nam.productName}`;
                  const nameOpen = isOpen(nameKey);
                  return (
                    <li
                      key={nameKey}
                      className={`sales-customer-dim-name-item${nameOpen ? "" : " sales-customer-dim-node--collapsed"}`}
                    >
                      <div className="sales-customer-dim-level-card sales-customer-dim-level-card--name">
                        <div className="sales-customer-dim-level-line">
                          <div className="sales-customer-dim-level-tree">
                            <button
                              type="button"
                              className="sales-customer-dim-node-toggle"
                              aria-expanded={nameOpen}
                              onClick={() => toggleNode(nameKey)}
                              aria-label={`${nameOpen ? "收起" : "展开"}品名「${nam.productName}」的规格/克重下钻`}
                            >
                              <span className="sales-customer-dim-node-chevron" aria-hidden>
                                {nameOpen ? "▲" : "▼"}
                              </span>
                              <span className="sales-customer-dim-node-toggle-main">
                                <span className="sales-customer-dim-level-label">
                                  <CustomerDimLabelIcon kind="name" />
                                  品名
                                </span>
                                <span className="sales-customer-dim-level-value">{nam.productName}</span>
                              </span>
                            </button>
                          </div>
                          <div className="sales-customer-dim-level-metric-wrap">
                            <CustomerDimMetricGrid
                              lastOrderDate={nam.lastOrderDate}
                              orderCount={nam.orderCount}
                              orderIntervalStdDev={nam.orderIntervalStdDev}
                              orderIntervalMean={nam.orderIntervalMean}
                              periodicityLabel={nam.periodicityLabel}
                              compact
                              alignStrip
                              />
                          </div>
                        </div>
                      </div>
                      {nameOpen && (
                        <ul className="sales-customer-dim-nested sales-customer-dim-level--specs" role="group">
                          {nam.specs.map((sp) => {
                            const specKey = `s\u001f${customerName}\u001f${mod.model}\u001f${nam.productName}\u001f${sp.spec}`;
                            const specOpen = isOpen(specKey);
                            return (
                              <li
                                key={specKey}
                                className={`sales-customer-dim-spec-item${specOpen ? "" : " sales-customer-dim-node--collapsed"}`}
                              >
                                <div className="sales-customer-dim-level-card sales-customer-dim-level-card--spec">
                                  <div className="sales-customer-dim-level-line">
                                    <div className="sales-customer-dim-level-tree">
                                      <button
                                        type="button"
                                        className="sales-customer-dim-node-toggle"
                                        aria-expanded={specOpen}
                                        onClick={() => toggleNode(specKey)}
                                        aria-label={`${specOpen ? "收起" : "展开"}规格「${sp.spec}」的克重下钻`}
                                      >
                                        <span className="sales-customer-dim-node-chevron" aria-hidden>
                                          {specOpen ? "▲" : "▼"}
                                        </span>
                                        <span className="sales-customer-dim-node-toggle-main">
                                          <span className="sales-customer-dim-level-label">
                                            <CustomerDimLabelIcon kind="spec" />
                                            规格
                                          </span>
                                          <span className="sales-customer-dim-level-value">{sp.spec}</span>
                                        </span>
                                      </button>
                                    </div>
                                    <div className="sales-customer-dim-level-metric-wrap">
                                      <CustomerDimMetricGrid
                                        lastOrderDate={sp.lastOrderDate}
                                        orderCount={sp.orderCount}
                                        orderIntervalStdDev={sp.orderIntervalStdDev}
                                        orderIntervalMean={sp.orderIntervalMean}
                                        periodicityLabel={sp.periodicityLabel}
                                        compact
                                        alignStrip
                                      />
                                    </div>
                                  </div>
                                </div>
                                {specOpen && (
                                  <ul
                                    className="sales-customer-dim-nested sales-customer-dim-level--grammages"
                                    role="group"
                                  >
                                    {sp.grammages.map((gr) => {
                                      const grKey = `g\u001f${customerName}\u001f${mod.model}\u001f${nam.productName}\u001f${sp.spec}\u001f${gr.grammage}`;
                                      return (
                                        <li key={grKey} className="sales-customer-dim-grammage-item">
                                          <div className="sales-customer-dim-level-card sales-customer-dim-level-card--grammage">
                                            <div className="sales-customer-dim-level-line">
                                              <div className="sales-customer-dim-level-tree">
                                                <span className="sales-customer-dim-node-toggle sales-customer-dim-node-toggle--grammage-leaf">
                                                  <span className="sales-customer-dim-node-chevron" aria-hidden>
                                                    <span className="sales-customer-dim-node-chevron-spacer" />
                                                  </span>
                                                  <span className="sales-customer-dim-node-toggle-main">
                                                    <span className="sales-customer-dim-level-label">
                                                      <CustomerDimLabelIcon kind="grammage" />
                                                      克重
                                                    </span>
                                                    <span className="sales-customer-dim-level-value">
                                                      {gr.grammage}
                                                    </span>
                                                  </span>
                                                </span>
                                              </div>
                                              <div className="sales-customer-dim-level-metric-wrap">
                                                <CustomerDimMetricGrid
                                                  lastOrderDate={gr.lastOrderDate}
                                                  orderCount={gr.orderCount}
                                                  orderIntervalStdDev={gr.orderIntervalStdDev}
                                                  orderIntervalMean={gr.orderIntervalMean}
                                                  periodicityLabel={gr.periodicityLabel}
                                                  compact
                                                  alignStrip
                                                />
                                              </div>
                                            </div>
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function readInitialSalesForecastState(): {
  preview: { headers: string[]; rows: string[][]; fileName: string } | null;
  analysisBase: { rows: SalesAnalysisBaseRow[]; missingHint: string | null } | null;
  orderSegments: OrderSegmentResult | null;
  customerInboundDimension: CustomerInboundDimensionRow[] | null;
  orderCountComputeCompleted: boolean;
  orderIntervalStdDevComputeCompleted: boolean;
  orderIntervalMeanComputeCompleted: boolean;
  periodicityLabelsComputeCompleted: boolean;
} {
  const stored = loadSalesForecastPersisted();
  if (!stored) {
    return {
      preview: null,
      analysisBase: null,
      orderSegments: null,
      customerInboundDimension: null,
      orderCountComputeCompleted: false,
      orderIntervalStdDevComputeCompleted: false,
      orderIntervalMeanComputeCompleted: false,
      periodicityLabelsComputeCompleted: false,
    };
  }
  return {
    preview: stored.preview,
    analysisBase: stored.analysisBase,
    orderSegments: stored.orderSegments ?? null,
    customerInboundDimension: stored.customerInboundDimension ?? null,
    orderCountComputeCompleted: stored.orderCountComputeCompleted,
    orderIntervalStdDevComputeCompleted: stored.orderIntervalStdDevComputeCompleted,
    orderIntervalMeanComputeCompleted: stored.orderIntervalMeanComputeCompleted,
    periodicityLabelsComputeCompleted: stored.periodicityLabelsComputeCompleted,
  };
}

function resolveInitialForecastViewTab(
  persisted: ReturnType<typeof readInitialSalesForecastState>,
): "user" | "debug" {
  const fromStorage = readSalesForecastViewTab();
  if (fromStorage) return fromStorage;
  if (
    persisted.analysisBase ||
    (persisted.customerInboundDimension && persisted.customerInboundDimension.length > 0)
  ) {
    return "debug";
  }
  return "user";
}

export type SalesForecastProps = {
  /** 为 true 时表示当前路由在销售预测页；切回本页时从 localStorage 再同步，避免刷新或异常丢状态 */
  active?: boolean;
};

export function SalesForecast({ active = true }: SalesForecastProps) {
  const uploadId = useId();
  const initialPersisted = useMemo(() => readInitialSalesForecastState(), []);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][]; fileName: string } | null>(
    initialPersisted.preview,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [analysisBase, setAnalysisBase] = useState<{
    rows: SalesAnalysisBaseRow[];
    missingHint: string | null;
  } | null>(initialPersisted.analysisBase);
  const [orderSegments, setOrderSegments] = useState<OrderSegmentResult | null>(
    initialPersisted.orderSegments,
  );
  const [orderSegmentsBusy, setOrderSegmentsBusy] = useState(false);
  const [customerDimensionBusy, setCustomerDimensionBusy] = useState(false);
  const [customerInboundDimension, setCustomerInboundDimension] = useState<CustomerInboundDimensionRow[] | null>(
    initialPersisted.customerInboundDimension,
  );
  /** 有底表时默认折叠原始 CSV 预览，拆解成功后自动折叠，仍可手动展开 */
  const [previewCollapsed, setPreviewCollapsed] = useState(() => Boolean(initialPersisted.analysisBase));
  const [openCustomerDimIds, setOpenCustomerDimIds] = useState<Set<string>>(
    () => new Set(initialPersisted.customerInboundDimension?.map((r) => r.customerName) ?? []),
  );
  const [orderCountComputeBusy, setOrderCountComputeBusy] = useState(false);
  /** 分步计算进度，用于按钮内条与文案 */
  const [orderCountProgress, setOrderCountProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  /** 最近一轮分步计算是否已跑完；用于绿底白字态（与持久化 orderCountComputeCompleted 同步） */
  const [orderCountComputeSuccess, setOrderCountComputeSuccess] = useState(
    () => initialPersisted.orderCountComputeCompleted,
  );
  const orderCountInflightRef = useRef(false);
  const [orderIntervalStdDevComputeSuccess, setOrderIntervalStdDevComputeSuccess] = useState(
    () => initialPersisted.orderIntervalStdDevComputeCompleted,
  );
  const [orderIntervalStdDevComputeBusy, setOrderIntervalStdDevComputeBusy] = useState(false);
  const [orderIntervalStdDevProgress, setOrderIntervalStdDevProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const orderIntervalStdDevInflightRef = useRef(false);
  const [orderIntervalMeanComputeBusy, setOrderIntervalMeanComputeBusy] = useState(false);
  const [orderIntervalMeanProgress, setOrderIntervalMeanProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const orderIntervalMeanInflightRef = useRef(false);
  /** 最近一轮「计算订货间隔平均值」是否已跑完；绿底白字（与 `orderIntervalMeanComputeCompleted` 持久化一致） */
  const [orderIntervalMeanComputeSuccess, setOrderIntervalMeanComputeSuccess] = useState(
    () => initialPersisted.orderIntervalMeanComputeCompleted,
  );
  const [periodicityLabelsComputeBusy, setPeriodicityLabelsComputeBusy] = useState(false);
  const [periodicityLabelsProgress, setPeriodicityLabelsProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const periodicityLabelsInflightRef = useRef(false);
  const [periodicityLabelsComputeSuccess, setPeriodicityLabelsComputeSuccess] = useState(
    () => initialPersisted.periodicityLabelsComputeCompleted,
  );
  const [inboundPatternStrongSectionOpen, setInboundPatternStrongSectionOpen] = useState(true);
  const [inboundPatternWeakSectionOpen, setInboundPatternWeakSectionOpen] = useState(true);
  const [customerInboundCardCollapsed, setCustomerInboundCardCollapsed] = useState(false);
  /** 与「已生成周期标签」同步：有完成态时默认可为 true，生成成功后强制 true */
  const [hideIrregularPatterns, setHideIrregularPatterns] = useState(
    () => readInitialSalesForecastState().periodicityLabelsComputeCompleted,
  );
  const [forecastViewTab, setForecastViewTab] = useState<"user" | "debug">(() =>
    resolveInitialForecastViewTab(initialPersisted),
  );
  const prevActiveRef = useRef<boolean | null>(null);

  /** 从其他页签切回销售预测时，用已持久化的预览 / 底表 / 数量分类 / 客户进货周期性分析 覆盖本地 state（与 save 写入一致） */
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = active;
    if (!active) return;
    if (prev === true) return;

    const stored = loadSalesForecastPersisted();
    if (!stored) return;
    setPreview(stored.preview);
    setAnalysisBase(stored.analysisBase);
    setOrderSegments(stored.orderSegments ?? null);
    setCustomerInboundDimension(stored.customerInboundDimension ?? null);
    if (stored.customerInboundDimension?.length) {
      setOpenCustomerDimIds(new Set(stored.customerInboundDimension.map((r) => r.customerName)));
    } else {
      setOpenCustomerDimIds(new Set());
    }
    const tabPref = readSalesForecastViewTab();
    if (tabPref) {
      setForecastViewTab(tabPref);
    } else if (stored.analysisBase || (stored.customerInboundDimension?.length ?? 0) > 0) {
      setForecastViewTab("debug");
    }
    setOrderCountComputeSuccess(stored.orderCountComputeCompleted);
    setOrderIntervalStdDevComputeSuccess(stored.orderIntervalStdDevComputeCompleted);
    setOrderIntervalMeanComputeSuccess(stored.orderIntervalMeanComputeCompleted);
    setPeriodicityLabelsComputeSuccess(stored.periodicityLabelsComputeCompleted);
  }, [active]);

  useEffect(() => {
    if (!analysisBase) {
      setOrderSegments(null);
      setCustomerInboundDimension(null);
      setOpenCustomerDimIds(new Set());
      setCustomerDimensionBusy(false);
      setOrderCountComputeSuccess(false);
      setOrderCountProgress(null);
      setOrderIntervalStdDevComputeSuccess(false);
      setOrderIntervalMeanComputeSuccess(false);
      setPeriodicityLabelsComputeSuccess(false);
      setHideIrregularPatterns(false);
    }
  }, [analysisBase]);

  const onPickFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setError(null);
    setPreview(null);
    setAnalysisBase(null);
    setPreviewCollapsed(false);
    if (!f) {
      setPickedFile(null);
      return;
    }
    const lower = f.name.toLowerCase();
    if (!lower.endsWith(".csv") && f.type !== "text/csv" && f.type !== "application/vnd.ms-excel") {
      setPickedFile(null);
      setError("请选择扩展名为 .csv 的文件。");
      e.target.value = "";
      return;
    }
    setPickedFile(f);
  }, []);

  const onSave = useCallback(() => {
    setError(null);
    if (!pickedFile) {
      setError("请先选择 CSV 文件。");
      return;
    }
    setBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      setBusy(false);
      try {
        const buf = reader.result;
        if (!(buf instanceof ArrayBuffer)) {
          setPreview(null);
          setAnalysisBase(null);
          setPreviewCollapsed(false);
          setError("读取结果异常。");
          return;
        }
        const text = decodeTextBytesAuto(buf);
        const matrix = parseCsvText(text);
        if (matrix.length === 0) {
          setPreview(null);
          setAnalysisBase(null);
          setPreviewCollapsed(false);
          setError("文件中没有可解析的数据行。");
          return;
        }
        const headers = matrix[0]!.map((h, i) => (h.trim() !== "" ? h.trim() : `列${i + 1}`));
        const body = matrix.slice(1);
        const width = headers.length;
        const normalized = body.map((row) => {
          const next = [...row];
          while (next.length < width) next.push("");
          if (next.length > width) return next.slice(0, width);
          return next;
        });
        const customerCol = findSalesCustomerSourceColumnIndex(headers);
        const rowsForPreview =
          customerCol >= 0
            ? normalized.map((row) => {
                const next = [...row];
                next[customerCol] = formatCustomerPreviewName(next[customerCol] ?? "");
                return next;
              })
            : normalized;
        const nextPreview = { headers, rows: rowsForPreview, fileName: pickedFile.name };
        setAnalysisBase(null);
        setPreviewCollapsed(false);
        setPreview(nextPreview);
        if (
          !saveSalesForecastPersisted(nextPreview, null, null, null, {
            orderCountComputeCompleted: false,
            orderIntervalStdDevComputeCompleted: false,
            orderIntervalMeanComputeCompleted: false,
            periodicityLabelsComputeCompleted: false,
          })
        ) {
          setError("数据已显示，但写入本地存储失败（可能超出浏览器配额）。刷新后可能无法恢复。");
        }
      } catch (err) {
        setPreview(null);
        setAnalysisBase(null);
        setPreviewCollapsed(false);
        setError(err instanceof Error ? err.message : "解析 CSV 失败。");
      }
    };
    reader.onerror = () => {
      setBusy(false);
      setPreview(null);
      setAnalysisBase(null);
      setPreviewCollapsed(false);
      setError("读取文件失败。");
    };
    reader.readAsArrayBuffer(pickedFile);
  }, [pickedFile]);

  const onDisassembleMaterial = useCallback(() => {
    if (!preview) return;
    setError(null);
    const { rows, missingSourceLabels } = buildSalesAnalysisBaseFromPreview(preview.headers, preview.rows);
    const nextAnalysis = {
      rows,
      missingHint:
        missingSourceLabels.length > 0
          ? `以下列未在表头中找到对应源字段，单元格将为空：${missingSourceLabels.join("；")}`
          : null,
    };
    setAnalysisBase(nextAnalysis);
    setOrderSegments(null);
    setOrderCountComputeSuccess(false);
    setOrderIntervalStdDevComputeSuccess(false);
    setOrderIntervalMeanComputeSuccess(false);
    setPeriodicityLabelsComputeSuccess(false);
    setHideIrregularPatterns(false);
    setCustomerInboundDimension(null);
    setOpenCustomerDimIds(new Set());
    setPreviewCollapsed(true);
    if (
      !saveSalesForecastPersisted(preview, nextAnalysis, null, null, {
        orderCountComputeCompleted: false,
        orderIntervalStdDevComputeCompleted: false,
        orderIntervalMeanComputeCompleted: false,
        periodicityLabelsComputeCompleted: false,
      })
    ) {
      setError("底表已生成，但写入本地存储失败（可能超出浏览器配额）。刷新后可能无法恢复底表。");
    }
  }, [preview]);

  const onGenerateOrderSegments = useCallback(() => {
    if (!analysisBase?.rows.length || !preview) return;
    setError(null);
    if (
      customerDimensionBusy ||
      orderCountComputeBusy ||
      orderIntervalStdDevComputeBusy ||
      orderIntervalMeanComputeBusy ||
      periodicityLabelsComputeBusy
    )
      return;
    setOrderSegmentsBusy(true);
    const quantities = analysisBase.rows.map((r) => r.quantity);
    const snapshotAnalysis = analysisBase;
    const snapshotPreview = preview;
    const snapshotCustomerDim = customerInboundDimension;
    window.setTimeout(() => {
      try {
        const result = calculateOrderSegments(quantities);
        const { fragmented_limit: fl, high_limit: hl } = result.thresholds;
        if (fl === 0 && hl === 0) {
          setOrderSegments(null);
          void saveSalesForecastPersisted(snapshotPreview, snapshotAnalysis, null, snapshotCustomerDim);
          setError("数量列中没有可用的正数，无法生成分类阈值。");
          return;
        }
        setOrderSegments(result);
        if (!saveSalesForecastPersisted(snapshotPreview, snapshotAnalysis, result, snapshotCustomerDim)) {
          setError("分类已生成，但写入本地存储失败（可能超出浏览器配额）。刷新后可能无法恢复分类。");
        }
      } finally {
        setOrderSegmentsBusy(false);
      }
    }, 0);
  }, [
    analysisBase,
    preview,
    customerInboundDimension,
    customerDimensionBusy,
    orderCountComputeBusy,
    orderIntervalStdDevComputeBusy,
    orderIntervalMeanComputeBusy,
    periodicityLabelsComputeBusy,
  ]);

  const onGenerateCustomerDimension = useCallback(() => {
    if (!analysisBase?.rows.length || !preview) return;
    setError(null);
    if (
      orderSegmentsBusy ||
      orderCountComputeBusy ||
      orderIntervalStdDevComputeBusy ||
      orderIntervalMeanComputeBusy ||
      periodicityLabelsComputeBusy
    )
      return;
    setCustomerDimensionBusy(true);
    const snapshotAnalysis = analysisBase;
    const snapshotPreview = preview;
    const snapshotOrderSegments = orderSegments;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          const next = buildCustomerInboundDimensionFromAnalysis(snapshotAnalysis.rows);
          setOrderCountComputeSuccess(false);
          setOrderCountProgress(null);
          setOrderIntervalStdDevComputeSuccess(false);
          setOrderIntervalMeanComputeSuccess(false);
          setPeriodicityLabelsComputeSuccess(false);
          setHideIrregularPatterns(false);
          setCustomerInboundDimension(next);
          setOpenCustomerDimIds(new Set(next.map((r) => r.customerName)));
          if (
            !saveSalesForecastPersisted(snapshotPreview, snapshotAnalysis, snapshotOrderSegments, next, {
              orderCountComputeCompleted: false,
              orderIntervalStdDevComputeCompleted: false,
              orderIntervalMeanComputeCompleted: false,
              periodicityLabelsComputeCompleted: false,
            })
          ) {
            setError("进货周期性分析已生成，但写入本地存储失败（可能超出浏览器配额）。刷新后可能无法恢复。");
          }
        } finally {
          setCustomerDimensionBusy(false);
        }
      });
    });
  }, [
    analysisBase,
    preview,
    orderSegments,
    orderSegmentsBusy,
    orderCountComputeBusy,
    orderIntervalStdDevComputeBusy,
    orderIntervalMeanComputeBusy,
    periodicityLabelsComputeBusy,
  ]);

  const toggleCustomerDimOpen = useCallback((customerName: string) => {
    setOpenCustomerDimIds((prev) => {
      const next = new Set(prev);
      if (next.has(customerName)) next.delete(customerName);
      else next.add(customerName);
      return next;
    });
  }, []);

  const onComputeOrderCounts = useCallback(() => {
    if (orderCountInflightRef.current) return;
    if (!customerInboundDimension?.length || !analysisBase?.rows.length || !preview) return;
    if (
      orderSegmentsBusy ||
      customerDimensionBusy ||
      orderIntervalStdDevComputeBusy ||
      orderIntervalMeanComputeBusy ||
      periodicityLabelsComputeBusy
    )
      return;
    setError(null);
    const dim0 = customerInboundDimension;
    const baseRows = analysisBase.rows;
    const gramSteps = listGrammageOrderCountStepsFromBase(dim0, baseRows);
    const specPaths = listSpecPathsInTreeOrder(dim0);
    const namePaths = listNamePathsInTreeOrder(dim0);
    const modelPaths = listModelPathsInTreeOrder(dim0);
    const custPaths = listCustomerPathsInTreeOrder(dim0);
    const gL = gramSteps.length;
    const sL = specPaths.length;
    const nL = namePaths.length;
    const mL = modelPaths.length;
    const cL = custPaths.length;
    const total = gL + sL + nL + mL + cL;
    if (total === 0) return;
    orderCountInflightRef.current = true;
    setOrderCountComputeSuccess(false);
    setOrderCountProgress({ current: 0, total });
    setOrderCountComputeBusy(true);
    let acc: CustomerInboundDimensionRow[] = dim0;
    let i = 0;
    const step = () => {
      if (i >= total) {
        orderCountInflightRef.current = false;
        setOrderCountProgress(null);
        setOrderCountComputeBusy(false);
        if (!saveSalesForecastPersisted(preview, analysisBase, orderSegments, acc, { orderCountComputeCompleted: true })) {
          setOrderCountComputeSuccess(false);
          setError("下单次数已更新，但保存本地失败（可能超出浏览器配额）。");
        } else {
          setOrderCountComputeSuccess(true);
        }
        return;
      }
      if (i < gL) {
        const s = gramSteps[i]!;
        acc = setOrderCountOnDimension(acc, s.path, s.orderCount);
      } else if (i < gL + sL) {
        const p = specPaths[i - gL]!;
        acc = setOrderCountOnDimension(acc, p, orderCountByAggregatingFromChildren(acc, p));
      } else if (i < gL + sL + nL) {
        const p = namePaths[i - gL - sL]!;
        acc = setOrderCountOnDimension(acc, p, orderCountByAggregatingFromChildren(acc, p));
      } else if (i < gL + sL + nL + mL) {
        const p = modelPaths[i - gL - sL - nL]!;
        acc = setOrderCountOnDimension(acc, p, orderCountByAggregatingFromChildren(acc, p));
      } else {
        const p = custPaths[i - gL - sL - nL - mL]!;
        acc = setOrderCountOnDimension(acc, p, orderCountByAggregatingFromChildren(acc, p));
      }
      setCustomerInboundDimension(acc);
      i += 1;
      setOrderCountProgress({ current: i, total });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [
    customerInboundDimension,
    analysisBase,
    preview,
    orderSegments,
    orderSegmentsBusy,
    customerDimensionBusy,
    orderIntervalStdDevComputeBusy,
    orderIntervalMeanComputeBusy,
    periodicityLabelsComputeBusy,
  ]);

  const onComputeOrderIntervalStdDev = useCallback(() => {
    if (orderIntervalStdDevInflightRef.current) return;
    if (!customerInboundDimension?.length || !analysisBase?.rows.length || !preview) return;
    if (
      orderSegmentsBusy ||
      customerDimensionBusy ||
      orderCountComputeBusy ||
      orderIntervalMeanComputeBusy ||
      periodicityLabelsComputeBusy
    )
      return;
    setError(null);
    const dim0 = customerInboundDimension;
    const baseRows = analysisBase.rows;
    const gramPaths = listGrammagePathsInTreeOrder(dim0);
    const specPaths = listSpecPathsInTreeOrder(dim0);
    const namePaths = listNamePathsInTreeOrder(dim0);
    const modelPaths = listModelPathsInTreeOrder(dim0);
    const custPaths = listCustomerPathsInTreeOrder(dim0);
    const gL = gramPaths.length;
    const sL = specPaths.length;
    const nL = namePaths.length;
    const mL = modelPaths.length;
    const cL = custPaths.length;
    const total = gL + sL + nL + mL + cL;
    if (total === 0) return;
    orderIntervalStdDevInflightRef.current = true;
    setOrderIntervalStdDevComputeSuccess(false);
    setOrderIntervalStdDevProgress({ current: 0, total });
    setOrderIntervalStdDevComputeBusy(true);
    let acc: CustomerInboundDimensionRow[] = dim0;
    let i = 0;
    const step = () => {
      if (i >= total) {
        orderIntervalStdDevInflightRef.current = false;
        setOrderIntervalStdDevProgress(null);
        setOrderIntervalStdDevComputeBusy(false);
        if (!saveSalesForecastPersisted(preview, analysisBase, orderSegments, acc, { orderIntervalStdDevComputeCompleted: true })) {
          setOrderIntervalStdDevComputeSuccess(false);
          setError("订货间隔标准差已写入界面，但保存本地失败（可能超出浏览器配额）。");
        } else {
          setOrderIntervalStdDevComputeSuccess(true);
        }
        return;
      }
      if (i < gL) {
        const path = gramPaths[i]!;
        acc = setOrderIntervalStdDevOnDimension(
          acc,
          path,
          computeOrderIntervalStdDevForGrammagePath(baseRows, path),
        );
      } else if (i < gL + sL) {
        const p = specPaths[i - gL]!;
        acc = setOrderIntervalStdDevOnDimension(
          acc,
          p,
          orderIntervalStdDevForSpecPathWithFallback(acc, baseRows, p),
        );
      } else if (i < gL + sL + nL) {
        const p = namePaths[i - gL - sL]!;
        acc = setOrderIntervalStdDevOnDimension(
          acc,
          p,
          orderIntervalStdDevForNamePathWithFallback(acc, baseRows, p),
        );
      } else if (i < gL + sL + nL + mL) {
        const p = modelPaths[i - gL - sL - nL]!;
        acc = setOrderIntervalStdDevOnDimension(
          acc,
          p,
          averageOrderIntervalStdDevFromDirectChildren(acc, p),
        );
      } else {
        const p = custPaths[i - gL - sL - nL - mL]!;
        acc = setOrderIntervalStdDevOnDimension(
          acc,
          p,
          averageOrderIntervalStdDevFromDirectChildren(acc, p),
        );
      }
      setCustomerInboundDimension(acc);
      i += 1;
      setOrderIntervalStdDevProgress({ current: i, total });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [
    customerInboundDimension,
    analysisBase,
    preview,
    orderSegments,
    orderSegmentsBusy,
    customerDimensionBusy,
    orderCountComputeBusy,
    orderIntervalMeanComputeBusy,
    periodicityLabelsComputeBusy,
  ]);

  const onComputeOrderIntervalMean = useCallback(() => {
    if (orderIntervalMeanInflightRef.current) return;
    if (!customerInboundDimension?.length || !analysisBase?.rows.length || !preview) return;
    if (
      orderSegmentsBusy ||
      customerDimensionBusy ||
      orderCountComputeBusy ||
      orderIntervalStdDevComputeBusy ||
      periodicityLabelsComputeBusy
    )
      return;
    setError(null);
    const dim0 = customerInboundDimension;
    const baseRows = analysisBase.rows;
    const meanPaths = listOrderIntervalMeanCellPathsTopDown(dim0);
    const total = meanPaths.length;
    if (total === 0) return;
    orderIntervalMeanInflightRef.current = true;
    setOrderIntervalMeanComputeSuccess(false);
    setOrderIntervalMeanProgress({ current: 0, total });
    setOrderIntervalMeanComputeBusy(true);
    let acc: CustomerInboundDimensionRow[] = dim0;
    let i = 0;
    const step = () => {
      if (i >= total) {
        orderIntervalMeanInflightRef.current = false;
        setOrderIntervalMeanProgress(null);
        setOrderIntervalMeanComputeBusy(false);
        if (
          !saveSalesForecastPersisted(preview, analysisBase, orderSegments, acc, {
            orderIntervalMeanComputeCompleted: true,
          })
        ) {
          setOrderIntervalMeanComputeSuccess(false);
          setError("订货间隔平均值已写入界面，但保存本地失败（可能超出浏览器配额）。");
        } else {
          setOrderIntervalMeanComputeSuccess(true);
        }
        return;
      }
      const p = meanPaths[i]!;
      acc = setOrderIntervalMeanOnDimension(acc, p, computeOrderIntervalMeanForCellPath(baseRows, p));
      setCustomerInboundDimension(acc);
      i += 1;
      setOrderIntervalMeanProgress({ current: i, total });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [
    customerInboundDimension,
    analysisBase,
    preview,
    orderSegments,
    orderSegmentsBusy,
    customerDimensionBusy,
    orderCountComputeBusy,
    orderIntervalStdDevComputeBusy,
    periodicityLabelsComputeBusy,
  ]);

  const onGeneratePeriodicityLabels = useCallback(() => {
    if (periodicityLabelsInflightRef.current) return;
    if (!customerInboundDimension?.length || !analysisBase?.rows.length || !preview) return;
    if (
      orderSegmentsBusy ||
      customerDimensionBusy ||
      orderCountComputeBusy ||
      orderIntervalStdDevComputeBusy ||
      orderIntervalMeanComputeBusy
    )
      return;
    setError(null);
    const dim0 = customerInboundDimension;
    const labelPaths = listOrderIntervalMeanCellPathsTopDown(dim0);
    const total = labelPaths.length;
    if (total === 0) return;
    periodicityLabelsInflightRef.current = true;
    setPeriodicityLabelsComputeSuccess(false);
    setPeriodicityLabelsProgress({ current: 0, total });
    setPeriodicityLabelsComputeBusy(true);
    let acc: CustomerInboundDimensionRow[] = dim0;
    let i = 0;
    const step = () => {
      if (i >= total) {
        periodicityLabelsInflightRef.current = false;
        setPeriodicityLabelsProgress(null);
        setPeriodicityLabelsComputeBusy(false);
        if (
          !saveSalesForecastPersisted(preview, analysisBase, orderSegments, acc, {
            periodicityLabelsComputeCompleted: true,
          })
        ) {
          setPeriodicityLabelsComputeSuccess(false);
          setError("周期性标签已写入界面，但保存本地失败（可能超出浏览器配额）。");
        } else {
          setPeriodicityLabelsComputeSuccess(true);
          setHideIrregularPatterns(true);
        }
        return;
      }
      const p = labelPaths[i]!;
      acc = setPeriodicityLabelOnDimension(acc, p, computePeriodicityLabelForPath(dim0, p));
      setCustomerInboundDimension(acc);
      i += 1;
      setPeriodicityLabelsProgress({ current: i, total });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [
    customerInboundDimension,
    analysisBase,
    preview,
    orderSegments,
    orderSegmentsBusy,
    customerDimensionBusy,
    orderCountComputeBusy,
    orderIntervalStdDevComputeBusy,
    orderIntervalMeanComputeBusy,
  ]);

  const analysisTableHeaders = useMemo(() => {
    if (orderSegments) {
      const base = [...SALES_ANALYSIS_BASE_HEADERS];
      base.splice(base.length - 1, 0, "进货量分类");
      return base;
    }
    return [...SALES_ANALYSIS_BASE_HEADERS];
  }, [orderSegments]);

  const { inboundPatternsStrong, inboundPatternsWeak, customerNamesWithPeriodicHighlight } = useMemo(() => {
    if (
      !periodicityLabelsComputeSuccess ||
      !customerInboundDimension?.length ||
      !analysisBase?.rows.length
    ) {
      return {
        inboundPatternsStrong: [] as InboundPeriodicityPatternItem[],
        inboundPatternsWeak: [] as InboundPeriodicityPatternItem[],
        customerNamesWithPeriodicHighlight: new Set<string>(),
      };
    }
    const all = listInboundPeriodicityPatterns(customerInboundDimension, analysisBase.rows);
    const strong: InboundPeriodicityPatternItem[] = [];
    const weak: InboundPeriodicityPatternItem[] = [];
    const customerNamesWithPeriodicHighlight = new Set<string>();
    for (const p of all) {
      customerNamesWithPeriodicHighlight.add(p.customerName);
      const first = p.periodicityLabel.trim().split("\n")[0]?.trim();
      if (first === "强周期性") strong.push(p);
      else if (first === "弱周期性") weak.push(p);
    }
    return { inboundPatternsStrong: strong, inboundPatternsWeak: weak, customerNamesWithPeriodicHighlight };
  }, [analysisBase, customerInboundDimension, periodicityLabelsComputeSuccess]);

  return (
    <div className="sales-forecast-page">
      <section className="card sales-forecast-main-card">
        <div className="card-head">
          <div>
            <h2>销售预测</h2>
            <p className="muted small">
              上传销售数据 CSV，点击保存后可在下方预览表格。首行将作为表头；支持双引号包裹含逗号的字段。
              <span className="sales-forecast-encoding-hint">
                编码：自动识别 UTF-8 与 Excel 常见的 GBK/GB18030，避免中文乱码。
              </span>
            </p>
          </div>
        </div>

        <div
          className="report-main-tabs sales-forecast-view-tabs"
          role="tablist"
          aria-label="销售预测视图"
        >
          <button
            type="button"
            role="tab"
            aria-selected={forecastViewTab === "user"}
            className={`report-main-tab${forecastViewTab === "user" ? " is-active" : ""}`}
            onClick={() => {
            setForecastViewTab("user");
            writeSalesForecastViewTab("user");
          }}
          >
            用户显示模式
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={forecastViewTab === "debug"}
            className={`report-main-tab${forecastViewTab === "debug" ? " is-active" : ""}`}
            onClick={() => {
            setForecastViewTab("debug");
            writeSalesForecastViewTab("debug");
          }}
          >
            调试显示模式
          </button>
        </div>

        {forecastViewTab === "user" && (
          <div className="sales-forecast-tab-panel" role="tabpanel" aria-label="用户显示模式">
            <p className="muted small sales-forecast-user-mode-hint">
              用户显示模式：对外精简视图将放在此 Tab。数据准备与完整调试请切换到「调试显示模式」。
            </p>
          </div>
        )}

        {forecastViewTab === "debug" && (
          <div
            className="sales-forecast-tab-panel sales-forecast-tab-panel--debug"
            role="tabpanel"
            aria-label="调试显示模式"
          >
            <div className="sales-forecast-upload-row">
              <input
                id={uploadId}
                type="file"
                className="sr-only"
                accept={CSV_ACCEPT}
                onChange={onPickFile}
              />
              <label htmlFor={uploadId} className="upload-label sales-forecast-file-label">
                <span className="upload-btn">选择 CSV 文件</span>
                <span className="muted tiny">
                  {pickedFile?.name ?? preview?.fileName ?? "未选择文件"}
                </span>
              </label>
              <button
                type="button"
                className="primary-btn"
                disabled={!pickedFile || busy}
                onClick={() => void onSave()}
              >
                {busy ? "读取中…" : "保存"}
              </button>
            </div>
            {error && (
              <p className="sales-forecast-error" role="alert">
                {error}
              </p>
            )}

            {preview && (
        <section className="card sales-data-preview-card">
          <div className="card-head tight sales-data-preview-card-head">
            <div className="sales-data-preview-card-head-left">
              <h3 className="sales-data-preview-title">销售数据预览</h3>
              <button
                type="button"
                className="ghost-btn tiny-btn sales-data-preview-fold-btn"
                onClick={() => setPreviewCollapsed((c) => !c)}
                aria-expanded={!previewCollapsed}
              >
                {previewCollapsed ? "展开预览" : "折叠预览"}
              </button>
            </div>
            <div className="sales-data-preview-card-head-actions">
              <button type="button" className="primary-btn sales-disassemble-btn" onClick={onDisassembleMaterial}>
                拆解物料记录
              </button>
            </div>
          </div>
          {previewCollapsed ? (
            <p className="muted small sales-data-preview-collapsed-hint">
              共 {preview.rows.length} 行数据（不含表头），表格已折叠。
            </p>
          ) : (
            <>
              <p className="muted small sales-data-preview-meta">
                共 {preview.rows.length} 行数据（不含表头）
              </p>
              <div className="table-wrap sales-data-preview-table-wrap">
                <table className="data-table sales-data-preview-table">
                  <thead>
                    <tr>
                      {preview.headers.map((h, hi) => (
                        <th key={hi}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="task-text-wrap">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {analysisBase && (
        <section className="card sales-analysis-base-card">
          <div className="card-head tight sales-analysis-base-card-head">
            <h3 className="sales-analysis-base-title">销售分析底表</h3>
            <div className="sales-analysis-base-card-actions">
              <button
                type="button"
                className="primary-btn sales-order-segment-btn"
                disabled={
                  orderSegmentsBusy ||
                  customerDimensionBusy ||
                  orderCountComputeBusy ||
                  orderIntervalStdDevComputeBusy ||
                  orderIntervalMeanComputeBusy ||
                  periodicityLabelsComputeBusy
                }
                aria-busy={orderSegmentsBusy}
                onClick={onGenerateOrderSegments}
              >
                <span className="sales-order-segment-btn-inner">
                  {orderSegmentsBusy && (
                    <span className="sales-order-segment-btn-spinner" aria-hidden />
                  )}
                  {orderSegmentsBusy ? "计算中…" : "生成数量分类"}
                </span>
              </button>
              <button
                type="button"
                className="primary-btn sales-order-segment-btn sales-customer-dim-btn"
                disabled={
                  orderSegmentsBusy ||
                  customerDimensionBusy ||
                  orderCountComputeBusy ||
                  orderIntervalStdDevComputeBusy ||
                  orderIntervalMeanComputeBusy ||
                  periodicityLabelsComputeBusy
                }
                aria-busy={customerDimensionBusy}
                onClick={onGenerateCustomerDimension}
              >
                <span className="sales-order-segment-btn-inner">
                  {customerDimensionBusy && (
                    <span className="sales-order-segment-btn-spinner" aria-hidden />
                  )}
                  {customerDimensionBusy ? "启动中…" : "启动进货周期性分析"}
                </span>
              </button>
            </div>
          </div>
          {analysisBase.missingHint && (
            <p className="muted small sales-analysis-base-hint" role="status">
              {analysisBase.missingHint}
            </p>
          )}
          <p className="muted small sales-data-preview-meta">
            共 {analysisBase.rows.length} 行。物料标签由「物料合并」结合物料编码/物料描述等列解析生成；日期←单据日期，客户名称←往来户名称，物料合并编码←物料合并。
          </p>
          <div className="table-wrap sales-data-preview-table-wrap">
            <table className="data-table sales-data-preview-table sales-analysis-base-table">
              <thead>
                <tr>
                  {analysisTableHeaders.map((h, hi) =>
                    h === "物料标签" ? (
                      <th key={hi} className="sales-analysis-base-th-material">
                        <div className="sales-analysis-base-th-material-inner">
                          <span className="sales-analysis-base-th-material-title">{h}</span>
                          <div
                            className="sales-material-tag-legend"
                            aria-label="物料标签颜色图例"
                          >
                            {MATERIAL_TAG_LEGEND.map(({ kind, caption }) => (
                              <span key={kind} className="sales-material-tag-legend-item">
                                <span
                                  className={`sales-material-tag sales-material-tag--${kind}`}
                                  aria-hidden
                                >
                                  ·
                                </span>
                                <span>{caption}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      </th>
                    ) : (
                      <th key={hi}>{h}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {analysisBase.rows.map((r, ri) => {
                  const seg =
                    orderSegments === null
                      ? null
                      : classifyOrderQuantityLabel(r.quantity, orderSegments.thresholds);
                  return (
                    <tr key={ri}>
                      <td className="task-text-wrap">{r.date}</td>
                      <td className="task-text-wrap">{r.customerName}</td>
                      <td className="task-text-wrap">{r.salesGroup}</td>
                      <td className="task-text-wrap">{r.salesperson}</td>
                      <td className="task-text-wrap sales-material-tags-cell">
                        {r.materialTags.length === 0 ? (
                          <span className="muted tiny">—</span>
                        ) : (
                          r.materialTags.map((t, ti) => (
                            <span
                              key={`${ri}-tag-${ti}-${t.text}`}
                              className={`sales-material-tag sales-material-tag--${t.kind}`}
                              title={t.kind === "source" ? "来源：CSV 物料标签列" : undefined}
                            >
                              {t.text}
                            </span>
                          ))
                        )}
                      </td>
                      <td className="task-text-wrap">{r.materialMergedCode}</td>
                      {orderSegments && (
                        <td className="task-text-wrap sales-order-qty-seg-cell">
                          {seg ? (
                            <span className={ORDER_QTY_SEG_TAG_CLASS[seg]}>{seg}</span>
                          ) : (
                            <span className="muted tiny">—</span>
                          )}
                        </td>
                      )}
                      <td className="task-text-wrap">{r.quantity}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {orderSegments && (
            <div className="sales-order-segment-panel" aria-label="数量分档阈值">
              <p className="muted small sales-order-segment-meta">
                分档规则：零散界为按单笔数量从小到大累计进货量达总量{" "}
                {orderSegments.segment_logic.fragmented_volume_contribution_pct}% 时的单笔数量；高价值界为按单笔数量从大到小累计进货量达总量{" "}
                {orderSegments.segment_logic.high_volume_contribution_pct}% 时的单笔数量（帕累托{" "}
                {orderSegments.segment_logic.high_volume_contribution_pct}%）。「低」介于两界之间；有效订单不足 10
                条时用均值比例估算。
              </p>
              <div className="sales-order-segment-charts">
                <div className="sales-order-segment-chart sales-order-segment-chart--fragmented">
                  <div className="sales-order-segment-chart-bar" aria-hidden />
                  <div className="sales-order-segment-chart-body">
                    <div className="sales-order-segment-chart-title">零散</div>
                    <div className="sales-order-segment-chart-rule">
                      单笔数量 &lt; {orderSegments.thresholds.fragmented_limit}
                    </div>
                    <div className="sales-order-segment-chart-threshold">
                      阈值 <strong>{orderSegments.thresholds.fragmented_limit}</strong>
                    </div>
                  </div>
                </div>
                <div className="sales-order-segment-chart sales-order-segment-chart--low">
                  <div className="sales-order-segment-chart-bar" aria-hidden />
                  <div className="sales-order-segment-chart-body">
                    <div className="sales-order-segment-chart-title">低</div>
                    <div className="sales-order-segment-chart-rule">
                      {orderSegments.thresholds.fragmented_limit} ≤ 单笔 ≤ {orderSegments.thresholds.high_limit}
                    </div>
                    <div className="sales-order-segment-chart-threshold">
                      区间{" "}
                      <strong>
                        {orderSegments.thresholds.fragmented_limit} — {orderSegments.thresholds.high_limit}
                      </strong>
                    </div>
                  </div>
                </div>
                <div className="sales-order-segment-chart sales-order-segment-chart--high">
                  <div className="sales-order-segment-chart-bar" aria-hidden />
                  <div className="sales-order-segment-chart-body">
                    <div className="sales-order-segment-chart-title">高</div>
                    <div className="sales-order-segment-chart-rule">
                      单笔数量 &gt; {orderSegments.thresholds.high_limit}
                    </div>
                    <div className="sales-order-segment-chart-threshold">
                      阈值 <strong>{orderSegments.thresholds.high_limit}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {customerInboundDimension !== null && analysisBase && (
        <>
        <section className="card sales-customer-inbound-dimension-card">
          <div className="card-head tight sales-customer-inbound-dim-head">
            <div className="sales-customer-inbound-dim-head-left">
              <h3 className="sales-customer-inbound-dim-title">客户进货周期性分析</h3>
              <button
                type="button"
                className="ghost-btn tiny-btn sales-customer-inbound-fold-btn"
                onClick={() => setCustomerInboundCardCollapsed((c) => !c)}
                aria-expanded={!customerInboundCardCollapsed}
              >
                {customerInboundCardCollapsed ? "展开分析" : "折叠分析"}
              </button>
              {periodicityLabelsComputeSuccess && (
                <label className="sales-customer-dim-hide-irregular-label">
                  <input
                    type="checkbox"
                    className="sales-customer-dim-hide-irregular-input"
                    checked={hideIrregularPatterns}
                    onChange={(e) => setHideIrregularPatterns(e.target.checked)}
                  />
                  <span>隐藏不规则模式</span>
                </label>
              )}
            </div>
            <div className="sales-customer-inbound-dim-actions">
              <button
                type="button"
                className={[
                  "ghost-btn",
                  "tiny-btn",
                  "sales-order-count-compute-btn",
                  orderCountComputeBusy ? "sales-order-count-compute-btn--running" : "",
                  !orderCountComputeBusy && orderCountComputeSuccess
                    ? "sales-order-count-compute-btn--done"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={
                  orderCountComputeBusy ||
                  orderIntervalStdDevComputeBusy ||
                  orderIntervalMeanComputeBusy ||
                  periodicityLabelsComputeBusy ||
                  orderSegmentsBusy ||
                  customerDimensionBusy ||
                  !analysisBase?.rows.length
                }
                aria-busy={orderCountComputeBusy}
                aria-label={
                  orderCountComputeBusy && orderCountProgress
                    ? `计算下单次数进度 ${orderCountProgress.current} / ${orderCountProgress.total}`
                    : "计算下单次数"
                }
                onClick={onComputeOrderCounts}
              >
                <span className="sales-order-count-compute-btn-inner">
                  {orderCountComputeBusy && <span className="sales-order-count-compute-btn-spinner" aria-hidden />}
                  <span className="sales-order-count-compute-btn-label">
                    {orderCountComputeBusy
                      ? orderCountProgress
                        ? `计算中 ${orderCountProgress.current}/${orderCountProgress.total}`
                        : "计算中…"
                      : "计算下单次数"}
                  </span>
                </span>
                {orderCountComputeBusy && orderCountProgress && orderCountProgress.total > 0 && (
                  <span className="sales-order-count-compute-btn-track" aria-hidden>
                    <span
                      className="sales-order-count-compute-btn-fill"
                      style={{
                        width: `${(orderCountProgress.current / orderCountProgress.total) * 100}%`,
                      }}
                    />
                  </span>
                )}
              </button>
              <button
                type="button"
                className={[
                  "ghost-btn",
                  "tiny-btn",
                  "sales-order-count-compute-btn",
                  orderIntervalStdDevComputeBusy ? "sales-order-count-compute-btn--running" : "",
                  !orderIntervalStdDevComputeBusy && orderIntervalStdDevComputeSuccess
                    ? "sales-order-count-compute-btn--done"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={
                  orderCountComputeBusy ||
                  orderIntervalStdDevComputeBusy ||
                  orderIntervalMeanComputeBusy ||
                  periodicityLabelsComputeBusy ||
                  orderSegmentsBusy ||
                  customerDimensionBusy ||
                  !analysisBase?.rows.length
                }
                aria-busy={orderIntervalStdDevComputeBusy}
                aria-label={
                  orderIntervalStdDevComputeBusy && orderIntervalStdDevProgress
                    ? `计算订货间隔标准差进度 ${orderIntervalStdDevProgress.current} / ${orderIntervalStdDevProgress.total}`
                    : "计算订货间隔标准差"
                }
                onClick={onComputeOrderIntervalStdDev}
              >
                <span className="sales-order-count-compute-btn-inner">
                  {orderIntervalStdDevComputeBusy && (
                    <span className="sales-order-count-compute-btn-spinner" aria-hidden />
                  )}
                  <span className="sales-order-count-compute-btn-label">
                    {orderIntervalStdDevComputeBusy
                      ? orderIntervalStdDevProgress
                        ? `计算中 ${orderIntervalStdDevProgress.current}/${orderIntervalStdDevProgress.total}`
                        : "计算中…"
                      : "计算订货间隔标准差"}
                  </span>
                </span>
                {orderIntervalStdDevComputeBusy &&
                  orderIntervalStdDevProgress &&
                  orderIntervalStdDevProgress.total > 0 && (
                    <span className="sales-order-count-compute-btn-track" aria-hidden>
                      <span
                        className="sales-order-count-compute-btn-fill"
                        style={{
                          width: `${(orderIntervalStdDevProgress.current / orderIntervalStdDevProgress.total) * 100}%`,
                        }}
                      />
                    </span>
                  )}
              </button>
              <button
                type="button"
                className={[
                  "ghost-btn",
                  "tiny-btn",
                  "sales-order-count-compute-btn",
                  orderIntervalMeanComputeBusy ? "sales-order-count-compute-btn--running" : "",
                  !orderIntervalMeanComputeBusy && orderIntervalMeanComputeSuccess
                    ? "sales-order-count-compute-btn--done"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={
                  orderCountComputeBusy ||
                  orderIntervalStdDevComputeBusy ||
                  orderIntervalMeanComputeBusy ||
                  periodicityLabelsComputeBusy ||
                  orderSegmentsBusy ||
                  customerDimensionBusy ||
                  !analysisBase?.rows.length
                }
                aria-busy={orderIntervalMeanComputeBusy}
                aria-label={
                  orderIntervalMeanComputeBusy && orderIntervalMeanProgress
                    ? `计算订货间隔平均值进度 ${orderIntervalMeanProgress.current} / ${orderIntervalMeanProgress.total}`
                    : "计算订货间隔平均值"
                }
                onClick={onComputeOrderIntervalMean}
              >
                <span className="sales-order-count-compute-btn-inner">
                  {orderIntervalMeanComputeBusy && (
                    <span className="sales-order-count-compute-btn-spinner" aria-hidden />
                  )}
                  <span className="sales-order-count-compute-btn-label">
                    {orderIntervalMeanComputeBusy
                      ? orderIntervalMeanProgress
                        ? `计算中 ${orderIntervalMeanProgress.current}/${orderIntervalMeanProgress.total}`
                        : "计算中…"
                      : "计算订货间隔平均值"}
                  </span>
                </span>
                {orderIntervalMeanComputeBusy &&
                  orderIntervalMeanProgress &&
                  orderIntervalMeanProgress.total > 0 && (
                    <span className="sales-order-count-compute-btn-track" aria-hidden>
                      <span
                        className="sales-order-count-compute-btn-fill"
                        style={{
                          width: `${(orderIntervalMeanProgress.current / orderIntervalMeanProgress.total) * 100}%`,
                        }}
                      />
                    </span>
                  )}
              </button>
              <button
                type="button"
                className={[
                  "ghost-btn",
                  "tiny-btn",
                  "sales-order-count-compute-btn",
                  periodicityLabelsComputeBusy ? "sales-order-count-compute-btn--running" : "",
                  !periodicityLabelsComputeBusy && periodicityLabelsComputeSuccess
                    ? "sales-order-count-compute-btn--done"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={
                  orderCountComputeBusy ||
                  orderIntervalStdDevComputeBusy ||
                  orderIntervalMeanComputeBusy ||
                  periodicityLabelsComputeBusy ||
                  orderSegmentsBusy ||
                  customerDimensionBusy ||
                  !analysisBase?.rows.length
                }
                aria-busy={periodicityLabelsComputeBusy}
                aria-label={
                  periodicityLabelsComputeBusy && periodicityLabelsProgress
                    ? `生成周期性标签进度 ${periodicityLabelsProgress.current} / ${periodicityLabelsProgress.total}`
                    : "生成周期性标签"
                }
                onClick={onGeneratePeriodicityLabels}
              >
                <span className="sales-order-count-compute-btn-inner">
                  {periodicityLabelsComputeBusy && (
                    <span className="sales-order-count-compute-btn-spinner" aria-hidden />
                  )}
                  <span className="sales-order-count-compute-btn-label">
                    {periodicityLabelsComputeBusy
                      ? periodicityLabelsProgress
                        ? `计算中 ${periodicityLabelsProgress.current}/${periodicityLabelsProgress.total}`
                        : "计算中…"
                      : "生成周期性标签"}
                  </span>
                </span>
                {periodicityLabelsComputeBusy &&
                  periodicityLabelsProgress &&
                  periodicityLabelsProgress.total > 0 && (
                    <span className="sales-order-count-compute-btn-track" aria-hidden>
                      <span
                        className="sales-order-count-compute-btn-fill"
                        style={{
                          width: `${(periodicityLabelsProgress.current / periodicityLabelsProgress.total) * 100}%`,
                        }}
                      />
                    </span>
                  )}
              </button>
            </div>
          </div>
          {customerInboundCardCollapsed ? (
            <p className="muted small sales-customer-inbound-collapsed-hint" role="status">
              已折叠：共 {customerInboundDimension.length} 个客户（按名称去重）。点击「展开分析」查看说明与层级树；上方各计算/生成按钮仍可用。
            </p>
          ) : (
            <>
          <p className="muted small sales-data-preview-meta">
            共 {customerInboundDimension.length} 个客户（按客户名称去重）。本分析结果与底表一并写入本机浏览器
            <strong>localStorage</strong>，刷新或切换应用内页面后仍保留。点击「启动进货周期性分析」后会<strong>默认展开</strong>
            全部客户。卡片顶部为<strong>总体</strong>；下方为按底表扫描得到的<strong>型号 → 品名 → 规格 → 克重</strong>
            层级视图（仅包含有订货记录的组合）；<strong>型号、品名、规格</strong>左侧三角仅折叠/展开<strong>下级</strong>，当前行五列指标始终显示；克重为最末级无下钻。「计算下单次数」分两轮：先对底表逐克重行计数，再自底向上将规格/品名/型号/客户依次写为「直接下级的下单次数加总」；订货间隔等仍按原逻辑。各计算/生成按钮会写入各级对应单元格。
          </p>
          <div className="sales-customer-dim-tree" role="tree" aria-label="客户进货周期性分析层级树">
            {customerInboundDimension.map((row) => {
              const expanded = openCustomerDimIds.has(row.customerName);
              const applyHideIrreg =
                periodicityLabelsComputeSuccess && hideIrregularPatterns;
              const visibleModels = filterCustomerModelsForHideIrregular(
                row.models,
                applyHideIrreg,
              );
              const listEmptyByFilter =
                applyHideIrreg && row.models.length > 0 && visibleModels.length === 0;
              const hideTotalMetrics =
                applyHideIrreg && isIrregularPatternPeriodicity(row.periodicityLabel);
              /** 与「进货周期性模式挖掘」同源：该客户在树中任一路径（含总体）被纳入强/弱挖掘结果 */
              const showPeriodicDiscoveryHighlight = customerNamesWithPeriodicHighlight.has(row.customerName);
              return (
                <div
                  key={row.customerName}
                  className={`sales-customer-dim-block${expanded ? " is-open" : ""}`}
                  role="treeitem"
                  aria-expanded={expanded}
                >
                  <div className="sales-customer-dim-block-shell">
                    <div className="sales-customer-dim-level-card sales-customer-dim-level-card--total">
                      <div className="sales-customer-dim-level-line">
                        <div className="sales-customer-dim-level-tree">
                          <button
                            type="button"
                            className="sales-customer-dim-block-toggle"
                            onClick={() => toggleCustomerDimOpen(row.customerName)}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "收起" : "展开"}客户「${row.customerName}」的型号下钻`}
                          >
                            <span className="sales-customer-dim-block-chevron" aria-hidden>
                              {expanded ? "▲" : "▼"}
                            </span>
                            <span className="sales-customer-dim-block-name">
                              <CustomerDimLabelIcon kind="customer" />
                              <span className="sales-customer-dim-block-dim-label">客户</span>
                              <span className="sales-customer-dim-block-name-value">{row.customerName}</span>
                              {showPeriodicDiscoveryHighlight ? (
                                <span
                                  className="sales-customer-dim-discovered-periodic-pill"
                                  aria-label="该客户在分析树中存在强周期性或弱周期性（与进货周期性模式挖掘一致）"
                                >
                                  发现周期性
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </div>
                        <div className="sales-customer-dim-level-metric-wrap">
                          {!hideTotalMetrics ? (
                            <CustomerDimMetricGrid
                              lastOrderDate={row.lastOrderDate}
                              orderCount={row.orderCount}
                              orderIntervalStdDev={row.orderIntervalStdDev}
                              orderIntervalMean={row.orderIntervalMean}
                              periodicityLabel={row.periodicityLabel}
                              alignStrip
                            />
                          ) : (
                            <div
                              className="sales-customer-dim-irregular-hidden-metric"
                              role="note"
                            >
                              <span className="muted small">总体为不规则，已按开关隐藏</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {expanded && (
                    <CustomerDimensionModelTree
                      customerName={row.customerName}
                      models={visibleModels}
                      listEmptyByFilter={listEmptyByFilter}
                    />
                  )}
                </div>
              );
            })}
          </div>
            </>
          )}
        </section>
        <section
          className="card sales-inbound-periodicity-pattern-card"
          aria-label="进货周期性模式挖掘"
        >
          <div className="card-head tight sales-inbound-pattern-head">
            <h3 className="sales-inbound-pattern-title">进货周期性模式挖掘</h3>
          </div>
          {!periodicityLabelsComputeSuccess ? (
            <p className="muted small sales-inbound-pattern-hint">
              请先在「客户进货周期性分析」中完成「生成周期性标签」；全部生成完成后，此处会列出主标签为「强周期性」或「弱周期性」的节点，并补全预计下次下单与平均量等。
            </p>
          ) : inboundPatternsStrong.length === 0 && inboundPatternsWeak.length === 0 ? (
            <p className="muted small sales-inbound-pattern-hint">
              当前没有主标签为「强周期性」或「弱周期性」的节点（可能均为「不规则」或未标注）。
            </p>
          ) : (
            <div className="sales-inbound-pattern-buckets">
              <div
                className="sales-inbound-pattern-bucket sales-inbound-pattern-bucket--strong"
                aria-label="强进货周期模式"
              >
                <div className="sales-inbound-pattern-bucket-head">
                  <button
                    type="button"
                    className="sales-inbound-pattern-bucket-toggle"
                    onClick={() => setInboundPatternStrongSectionOpen((o) => !o)}
                    aria-expanded={inboundPatternStrongSectionOpen}
                    id="inbound-pattern-strong-section-toggle"
                  >
                    <span className="sales-inbound-pattern-bucket-chevron" aria-hidden>
                      {inboundPatternStrongSectionOpen ? "▼" : "▶"}
                    </span>
                    <span className="sales-inbound-pattern-bucket-title">强进货周期模式</span>
                    <span className="sales-inbound-pattern-bucket-count" aria-hidden>
                      （{inboundPatternsStrong.length}）
                    </span>
                  </button>
                </div>
                {inboundPatternStrongSectionOpen ? (
                  inboundPatternsStrong.length === 0 ? (
                    <p className="muted small sales-inbound-pattern-bucket-empty" role="status">
                      暂无强周期性模式。
                    </p>
                  ) : (
                    <div
                      className="sales-inbound-pattern-list"
                      role="list"
                      aria-labelledby="inbound-pattern-strong-section-toggle"
                    >
                      {inboundPatternsStrong.map((p) => (
                        <InboundPatternSubcardView key={p.key} p={p} />
                      ))}
                    </div>
                  )
                ) : null}
              </div>
              <div
                className="sales-inbound-pattern-bucket sales-inbound-pattern-bucket--weak"
                aria-label="弱进货周期模式"
              >
                <div className="sales-inbound-pattern-bucket-head">
                  <button
                    type="button"
                    className="sales-inbound-pattern-bucket-toggle"
                    onClick={() => setInboundPatternWeakSectionOpen((o) => !o)}
                    aria-expanded={inboundPatternWeakSectionOpen}
                    id="inbound-pattern-weak-section-toggle"
                  >
                    <span className="sales-inbound-pattern-bucket-chevron" aria-hidden>
                      {inboundPatternWeakSectionOpen ? "▼" : "▶"}
                    </span>
                    <span className="sales-inbound-pattern-bucket-title">弱进货周期模式</span>
                    <span className="sales-inbound-pattern-bucket-count" aria-hidden>
                      （{inboundPatternsWeak.length}）
                    </span>
                  </button>
                </div>
                {inboundPatternWeakSectionOpen ? (
                  inboundPatternsWeak.length === 0 ? (
                    <p className="muted small sales-inbound-pattern-bucket-empty" role="status">
                      暂无弱周期性模式。
                    </p>
                  ) : (
                    <div
                      className="sales-inbound-pattern-list"
                      role="list"
                      aria-labelledby="inbound-pattern-weak-section-toggle"
                    >
                      {inboundPatternsWeak.map((p) => (
                        <InboundPatternSubcardView key={p.key} p={p} />
                      ))}
                    </div>
                  )
                ) : null}
              </div>
            </div>
          )}
        </section>
        </>
      )}
          </div>
        )}
      </section>
    </div>
  );
}
