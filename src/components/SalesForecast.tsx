/**
 * @fileoverview 销售预测：上传销售数据 CSV，保存后表格预览。
 *
 * @module SalesForecast
 */

import { type ChangeEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  calculateOrderSegments,
  classifyOrderQuantityLabel,
  type OrderSegmentLabel,
  type OrderSegmentResult,
} from "../utils/calculateOrderSegments";
import { decodeTextBytesAuto } from "../utils/decodeTextBytesAuto";
import { parseCsvText } from "../utils/parseCsvText";
import { MATERIAL_TAG_LEGEND } from "../utils/parseMaterialCode";
import {
  buildSalesAnalysisBaseFromPreview,
  SALES_ANALYSIS_BASE_HEADERS,
  type SalesAnalysisBaseRow,
} from "../utils/salesAnalysisBaseFromPreview";
import { loadSalesForecastPersisted, saveSalesForecastPersisted } from "../utils/salesForecastStorage";

const CSV_ACCEPT = ".csv,text/csv";

const ORDER_QTY_SEG_TAG_CLASS: Record<OrderSegmentLabel, string> = {
  高: "sales-order-qty-seg-tag sales-order-qty-seg-tag--high",
  低: "sales-order-qty-seg-tag sales-order-qty-seg-tag--low",
  零散: "sales-order-qty-seg-tag sales-order-qty-seg-tag--fragmented",
};

function readInitialSalesForecastState(): {
  preview: { headers: string[]; rows: string[][]; fileName: string } | null;
  analysisBase: { rows: SalesAnalysisBaseRow[]; missingHint: string | null } | null;
  orderSegments: OrderSegmentResult | null;
} {
  const stored = loadSalesForecastPersisted();
  if (!stored) return { preview: null, analysisBase: null, orderSegments: null };
  return {
    preview: stored.preview,
    analysisBase: stored.analysisBase,
    orderSegments: stored.orderSegments ?? null,
  };
}

export function SalesForecast() {
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

  useEffect(() => {
    if (!analysisBase) setOrderSegments(null);
  }, [analysisBase]);

  const onPickFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setError(null);
    setPreview(null);
    setAnalysisBase(null);
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
          setError("读取结果异常。");
          return;
        }
        const text = decodeTextBytesAuto(buf);
        const matrix = parseCsvText(text);
        if (matrix.length === 0) {
          setPreview(null);
          setAnalysisBase(null);
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
        const nextPreview = { headers, rows: normalized, fileName: pickedFile.name };
        setAnalysisBase(null);
        setPreview(nextPreview);
        if (!saveSalesForecastPersisted(nextPreview, null, null)) {
          setError("数据已显示，但写入本地存储失败（可能超出浏览器配额）。刷新后可能无法恢复。");
        }
      } catch (err) {
        setPreview(null);
        setAnalysisBase(null);
        setError(err instanceof Error ? err.message : "解析 CSV 失败。");
      }
    };
    reader.onerror = () => {
      setBusy(false);
      setPreview(null);
      setAnalysisBase(null);
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
    if (!saveSalesForecastPersisted(preview, nextAnalysis, null)) {
      setError("底表已生成，但写入本地存储失败（可能超出浏览器配额）。刷新后可能无法恢复底表。");
    }
  }, [preview]);

  const onGenerateOrderSegments = useCallback(() => {
    if (!analysisBase?.rows.length || !preview) return;
    setError(null);
    setOrderSegmentsBusy(true);
    const quantities = analysisBase.rows.map((r) => r.quantity);
    const snapshotAnalysis = analysisBase;
    const snapshotPreview = preview;
    window.setTimeout(() => {
      try {
        const result = calculateOrderSegments(quantities);
        const { fragmented_limit: fl, high_limit: hl } = result.thresholds;
        if (fl === 0 && hl === 0) {
          setOrderSegments(null);
          void saveSalesForecastPersisted(snapshotPreview, snapshotAnalysis, null);
          setError("数量列中没有可用的正数，无法生成分类阈值。");
          return;
        }
        setOrderSegments(result);
        if (!saveSalesForecastPersisted(snapshotPreview, snapshotAnalysis, result)) {
          setError("分类已生成，但写入本地存储失败（可能超出浏览器配额）。刷新后可能无法恢复分类。");
        }
      } finally {
        setOrderSegmentsBusy(false);
      }
    }, 0);
  }, [analysisBase, preview]);

  const analysisTableHeaders = useMemo(() => {
    if (orderSegments) {
      const base = [...SALES_ANALYSIS_BASE_HEADERS];
      base.splice(base.length - 1, 0, "进货量分类");
      return base;
    }
    return [...SALES_ANALYSIS_BASE_HEADERS];
  }, [orderSegments]);

  return (
    <div className="sales-forecast-page">
      <section className="card">
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
      </section>

      {preview && (
        <section className="card sales-data-preview-card">
          <div className="card-head tight sales-data-preview-card-head">
            <h3 className="sales-data-preview-title">销售数据预览</h3>
            <button type="button" className="primary-btn sales-disassemble-btn" onClick={onDisassembleMaterial}>
              拆解物料记录
            </button>
          </div>
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
        </section>
      )}

      {analysisBase && (
        <section className="card sales-analysis-base-card">
          <div className="card-head tight sales-analysis-base-card-head">
            <h3 className="sales-analysis-base-title">销售分析底表</h3>
            <button
              type="button"
              className="primary-btn sales-order-segment-btn"
              disabled={orderSegmentsBusy}
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
    </div>
  );
}
