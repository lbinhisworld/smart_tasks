/**
 * 数据看板 · 销售 Tab「复购预测」：按预计下次进货日由近及远的时间线与模式卡片。
 */

import { useEffect, useState } from "react";
import type { InboundPeriodicityPatternItem } from "../utils/inboundPeriodicityPatternMining";
import {
  buildRepurchaseForecastTimeline,
  type RepurchaseTimelineCardModel,
} from "../utils/repurchaseForecastTimeline";

/** 吨：中文千分位 + 两位小数 */
function formatRepurchaseForecastTons(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ProductParamTags({ item }: { item: InboundPeriodicityPatternItem }) {
  return (
    <div
      className="sales-material-tags-cell sales-inbound-pattern-materials repurchase-card-params"
      role="group"
      aria-label="采购产品参数"
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

function RepurchasePatternCard({ card }: { card: RepurchaseTimelineCardModel }) {
  const { item, strength, qtyDisplay } = card;
  const theme = strength === "strong" ? "strong" : "weak";
  const typeLabel = strength === "strong" ? "强进货周期" : "弱进货周期";

  return (
    <div
      className={`repurchase-card repurchase-card--${theme}`}
      role="listitem"
      data-repurchase-strength={theme}
    >
      <div className="repurchase-card-head">
        <span className={`repurchase-card-type-badge repurchase-card-type-badge--${theme}`}>{typeLabel}</span>
      </div>
      <div className="repurchase-card-body">
        <div className="repurchase-card-row">
          <span className="repurchase-card-dt">客户</span>
          <span className="repurchase-card-dd task-text-wrap">{item.customerName}</span>
        </div>
        <div className="repurchase-card-row repurchase-card-row--params">
          <span className="repurchase-card-dt">采购产品参数</span>
          <div className="repurchase-card-dd">
            <ProductParamTags item={item} />
          </div>
        </div>
        <div className="repurchase-card-row">
          <span className="repurchase-card-dt">预计采购量</span>
          <span className="repurchase-card-dd repurchase-card-qty">{qtyDisplay}</span>
        </div>
      </div>
    </div>
  );
}

export function RepurchaseForecastPanel() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const onSf = () => setTick((t) => t + 1);
    window.addEventListener("storage", onSf);
    const onFocus = () => setTick((t) => t + 1);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onSf);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const built = buildRepurchaseForecastTimeline();
  void tick;

  if (!built.ok) {
    return (
      <div className="repurchase-forecast-panel">
        <p className="muted small repurchase-forecast-empty" role="status">
          {built.reason}
        </p>
      </div>
    );
  }

  const totalStrongForecastTon = built.buckets.reduce((s, b) => s + b.strongForecastQtySumTon, 0);
  const totalWeakForecastTon = built.buckets.reduce((s, b) => s + b.weakForecastMinVolumeSumTon, 0);
  const strongTonLabel = formatRepurchaseForecastTons(totalStrongForecastTon);
  const weakTonLabel = formatRepurchaseForecastTons(totalWeakForecastTon);

  return (
    <div className="repurchase-forecast-panel">
      <p className="muted small repurchase-forecast-intro">
        以下由「销售预测 → 进货周期性模式挖掘」中强/弱周期模式的<strong>预计下次下单日期</strong>汇总，按日期由近及远排列；预计采购量来自已保存的强/弱周期「预测下一次下单量」结果。
      </p>
      <div
        className="repurchase-forecast-totals kpi-grid"
        role="region"
        aria-label={`复购预测时间线合计：强预测采购量 ${strongTonLabel} 吨，弱预测采购量 ${weakTonLabel} 吨`}
      >
        <div className="kpi-card kpi-green repurchase-forecast-total-card">
          <div className="kpi-title">强预测采购量</div>
          <div className="kpi-value repurchase-forecast-total-value">
            <span className="repurchase-forecast-total-value-num repurchase-forecast-total-value-num--strong">
              {strongTonLabel}
            </span>
            <span className="repurchase-forecast-total-unit">吨</span>
          </div>
          <div className="kpi-meta muted tiny">时间线各日期强预测之和</div>
        </div>
        <div className="kpi-card kpi-blue repurchase-forecast-total-card">
          <div className="kpi-title">弱预测采购量</div>
          <div className="kpi-value repurchase-forecast-total-value">
            <span className="repurchase-forecast-total-value-num repurchase-forecast-total-value-num--weak">
              {weakTonLabel}
            </span>
            <span className="repurchase-forecast-total-unit">吨</span>
          </div>
          <div className="kpi-meta muted tiny">时间线各日期弱预测之和</div>
        </div>
      </div>
      <div className="repurchase-timeline" role="list" aria-label="复购预测时间线">
        {built.buckets.map((bucket) => {
          const strongTon = bucket.strongForecastQtySumTon;
          const weakTon = bucket.weakForecastMinVolumeSumTon;
          const showStrongForecast = strongTon > 0;
          const showWeakForecast = weakTon > 0;
          const summaryAriaParts = [
            bucket.dateLabel,
            showStrongForecast ? `强预测采购量 ${strongTon.toFixed(2)} 吨` : null,
            showWeakForecast ? `弱预测采购量 ${weakTon.toFixed(2)} 吨` : null,
          ].filter(Boolean);
          return (
          <details key={bucket.dateLabel} className="repurchase-timeline-node" open>
            <summary
              className="repurchase-timeline-summary"
              aria-label={summaryAriaParts.join("，")}
            >
              <span className="repurchase-timeline-dot" aria-hidden />
              <span className="repurchase-timeline-date">{bucket.dateLabel}</span>
              {showStrongForecast ? (
                <span className="repurchase-timeline-summary-forecast">
                  强预测采购量{" "}
                  <span className="repurchase-timeline-summary-forecast-strong-num">
                    {strongTon.toFixed(2)}
                  </span>{" "}
                  吨
                </span>
              ) : null}
              {showWeakForecast ? (
                <span className="repurchase-timeline-summary-forecast">
                  弱预测采购量{" "}
                  <span className="repurchase-timeline-summary-forecast-weak-num">
                    {weakTon.toFixed(2)}
                  </span>{" "}
                  吨
                </span>
              ) : null}
              <span className="repurchase-timeline-count muted tiny">{bucket.cards.length} 条</span>
            </summary>
            <div className="repurchase-timeline-cards">
              {bucket.cards.map((card) => (
                <RepurchasePatternCard key={card.key} card={card} />
              ))}
            </div>
          </details>
          );
        })}
      </div>
    </div>
  );
}
