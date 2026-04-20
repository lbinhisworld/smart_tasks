/**
 * @fileoverview 报告管理页：双 Tab「报告提取」（上传/解析/预览；预览区展示提取结果，中台路径下为多张可折叠「日期-分公司」卡）与「提取历史」（时间线、导入导出、导出原始报告）；处理从看板跳转的焦点与高亮并切至历史 Tab。
 *
 * **设计要点**
 * - `consumeExtractionFocusFromStorage`：挂载时 `useLayoutEffect` 读一次；另监听 `OPEN_REPORTS_PAGE_EVENT`，在报告页已挂载时也能消费看板「跳转原文」写入的 `sessionStorage`。
 * - 提取日期优先从正文 `extractDateFromPlainText`，否则 `formatExtractionDate()`，与 `normalizeProductionReportJson` 对齐。
 * - 监听 `LLM_CONFIG_CHANGED_EVENT` 仅用于 bump 内部 epoch，触发依赖 `readLlmEnv()` 的 UI 重算。
 *
 * @module ReportManagement
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useTasks } from "../context/TaskContext";
import { REPORT_EXTRACTION_USER_INSTRUCTION } from "../constants/reportExtractionPrompt";
import type { DataPlatform, ExternalApiProfile } from "../types/externalApiProfile";
import type { ExtractionHistoryItem, LlmCallStats } from "../types/extractionHistory";
import {
  appendExtractionHistory,
  loadExtractionHistory,
  parseImportedExtractionHistory,
  removeExtractionHistoryItem,
  replaceExtractionHistory,
} from "../utils/extractionHistoryStorage";
import { buildTimelineGroups } from "../utils/extractionHistoryGroup";
import { downloadOriginalReportsJsonFile } from "../utils/downloadOriginalReportsJson";
import { extractDateFromPlainText } from "../utils/extractDateFromText";
import { buildReportPreviewTasksSingle } from "../utils/buildReportPreviewTasks";
import { buildExtractionHistoryTitle } from "../utils/extractionHistoryTitle";
import {
  tryParseDataHubDailyListJson,
  type HubDailyStandardRow,
} from "../utils/extractDataHubDailyList";
import {
  clearReportExtractionPreviewDraft,
  loadReportExtractionPreviewDraft,
  saveReportExtractionPreviewDraft,
  type StoredHubBranchParse as HubBranchParse,
} from "../utils/reportExtractionPreviewDraft";
import { formatLlmStatsParts } from "../utils/formatLlmStats";
import { extractTextFromFile } from "../utils/extractFileText";
import { buildPendingTasksFromSavedReport } from "../utils/buildPendingTasksFromSavedReport";
import { buildQuantitativeMetricCitations } from "../utils/quantitativeMetricCitations";
import { EXTRACTION_FOCUS_STORAGE_KEY, OPEN_REPORTS_PAGE_EVENT } from "../utils/reportCitation";
import { extractionHistoryVisibleForPerspective } from "../utils/leaderPerspective";
import { loadCleanedJsonFromSession } from "../utils/dataHubCleanedJsonStorage";
import { loadDataHubState } from "../utils/externalApiStorage";
import { loadDataSyncLastBody } from "../utils/dataSyncResponseStorage";
import {
  callProductionReportExtraction,
  formatExtractionDate,
  LLM_CONFIG_CHANGED_EVENT,
  normalizeProductionReportJson,
  parseJsonSafe,
  readLlmEnv,
} from "../utils/llmExtract";
import { ExtractionHistoryList } from "./ExtractionHistoryList";
import { ReportJsonPreview } from "./ReportJsonPreview";

type Phase = "idle" | "reading" | "calling" | "done" | "error";

type ReportMgmtTab = "extract" | "history";

function aggregateLlmStats(parts: LlmCallStats[]): LlmCallStats | null {
  if (parts.length === 0) return null;
  const sum = (get: (p: LlmCallStats) => number | null) =>
    parts.reduce((a, p) => a + (get(p) ?? 0), 0);
  const models = [...new Set(parts.map((p) => p.model))];
  return {
    model: models.length === 1 ? models[0]! : models.join(" + "),
    inputTokens: sum((p) => p.inputTokens),
    outputTokens: sum((p) => p.outputTokens),
    totalTokens: sum((p) => p.totalTokens),
    durationMs: sum((p) => p.durationMs),
  };
}

/** 懒加载于 `App` 的「报告」路由；双 Tab：报告提取 / 提取历史。 */
export function ReportManagement() {
  const { user } = useTasks();
  const [reportMgmtTab, setReportMgmtTab] = useState<ReportMgmtTab>("extract");
  const inputId = useId();
  const importHistoryInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importHistoryInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [manualText, setManualText] = useState("");
  const [extracted, setExtracted] = useState<{ text: string; note?: string } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [rawModel, setRawModel] = useState<string | null>(null);
  const [parsed, setParsed] = useState<unknown | null>(null);
  const [llmCallStats, setLlmCallStats] = useState<LlmCallStats | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [history, setHistory] = useState<ExtractionHistoryItem[]>(() => loadExtractionHistory());
  const historyRef = useRef(history);
  const [citationsRefreshing, setCitationsRefreshing] = useState(false);
  const citationsRefreshGuardRef = useRef(false);
  const [extractionFocus, setExtractionFocus] = useState<{ id: string; needle: string } | null>(null);
  const [, setConfigEpoch] = useState(0);

  const [dataHubModalOpen, setDataHubModalOpen] = useState(false);
  const [hubPlatforms, setHubPlatforms] = useState<DataPlatform[]>([]);
  const [hubProfiles, setHubProfiles] = useState<ExternalApiProfile[]>([]);
  const [hubPlatformId, setHubPlatformId] = useState("");
  const [hubProfileId, setHubProfileId] = useState("");
  const [dataHubImportInfo, setDataHubImportInfo] = useState<string | null>(null);
  /** 最近一次「获取数据中台数据」填入正文后为 true；用户改正文或选附件后置 false */
  const [manualFromDataHub, setManualFromDataHub] = useState(false);
  /** 中台 JSON 标准提取结果，用于解析按钮与预览之间的表格 */
  const [hubStandardRows, setHubStandardRows] = useState<HubDailyStandardRow[] | null>(null);
  /** 数据中台路径下，每条分公司日报的大模型解析结果 */
  const [hubBranchParses, setHubBranchParses] = useState<HubBranchParse[] | null>(null);
  /** 中台逐条提取时全局进度（报告提取预览标题区展示） */
  const [hubExtractionProgress, setHubExtractionProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    const d = loadReportExtractionPreviewDraft();
    if (!d) return;
    if (d.mode === "single") {
      setExtracted(d.extracted);
      setRawModel(d.rawModel);
      setParsed(d.parsed);
      setLlmCallStats(d.llmCallStats);
      setError(d.parseError);
      setPhase("done");
      setHubStandardRows(null);
      setHubBranchParses(null);
      setHubExtractionProgress(null);
      setManualFromDataHub(false);
    } else {
      setHubStandardRows(d.hubStandardRows);
      setHubBranchParses(d.hubBranchParses);
      setLlmCallStats(d.llmCallStats);
      setPhase("done");
      setRawModel(null);
      setParsed(null);
      setExtracted(null);
      setManualFromDataHub(true);
      setHubExtractionProgress(null);
      setError(null);
    }
  }, []);

  useEffect(() => {
    if (phase !== "done") return;
    if (hubBranchParses && hubBranchParses.length > 0) {
      const rows =
        hubStandardRows && hubStandardRows.length > 0
          ? hubStandardRows
          : hubBranchParses.map((b) => b.row);
      saveReportExtractionPreviewDraft({
        version: 1,
        mode: "hub",
        manualFromDataHub: true,
        hubStandardRows: rows,
        hubBranchParses,
        llmCallStats,
      });
      return;
    }
    if (rawModel && extracted?.text?.trim()) {
      saveReportExtractionPreviewDraft({
        version: 1,
        mode: "single",
        extracted,
        rawModel,
        parsed,
        llmCallStats,
        parseError: error,
      });
    }
  }, [phase, hubBranchParses, hubStandardRows, rawModel, parsed, extracted, llmCallStats, error]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const visibleHistory = useMemo(
    () => history.filter((h) => extractionHistoryVisibleForPerspective(h, user.perspective)),
    [history, user.perspective],
  );

  const previewTasks = useMemo(() => buildReportPreviewTasksSingle(parsed), [parsed]);

  const previewFallbackTitle = useMemo(() => {
    if (!rawModel) return `${formatExtractionDate()}-暂无`;
    return buildExtractionHistoryTitle(parsed, rawModel) ?? `${formatExtractionDate()}-暂无`;
  }, [parsed, rawModel]);

  const consumeExtractionFocusFromStorage = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(EXTRACTION_FOCUS_STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { id: string; needle: string };
      if (p?.id && typeof p.needle === "string") {
        sessionStorage.removeItem(EXTRACTION_FOCUS_STORAGE_KEY);
        setExtractionFocus(p);
        setReportMgmtTab("history");
      }
    } catch {
      try {
        sessionStorage.removeItem(EXTRACTION_FOCUS_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useLayoutEffect(() => {
    consumeExtractionFocusFromStorage();
  }, [consumeExtractionFocusFromStorage]);

  useEffect(() => {
    const onOpenReports = () => consumeExtractionFocusFromStorage();
    window.addEventListener(OPEN_REPORTS_PAGE_EVENT, onOpenReports);
    return () => window.removeEventListener(OPEN_REPORTS_PAGE_EVENT, onOpenReports);
  }, [consumeExtractionFocusFromStorage]);

  useEffect(() => {
    const bump = () => setConfigEpoch((n) => n + 1);
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, bump);
    return () => window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (!dataHubModalOpen) return;
    const { platforms, profiles } = loadDataHubState();
    setHubPlatforms(platforms);
    setHubProfiles(profiles);
    const p0 = platforms[0]?.id ?? "";
    setHubPlatformId(p0);
    const under = profiles.filter((x) => x.platformId === p0);
    setHubProfileId(under[0]?.id ?? profiles[0]?.id ?? "");
  }, [dataHubModalOpen]);

  const hubProfilesUnderPlatform = useMemo(
    () => hubProfiles.filter((p) => p.platformId === hubPlatformId),
    [hubProfiles, hubPlatformId],
  );

  /**
   * 将数据中台指定接口的清洗后 JSON（无则回退为缓存的原始 JSON）写入日报正文，并清空附件与解析状态。
   * @param profileIdParam - 传入时直接使用（用于「仅一个数据源+一个接口」时免弹窗）；省略则用弹窗内当前选中的 `hubProfileId`。
   */
  const applyDataHubJsonToManual = useCallback((profileIdParam?: string) => {
    const profileId = profileIdParam ?? hubProfileId;
    if (!profileId) {
      window.alert("请先选择数据源与接口。");
      return;
    }
    let text = loadCleanedJsonFromSession(profileId)?.trim() ?? "";
    let usedRawFallback = false;
    if (!text) {
      text = loadDataSyncLastBody(profileId)?.trim() ?? "";
      usedRawFallback = true;
    }
    if (!text) {
      window.alert(
        "该接口暂无可用数据。请先在「数据中台」对该接口发送测试以缓存原始 JSON；若需清洗后的 JSON，请在数据中台「清洗后的JSON数据」页签保存规则并生成结果。",
      );
      return;
    }
    clearReportExtractionPreviewDraft();
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setManualText(text);
    setExtracted(null);
    setRawModel(null);
    setParsed(null);
    setLlmCallStats(null);
    setError(null);
    setPhase("idle");
    setDataHubImportInfo(
      usedRawFallback
        ? "已填入该接口缓存的原始 JSON（当前会话尚无清洗后的 JSON 时自动使用）。"
        : "已填入该接口在数据中台生成的清洗后 JSON。",
    );
    setManualFromDataHub(true);
    setDataHubModalOpen(false);
  }, [hubProfileId]);

  /** 点击「获取数据中台数据」：仅一个平台且其下仅一个接口时直接填入正文，否则打开选择弹窗。 */
  const handleDataHubFetchClick = useCallback(() => {
    const { platforms, profiles } = loadDataHubState();
    if (platforms.length === 0 || profiles.length === 0) {
      window.alert(
        "暂无数据中台配置。请先在顶部进入「数据中台」，添加平台与接口并保存。",
      );
      return;
    }
    if (platforms.length === 1) {
      const platformId = platforms[0]!.id;
      const under = profiles.filter((p) => p.platformId === platformId);
      if (under.length === 1) {
        applyDataHubJsonToManual(under[0]!.id);
        return;
      }
    }
    setDataHubModalOpen(true);
  }, [applyDataHubJsonToManual]);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    if (f) setManualText("");
    setManualFromDataHub(false);
    clearReportExtractionPreviewDraft();
    setExtracted(null);
    setRawModel(null);
    setParsed(null);
    setLlmCallStats(null);
    setError(null);
    setPhase("idle");
  }, []);

  const clearFile = useCallback(() => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setManualFromDataHub(false);
    clearReportExtractionPreviewDraft();
    setExtracted(null);
    setRawModel(null);
    setParsed(null);
    setLlmCallStats(null);
    setError(null);
    setPhase("idle");
  }, []);

  const onManualTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setManualText(v);
    setManualFromDataHub(false);
    if (v.trim() !== "") {
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      clearReportExtractionPreviewDraft();
      setExtracted(null);
      setRawModel(null);
      setParsed(null);
      setLlmCallStats(null);
      setError(null);
      setPhase("idle");
    }
  }, []);

  const textFromFileLocked = file !== null;
  const fileFromTextLocked = manualText.trim() !== "";

  const parseReport = useCallback(async () => {
    clearReportExtractionPreviewDraft();
    setError(null);
    setExtracted(null);
    setRawModel(null);
    setParsed(null);
    setLlmCallStats(null);
    setHubStandardRows(null);
    setHubBranchParses(null);
    setHubExtractionProgress(null);
    if (!file && !manualText.trim()) {
      setError("请上传附件，或在上方文本框中粘贴日报正文（二选一）。");
      return;
    }
    const env = readLlmEnv();
    if (!env) {
      setError(
        '请先在顶部点击设置图标打开「大模型 Key」，填写并保存 DeepSeek API Key；或在 .env 中配置 VITE_LLM_API_KEY / 开发代理（详见 .env.example）。开发环境下 DeepSeek 请求走同源代理 /api/deepseek。',
      );
      return;
    }

    try {
      setPhase("reading");
      const ex = file
        ? await extractTextFromFile(file)
        : { text: manualText.trim() };
      setExtracted(ex);
      if (!ex.text.trim()) {
        setPhase("error");
        setError(ex.note || "未能从文件中提取到可用文本。");
        return;
      }

      // 数据中台填入的正文：标准提取 data.list → 表格 + 按条调用大模型 + 多分公司预览卡
      if (!file && manualFromDataHub) {
        const hubTry = tryParseDataHubDailyListJson(ex.text);
        if (hubTry.isHubShape) {
          if (hubTry.rows.length === 0) {
            setPhase("error");
            setError(
              "数据中台 JSON 中未解析到有效日报条目（请确认存在 data.list，且条目含 variables：日报日期 / 所属分公司 / 日报内容）。",
            );
            return;
          }
          setHubStandardRows(hubTry.rows);
          setPhase("calling");
          const statsAcc: LlmCallStats[] = [];
          flushSync(() => {
            setHubBranchParses([]);
            setHubExtractionProgress({ current: 0, total: hubTry.rows.length });
          });

          for (let i = 0; i < hubTry.rows.length; i++) {
            const row = hubTry.rows[i];
            const title = `${row.date ?? "暂无"}-${(row.company_name ?? "暂无").replace(/[/\\]/g, "·")}`;
            const id = `hub-branch-${i}`;

            if (!row.content?.trim()) {
              flushSync(() => {
                setHubExtractionProgress({ current: i + 1, total: hubTry.rows.length });
                setHubBranchParses((prev) => [
                  ...(prev ?? []),
                  {
                    id,
                    title,
                    row,
                    status: "error",
                    rawModel: null,
                    parsed: null,
                    llmError: "该条无日报内容，已跳过模型提取。",
                    detailsOpen: false,
                  },
                ]);
              });
              continue;
            }

            flushSync(() => {
              setHubExtractionProgress({ current: i + 1, total: hubTry.rows.length });
              setHubBranchParses((prev) => [
                ...(prev ?? []),
                {
                  id,
                  title,
                  row,
                  status: "extracting",
                  rawModel: null,
                  parsed: null,
                  detailsOpen: true,
                },
              ]);
            });

            const extractionDate =
              row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
                ? row.date
                : formatExtractionDate(new Date());
            try {
              const apiResult = await callProductionReportExtraction(row.content, env, extractionDate);
              statsAcc.push({
                model: apiResult.model,
                inputTokens: apiResult.inputTokens,
                outputTokens: apiResult.outputTokens,
                totalTokens: apiResult.totalTokens,
                durationMs: apiResult.durationMs,
              });
              const raw = normalizeProductionReportJson(apiResult.content, extractionDate);
              let parsedBranch: unknown = null;
              try {
                parsedBranch = parseJsonSafe(raw);
                if (
                  parsedBranch !== null &&
                  typeof parsedBranch === "object" &&
                  row.company_name?.trim()
                ) {
                  const o = { ...(parsedBranch as Record<string, unknown>) };
                  const b = o["分公司名称"];
                  if (typeof b !== "string" || !b.trim() || b === "暂无") {
                    o["分公司名称"] = row.company_name.trim().replace(/[/\\]/g, "·");
                  }
                  parsedBranch = o;
                }
              } catch {
                parsedBranch = null;
              }
              flushSync(() => {
                setHubBranchParses((prev) =>
                  (prev ?? []).map((x) =>
                    x.id === id
                      ? {
                          ...x,
                          status: "done",
                          rawModel: raw,
                          parsed: parsedBranch,
                          detailsOpen: false,
                        }
                      : x,
                  ),
                );
              });
            } catch (err) {
              flushSync(() => {
                setHubBranchParses((prev) =>
                  (prev ?? []).map((x) =>
                    x.id === id
                      ? {
                          ...x,
                          status: "error",
                          rawModel: null,
                          parsed: null,
                          llmError: err instanceof Error ? err.message : String(err),
                          detailsOpen: false,
                        }
                      : x,
                  ),
                );
              });
            }
          }

          setHubExtractionProgress(null);
          setRawModel(null);
          setParsed(null);
          setLlmCallStats(aggregateLlmStats(statsAcc));
          setPhase("done");
          return;
        }
      }

      setPhase("calling");
      const extractionDate =
        extractDateFromPlainText(ex.text) ?? formatExtractionDate(new Date());
      const apiResult = await callProductionReportExtraction(ex.text, env, extractionDate);
      setLlmCallStats({
        model: apiResult.model,
        inputTokens: apiResult.inputTokens,
        outputTokens: apiResult.outputTokens,
        totalTokens: apiResult.totalTokens,
        durationMs: apiResult.durationMs,
      });
      const raw = normalizeProductionReportJson(apiResult.content, extractionDate);
      setRawModel(raw);
      try {
        setParsed(parseJsonSafe(raw));
      } catch {
        setParsed(null);
        setError("模型返回内容不是合法 JSON，已在下方展示原文。");
      }
      setPhase("done");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [file, manualText, manualFromDataHub]);

  const canSaveToHistory = useMemo(() => {
    if (hubBranchParses?.length) {
      return hubBranchParses.some((b) => Boolean(b.rawModel && b.row.content?.trim()));
    }
    return Boolean(rawModel !== null && extracted?.text?.trim());
  }, [rawModel, extracted, hubBranchParses]);

  const saveToHistory = useCallback(() => {
    if (hubBranchParses?.length) {
      const ok = hubBranchParses.filter((b) => b.rawModel && b.row.content?.trim());
      if (ok.length === 0) return;
      clearReportExtractionPreviewDraft();
      let latest: ExtractionHistoryItem[] = [];
      for (const b of [...ok].reverse()) {
        const parsedClone =
          b.parsed != null ? (JSON.parse(JSON.stringify(b.parsed)) as unknown) : null;
        const quantitativeMetricCitations =
          parsedClone != null && typeof parsedClone === "object"
            ? buildQuantitativeMetricCitations(b.row.content!, parsedClone)
            : undefined;
        const item: ExtractionHistoryItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          savedAt: new Date().toISOString(),
          displayTitle: b.title,
          fileName: "数据中台同步",
          originalText: b.row.content!,
          rawModelResponse: b.rawModel!,
          parsedJson: parsedClone,
          quantitativeMetricCitations,
        };
        const withPending: ExtractionHistoryItem = {
          ...item,
          ...buildPendingTasksFromSavedReport(item),
        };
        latest = appendExtractionHistory(withPending);
      }
      setHistory(latest);
      setExtracted(null);
      setRawModel(null);
      setParsed(null);
      setHubBranchParses(null);
      setHubStandardRows(null);
      setHubExtractionProgress(null);
      setManualFromDataHub(false);
      setDataHubImportInfo(null);
      setError(null);
      setPhase("idle");
      setLlmCallStats(null);
      setManualText("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (!rawModel || !extracted?.text?.trim()) return;
    clearReportExtractionPreviewDraft();
    const parsedClone =
      parsed != null
        ? (JSON.parse(JSON.stringify(parsed)) as unknown)
        : null;
    const displayTitle =
      buildExtractionHistoryTitle(parsedClone, rawModel) ??
      `${formatExtractionDate()}-暂无`;
    const quantitativeMetricCitations =
      parsedClone != null && typeof parsedClone === "object"
        ? buildQuantitativeMetricCitations(extracted.text, parsedClone)
        : undefined;
    const item: ExtractionHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      savedAt: new Date().toISOString(),
      displayTitle,
      fileName: file?.name?.trim() || "文本输入",
      originalText: extracted.text,
      rawModelResponse: rawModel,
      parsedJson: parsedClone,
      llmStats: llmCallStats ?? undefined,
      quantitativeMetricCitations,
    };
    const withPending: ExtractionHistoryItem = {
      ...item,
      ...buildPendingTasksFromSavedReport(item),
    };
    setHistory(appendExtractionHistory(withPending));
    setExtracted(null);
    setRawModel(null);
    setParsed(null);
    setError(null);
    setPhase("idle");
    setLlmCallStats(null);
    setManualText("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [rawModel, extracted, parsed, file?.name, llmCallStats, hubBranchParses]);

  const removeHistory = useCallback((id: string) => {
    setHistory(removeExtractionHistoryItem(id));
  }, []);

  /** 按时间线顺序逐条重算 `quantitativeMetricCitations` 并写回 localStorage，便于旧数据补全「引用提取」Tab。 */
  const refreshAllQuantitativeCitations = useCallback(async () => {
    if (citationsRefreshGuardRef.current) return;
    citationsRefreshGuardRef.current = true;
    setCitationsRefreshing(true);
    try {
      const list = historyRef.current;
      if (list.length === 0) return;
      const ordered = buildTimelineGroups(list).flatMap((g) => g.items);
      let working = list.map((item) => ({ ...item }));
      for (const o of ordered) {
        const idx = working.findIndex((x) => x.id === o.id);
        if (idx < 0) continue;
        const item = working[idx];
        if (item.parsedJson == null || typeof item.parsedJson !== "object") continue;
        working = [
          ...working.slice(0, idx),
          {
            ...item,
            quantitativeMetricCitations: buildQuantitativeMetricCitations(
              item.originalText,
              item.parsedJson,
            ),
          },
          ...working.slice(idx + 1),
        ];
        flushSync(() => {
          setHistory(working);
          replaceExtractionHistory(working);
        });
        await new Promise((r) => setTimeout(r, 20));
      }
    } finally {
      citationsRefreshGuardRef.current = false;
      setCitationsRefreshing(false);
    }
  }, []);

  const exportHistory = useCallback(() => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: "qifeng-smart-tasks",
      items: history,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qifeng-extraction-history-${formatExtractionDate(new Date())}.json`;
    a.rel = "noopener";
    a.click();
    URL.revokeObjectURL(url);
  }, [history]);

  const onImportHistoryFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      try {
        const text = await f.text();
        const data = JSON.parse(text) as unknown;
        const items = parseImportedExtractionHistory(data);
        if (items.length === 0) {
          throw new Error("文件中没有符合格式的提取记录。");
        }
        setHistory(replaceExtractionHistory(items));
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? `导入失败：${err.message}` : "导入失败：无法解析该 JSON 文件。",
        );
      }
    },
    [],
  );

  const historyImportExport = (
    <>
      <button type="button" className="ghost-btn tiny-btn" onClick={exportHistory}>
        导出
      </button>
      <button type="button" className="ghost-btn tiny-btn" onClick={() => importHistoryInputRef.current?.click()}>
        导入
      </button>
      <button
        type="button"
        className="ghost-btn tiny-btn"
        disabled={visibleHistory.length === 0}
        onClick={() => downloadOriginalReportsJsonFile(visibleHistory)}
        title="按「日期、公司、原始报告内容」导出当前视角下全部记录为一个 JSON 文件"
      >
        导出原始报告
      </button>
      <input
        ref={importHistoryInputRef}
        id={importHistoryInputId}
        className="sr-only"
        type="file"
        accept=".json,application/json"
        onChange={(ev) => void onImportHistoryFile(ev)}
      />
    </>
  );

  return (
    <div className="report-page">
      <div className="report-main-tabs report-mgmt-tabs" role="tablist" aria-label="报告管理分类">
        <button
          type="button"
          role="tab"
          aria-selected={reportMgmtTab === "extract"}
          className={`report-main-tab${reportMgmtTab === "extract" ? " is-active" : ""}`}
          onClick={() => setReportMgmtTab("extract")}
        >
          报告提取
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={reportMgmtTab === "history"}
          className={`report-main-tab${reportMgmtTab === "history" ? " is-active" : ""}`}
          onClick={() => setReportMgmtTab("history")}
        >
          提取历史
        </button>
      </div>

      {reportMgmtTab === "extract" && (
      <section className="card report-tab-panel">
        <div className="card-head">
          <div>
            <h2>报告提取</h2>
            <p className="muted small">
              上传 Word / PDF / Markdown，或在文本框粘贴日报正文；两种方式二选一，使用提示词提取后展示在下方预览区；保存后请在「提取历史」中查看时间线。
            </p>
          </div>
        </div>

        <label className="report-manual-label">
          <span className="report-manual-title">日报正文（与附件二选一）</span>
          <textarea
            className="report-manual-input"
            rows={5}
            placeholder="在此粘贴日报全文… 有内容时将无法选择附件；选择附件后此处不可编辑。"
            value={manualText}
            onChange={onManualTextChange}
            disabled={textFromFileLocked}
          />
          {textFromFileLocked && (
            <span className="muted tiny">已选择附件，请先点击「移除附件」后再使用文本输入。</span>
          )}
        </label>

        <div className="report-upload-row">
          <div className={fileFromTextLocked ? "upload-block locked" : "upload-block"}>
            <label className="upload-label" htmlFor={inputId}>
              <span className="upload-btn">选择文件</span>
              <span className="muted tiny">
                {file
                  ? file.name
                  : fileFromTextLocked
                    ? "已输入文本，请先清空上方文本框后再上传"
                    : "支持 .pdf、.docx、.md（.doc 请另存为 docx）"}
              </span>
            </label>
            {file && (
              <button type="button" className="text-btn upload-clear" onClick={clearFile}>
                移除附件
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            id={inputId}
            className="sr-only"
            type="file"
            disabled={fileFromTextLocked}
            accept=".pdf,.doc,.docx,.md,.markdown,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={onFile}
          />
          <button
            type="button"
            className="ghost-btn report-data-hub-btn"
            disabled={phase === "reading" || phase === "calling"}
            onClick={handleDataHubFetchClick}
          >
            获取数据中台数据
          </button>
          <div className="parse-btn-wrap">
            <button
              type="button"
              className="primary-btn"
              disabled={(!file && !manualText.trim()) || phase === "reading" || phase === "calling"}
              onClick={() => void parseReport()}
            >
              解析
            </button>
            {(phase === "reading" || phase === "calling") && (
              <span className="parse-status parse-spinner" aria-label="解析中" title="解析中" />
            )}
            {phase === "done" && (
              <span className="parse-status parse-done" title="解析完成" aria-hidden>
                ✅
              </span>
            )}
          </div>
        </div>

        {dataHubImportInfo && <p className="muted tiny report-data-hub-import-hint">{dataHubImportInfo}</p>}

        {!readLlmEnv() && (
          <p className="report-hint warn">
            当前未配置大模型：请点击顶部「<strong>设置</strong>」图标，在「大模型 Key」中保存 DeepSeek API Key（推荐）；亦可使用{" "}
            <code>.env</code> 中的 <code>VITE_LLM_API_KEY</code> 等兼容方式。
          </p>
        )}

        {error && <p className="report-hint danger">{error}</p>}
        {extracted?.note && phase !== "idle" && (
          <p className="report-hint">{extracted.note}</p>
        )}

        {hubStandardRows && hubStandardRows.length > 0 && (
          <div className="hub-daily-standard-wrap card nested">
            <h3 className="hub-daily-standard-title">中台日报标准提取</h3>
            <p className="muted tiny hub-daily-standard-hint">
              自 <code>data.list</code> 提取 <code>variables</code> 内「日报日期 / 所属分公司 / 日报内容」，对应 JSON 字段{" "}
              <code>date</code>、<code>company_name</code>、<code>content</code>。
            </p>
            <div className="hub-daily-standard-table-wrap">
              <table className="hub-daily-standard-table">
                <thead>
                  <tr>
                    <th scope="col">日报日期</th>
                    <th scope="col">分公司名称</th>
                    <th scope="col">日报内容</th>
                  </tr>
                </thead>
                <tbody>
                  {hubStandardRows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.date ?? "—"}</td>
                      <td>{r.company_name ?? "—"}</td>
                      <td className="hub-daily-standard-content-cell">
                        {r.content ? (
                          <span className="hub-daily-content-text">{r.content}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="report-preview card nested">
          <div className="card-head tight report-preview-global-head">
            <div className="report-preview-global-head-main">
              <h3 className="report-preview-global-title">报告提取预览</h3>
              {hubExtractionProgress && (
                <div
                  className="hub-global-extract-banner"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <span
                    className="parse-status parse-spinner hub-global-extract-spinner"
                    aria-hidden
                  />
                  <span className="hub-global-extract-text">
                    正在进行第 {hubExtractionProgress.current} 个日报提取（共{" "}
                    {hubExtractionProgress.total} 个）
                  </span>
                </div>
              )}
            </div>
            <div className="preview-actions">
              <button
                type="button"
                className="primary-btn tiny-btn"
                disabled={!canSaveToHistory}
                onClick={saveToHistory}
                title={
                  hubBranchParses?.length
                    ? canSaveToHistory
                      ? "将已成功解析的分公司日报逐条保存到提取历史"
                      : "请至少成功解析一条含正文的日报"
                    : canSaveToHistory
                      ? "保存到下方提取历史（完整 JSON，一条记录）"
                      : "请先完成解析并收到模型返回"
                }
              >
                保存
              </button>
              <button type="button" className="ghost-btn tiny-btn" onClick={() => setShowPrompt((s) => !s)}>
                {showPrompt ? "隐藏" : "查看"}提示词全文
              </button>
            </div>
          </div>

          {showPrompt && (
            <pre className="prompt-preview">{REPORT_EXTRACTION_USER_INSTRUCTION}</pre>
          )}

          {llmCallStats && (phase === "done" || phase === "error") && (
            <div className="report-llm-stats-inline" aria-label="本次提取调用统计">
              {formatLlmStatsParts(llmCallStats).map((part, i) => (
                <span key={i} className="history-llm-stat-chip">
                  {part}
                </span>
              ))}
            </div>
          )}

          {phase === "idle" && !rawModel && !hubBranchParses?.length && (
            <p className="muted empty-preview">上传附件或粘贴正文后点击「解析」，大模型返回的结构化数据将显示在此处。</p>
          )}

          {extracted &&
            extracted.text &&
            (phase === "done" || phase === "error") &&
            !hubBranchParses?.length && (
            <details className="source-snippet">
              <summary>已送入模型的正文摘录（前 8000 字）</summary>
              <pre>{extracted.text.slice(0, 8000)}{extracted.text.length > 8000 ? "\n…" : ""}</pre>
            </details>
          )}

          {hubBranchParses && hubBranchParses.length > 0
            ? hubBranchParses.map((b) => (
                <details
                  key={b.id}
                  className="report-preview-task-card hub-preview-task-details"
                  open={b.detailsOpen}
                  onToggle={(e) => {
                    const open = e.currentTarget.open;
                    setHubBranchParses((prev) =>
                      (prev ?? []).map((x) => (x.id === b.id ? { ...x, detailsOpen: open } : x)),
                    );
                  }}
                >
                  <summary className="report-preview-task-card-head hub-preview-task-summary">
                    <span className="report-preview-task-card-title">{b.title}</span>
                    <span className="hub-preview-task-status-row" aria-hidden>
                      {b.status === "extracting" && (
                        <span
                          className="parse-status parse-spinner hub-card-head-spinner"
                          title="提取中"
                        />
                      )}
                      {b.status === "done" && (
                        <span className="hub-card-done-mark" title="提取完成">
                          ✅
                        </span>
                      )}
                      {b.status === "error" && (
                        <span className="hub-card-warn-mark" title={b.llmError ?? "未成功提取"}>
                          ⚠️
                        </span>
                      )}
                    </span>
                  </summary>
                  <div className="report-preview-daily-body">
                    {b.status === "extracting" ? (
                      <p className="muted small hub-card-extracting-placeholder">
                        <span
                          className="parse-status parse-spinner hub-card-inline-spinner"
                          aria-hidden
                        />{" "}
                        正在请求大模型并解析结构化结果…
                      </p>
                    ) : b.llmError ? (
                      <p className="report-hint danger">{b.llmError}</p>
                    ) : b.parsed != null ? (
                      <div className="preview-body">
                        <ReportJsonPreview data={b.parsed} />
                      </div>
                    ) : b.rawModel ? (
                      <pre className="json-fallback">{b.rawModel}</pre>
                    ) : (
                      <p className="muted small">暂无模型输出</p>
                    )}
                  </div>
                </details>
              ))
            : parsed != null &&
              previewTasks.map((task) => (
                <article key={task.id} className="report-preview-task-card">
                  <header className="report-preview-task-card-head">
                    <h4 className="report-preview-task-card-title">{task.title}</h4>
                  </header>
                  <div className="report-preview-daily-body">
                    <div className="preview-body">
                      <ReportJsonPreview data={task.slice} />
                    </div>
                  </div>
                </article>
              ))}

          {!hubBranchParses?.length && rawModel && parsed == null && (
            <article className="report-preview-task-card">
              <header className="report-preview-task-card-head">
                <h4 className="report-preview-task-card-title">{previewFallbackTitle}</h4>
              </header>
              <div className="report-preview-daily-body">
                <pre className="json-fallback">{rawModel}</pre>
              </div>
            </article>
          )}
        </div>
      </section>
      )}

      {reportMgmtTab === "history" && (
        <div className="report-tab-panel">
          <ExtractionHistoryList
            items={visibleHistory}
            onRemove={removeHistory}
            extractionFocus={extractionFocus}
            onExtractionFocusConsumed={() => setExtractionFocus(null)}
            citationsRefreshing={citationsRefreshing}
            onRefreshQuantitativeCitations={refreshAllQuantitativeCitations}
            extraTitleActions={historyImportExport}
          />
        </div>
      )}

      {dataHubModalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setDataHubModalOpen(false)}>
          <div
            className="modal report-data-hub-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-data-hub-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="report-data-hub-modal-title">从数据中台填入 JSON</h3>
            <p className="muted small">
              选择平台与接口后，将优先使用「清洗后的 JSON」；若本会话尚未生成，则使用「测试」缓存的原始响应 JSON。
            </p>
            {hubPlatforms.length === 0 || hubProfiles.length === 0 ? (
              <p className="report-hint warn">
                暂无数据中台配置。请先在顶部进入「数据中台」，添加平台与接口并保存。
              </p>
            ) : (
              <div className="modal-form report-data-hub-modal-form">
                <label className="form-row">
                  <span>数据源（平台）</span>
                  <select
                    value={hubPlatformId}
                    onChange={(e) => {
                      const pid = e.target.value;
                      setHubPlatformId(pid);
                      const first = hubProfiles.filter((p) => p.platformId === pid)[0]?.id ?? "";
                      setHubProfileId(first);
                    }}
                  >
                    {hubPlatforms.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-row">
                  <span>接口</span>
                  <select
                    value={hubProfileId}
                    onChange={(e) => setHubProfileId(e.target.value)}
                    disabled={hubProfilesUnderPlatform.length === 0}
                  >
                    {hubProfilesUnderPlatform.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="form-actions report-data-hub-modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setDataHubModalOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={hubProfilesUnderPlatform.length === 0 || !hubProfileId}
                onClick={() => applyDataHubJsonToManual()}
              >
                填入日报正文
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
