/**
 * @fileoverview 数据中台页：按数据源分组的接口配置、cURL 导入、测试；数据列表（业务数据 / 原始 JSON / 清洗后 JSON）；清洗支持大模型或本地脚本分组；单元格右侧详情抽屉。
 * 受浏览器 CORS 限制时需在 Vite 配置代理或由后端转发。
 *
 * @module DataSync
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DataPlatform, ExternalApiHeaderRow, ExternalApiProfile } from "../types/externalApiProfile";
import { DATA_HUB_CLEANED_JSON_PREFIX } from "../utils/dataHubCleanedJsonStorage";
import {
  buildJsonCleaningUserMessage,
  DATA_HUB_JSON_CLEANING_MAX_COMPLETION_TOKENS,
  DATA_HUB_JSON_CLEANING_SYSTEM,
  formatCleanedJsonOutput,
} from "../utils/dataHubJsonCleaning";
import {
  DEFAULT_GROUP_SCRIPT_SPEC,
  parseScriptCleaningSpec,
  runGroupBranchWorkshopDateCleaning,
  type DataHubGroupByBranchWorkshopDateSpec,
} from "../utils/dataHubScriptCleaning";
import {
  createEmptyPlatform,
  createEmptyProfile,
  loadDataHubState,
  saveDataHubState,
} from "../utils/externalApiStorage";
import { saveDataSyncLastBody, loadDataSyncLastBody } from "../utils/dataSyncResponseStorage";
import { extractBusinessRowsFromJson } from "../utils/extractBusinessRowsFromJson";
import { callLlmChatText, LLM_CONFIG_CHANGED_EVENT, readLlmEnv } from "../utils/llmExtract";
import { parseCurl } from "../utils/parseCurl";
import {
  filterDataHubBusinessRows,
  loadDataHubBusinessViewFilter,
  saveDataHubBusinessViewFilter,
} from "../utils/dataHubBusinessViewFilter";

const RESPONSE_PREVIEW_MAX = 200_000;
const TEST_TIMEOUT_MS = 30_000;
/** `dataTransfer` 类型标识：自定义展示字段列表项在拖拽重排时的源下标 */
const DATA_HUB_FIELD_DRAG_MIME = "application/x-smarttasks-field-picker-index";

/**
 * 自定义展示字段区列表顺序：已选列按 `visibleBusinessFields` 顺序在前，未选列按接口解析列顺序在后。
 * @param all 当前 JSON 解析出的全部列名
 * @param vis 已保存的可见列配置；`undefined`/`null` 视为全选且顺序同 `all`
 */
function buildDataHubFieldPickerOrder(all: string[], vis: string[] | null | undefined): string[] {
  if (!all.length) return [];
  if (vis === undefined || vis === null) return [...all];
  if (vis.length === 0) return [...all];
  const visSet = new Set(vis);
  const head = vis.filter((c) => all.includes(c));
  const tail = all.filter((c) => !visSet.has(c));
  return [...head, ...tail];
}
/** 单元格超过该长度时显示为可点击展开（仍可点击短文本查看） */
const CELL_PREVIEW_CHARS = 120;

/** 主内容区页签 */
type DataSyncMainTab = "basic" | "data";
/** 数据列表子页签：业务数据 → 原始 JSON → 清洗后的 JSON */
type DataSyncDataSubTab = "business" | "rawJson" | "cleanedJson";

const CLEANING_RULES_PLACEHOLDER = `用自然语言描述如何清洗原始 JSON，例如：

- 仅保留 data.list 中每条记录的 variables 内「日报日期」「所属车间」「日报内容」；
- 或输出为 [{ "date": "...", "workshop": "...", "content": "..." }] 数组。`;

/** 右侧抽屉展示的单元格详情 */
interface CellDetailState {
  columnTitle: string;
  text: string;
  rowIndex: number;
}

function headersToRecord(rows: ExternalApiHeaderRow[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const { key, value } of rows) {
    const k = key.trim();
    if (!k) continue;
    o[k] = value;
  }
  return o;
}

/**
 * 数据中台：按数据源分组的接口列表 + 接口基础配置 / 数据列表（业务数据、原始 JSON、清洗后 JSON）。
 */
export function DataSync() {
  const initial = useMemo(() => loadDataHubState(), []);
  const [platforms, setPlatforms] = useState<DataPlatform[]>(() => initial.platforms);
  const [profiles, setProfiles] = useState<ExternalApiProfile[]>(() => initial.profiles);
  const [selectedId, setSelectedId] = useState<string | null>(() => initial.profiles[0]?.id ?? null);
  const [expandedPlatforms, setExpandedPlatforms] = useState<Set<string>>(
    () => new Set(initial.platforms.map((p) => p.id)),
  );

  const [renamingPlatformId, setRenamingPlatformId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const [mainTab, setMainTab] = useState<DataSyncMainTab>("basic");
  const [dataSubTab, setDataSubTab] = useState<DataSyncDataSubTab>("business");

  const [curlImportText, setCurlImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  const [testPhase, setTestPhase] = useState<"idle" | "running">("idle");
  const [testHttpStatus, setTestHttpStatus] = useState<number | null>(null);
  const [testDurationMs, setTestDurationMs] = useState<number | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResponseHeaders, setTestResponseHeaders] = useState<string>("");
  const [cachedResponseBody, setCachedResponseBody] = useState<string>("");

  const [businessFilterQuery, setBusinessFilterQuery] = useState("");
  const [businessFilterScope, setBusinessFilterScope] = useState<"all" | string>("all");
  /** 切换接口后的首帧跳过写入，避免用切换前的筛选状态覆盖 localStorage */
  const skipNextBusinessFilterSaveRef = useRef(false);
  const [cellDetail, setCellDetail] = useState<CellDetailState | null>(null);

  const [cleaningRulesDraft, setCleaningRulesDraft] = useState("");
  /** 与保存配置一致：大模型清洗 vs 本地脚本分组 */
  const [cleaningModeDraft, setCleaningModeDraft] = useState<"llm" | "script">("script");
  const [scriptSpecForm, setScriptSpecForm] = useState<DataHubGroupByBranchWorkshopDateSpec>(
    () => ({ ...DEFAULT_GROUP_SCRIPT_SPEC }),
  );
  const [cleaningPhase, setCleaningPhase] = useState<"idle" | "running">("idle");
  const [cleaningError, setCleaningError] = useState<string | null>(null);
  const [cleanedJsonText, setCleanedJsonText] = useState<string>("");
  const cleaningSeqRef = useRef(0);
  const [llmEpoch, setLlmEpoch] = useState(0);

  const selected = useMemo(
    () => (selectedId ? profiles.find((p) => p.id === selectedId) ?? null : null),
    [profiles, selectedId],
  );

  /** 已持久化的清洗规则（用于自动重算依赖，避免 profiles 引用抖动）。 */
  const savedJsonCleaningRules = useMemo(
    () => (selectedId ? profiles.find((p) => p.id === selectedId)?.jsonCleaningRules ?? "" : ""),
    [profiles, selectedId],
  );

  const savedJsonCleaningMode = useMemo<"llm" | "script">(() => {
    if (!selectedId) return "script";
    const m = profiles.find((p) => p.id === selectedId)?.jsonCleaningMode;
    return m === "llm" ? "llm" : "script";
  }, [profiles, selectedId]);

  const savedJsonCleaningScriptSpec = useMemo(
    () => (selectedId ? profiles.find((p) => p.id === selectedId)?.jsonCleaningScriptSpec ?? "" : ""),
    [profiles, selectedId],
  );

  const profilesByPlatform = useMemo(() => {
    const m = new Map<string, ExternalApiProfile[]>();
    for (const p of profiles) {
      const arr = m.get(p.platformId) ?? [];
      arr.push(p);
      m.set(p.platformId, arr);
    }
    return m;
  }, [profiles]);

  useEffect(() => {
    if (!selectedId) {
      setCachedResponseBody("");
      return;
    }
    setCachedResponseBody(loadDataSyncLastBody(selectedId) ?? "");
  }, [selectedId]);

  useEffect(() => {
    setCleaningRulesDraft(selected?.jsonCleaningRules ?? "");
    setCleaningModeDraft(selected?.jsonCleaningMode === "llm" ? "llm" : "script");
    const parsed = parseScriptCleaningSpec(selected?.jsonCleaningScriptSpec);
    setScriptSpecForm(parsed ?? { ...DEFAULT_GROUP_SCRIPT_SPEC });
  }, [selectedId, selected?.jsonCleaningRules, selected?.jsonCleaningMode, selected?.jsonCleaningScriptSpec]);

  useEffect(() => {
    if (!selectedId) {
      setCleanedJsonText("");
      return;
    }
    try {
      setCleanedJsonText(sessionStorage.getItem(DATA_HUB_CLEANED_JSON_PREFIX + selectedId) ?? "");
    } catch {
      setCleanedJsonText("");
    }
  }, [selectedId]);

  useEffect(() => {
    const bump = () => setLlmEpoch((n) => n + 1);
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, bump);
    return () => window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, bump);
  }, []);

  const llmEnvReady = useMemo(() => readLlmEnv() !== null, [llmEpoch]);

  useEffect(() => {
    if (!cellDetail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCellDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cellDetail]);

  const persist = useCallback((nextPlatforms: DataPlatform[], nextProfiles: ExternalApiProfile[]) => {
    setPlatforms(nextPlatforms);
    setProfiles(nextProfiles);
    saveDataHubState(nextPlatforms, nextProfiles);
  }, []);

  const updateProfile = useCallback(
    (id: string, patch: Partial<ExternalApiProfile>) => {
      persist(
        platforms,
        profiles.map((p) =>
          p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
        ),
      );
    },
    [platforms, profiles, persist],
  );

  /** 保存清洗方式、自然语言规则与脚本分组配置（保存后由下方 effect 根据原始 JSON 自动重算）。 */
  const handleSaveCleaningRules = useCallback(() => {
    if (!selected) return;
    let scriptSpecStr = "";
    try {
      scriptSpecStr = JSON.stringify(scriptSpecForm);
    } catch {
      scriptSpecStr = "";
    }
    updateProfile(selected.id, {
      jsonCleaningRules: cleaningRulesDraft.trim(),
      jsonCleaningMode: cleaningModeDraft,
      jsonCleaningScriptSpec: scriptSpecStr,
    });
  }, [selected, cleaningRulesDraft, cleaningModeDraft, scriptSpecForm, updateProfile]);

  /**
   * 原始 JSON 或已保存的清洗配置变化时，自动重新生成清洗后的 JSON。
   * - `script`：本地分组，不调用大模型、不受输出 token 截断限制。
   * - `llm`：沿用自然语言 + 大模型。
   */
  useEffect(() => {
    if (!selectedId) return;
    const raw = cachedResponseBody.trim();
    if (!raw) {
      cleaningSeqRef.current += 1;
      setCleanedJsonText("");
      setCleaningError(null);
      setCleaningPhase("idle");
      return;
    }

    if (savedJsonCleaningMode === "script") {
      cleaningSeqRef.current += 1;
      const mySeq = ++cleaningSeqRef.current;
      const tid = window.setTimeout(() => {
        if (mySeq !== cleaningSeqRef.current) return;
        const spec = parseScriptCleaningSpec(savedJsonCleaningScriptSpec);
        if (!spec) {
          setCleaningError(
            "脚本清洗：已保存的「分组脚本配置」无效或为空。请填写下方字段后点击「保存清洗规则」。",
          );
          setCleanedJsonText("");
          setCleaningPhase("idle");
          return;
        }
        const result = runGroupBranchWorkshopDateCleaning(raw, spec);
        if (mySeq !== cleaningSeqRef.current) return;
        if (!result.ok) {
          setCleaningError(result.error);
          setCleanedJsonText("");
        } else {
          setCleaningError(null);
          setCleanedJsonText(result.text);
          try {
            sessionStorage.setItem(DATA_HUB_CLEANED_JSON_PREFIX + selectedId, result.text);
          } catch {
            /* quota */
          }
        }
        setCleaningPhase("idle");
      }, 0);
      return () => window.clearTimeout(tid);
    }

    const rules = savedJsonCleaningRules.trim();
    if (!rules) {
      cleaningSeqRef.current += 1;
      setCleanedJsonText("");
      setCleaningError(null);
      setCleaningPhase("idle");
      return;
    }
    const env = readLlmEnv();
    if (!env) {
      cleaningSeqRef.current += 1;
      setCleaningError("未配置大模型，无法自动生成清洗结果。请在顶部「设置」中配置 DeepSeek。");
      setCleanedJsonText("");
      setCleaningPhase("idle");
      return;
    }

    const mySeq = ++cleaningSeqRef.current;
    const t = window.setTimeout(() => {
      void (async () => {
        if (mySeq !== cleaningSeqRef.current) return;
        setCleaningPhase("running");
        setCleaningError(null);
        try {
          const userMsg = buildJsonCleaningUserMessage(rules, raw);
          const result = await callLlmChatText(
            env,
            DATA_HUB_JSON_CLEANING_SYSTEM,
            userMsg,
            0.25,
            DATA_HUB_JSON_CLEANING_MAX_COMPLETION_TOKENS,
          );
          if (mySeq !== cleaningSeqRef.current) return;
          const formatted = formatCleanedJsonOutput(result.content);
          setCleanedJsonText(formatted);
          if (result.finishReason === "length") {
            setCleaningError(
              "执行清洗逻辑时模型输出达到长度上限，内容被截断，可能导致数据丢失或 JSON 不完整。请精简清洗目标、缩短原始数据，或换用允许更大输出的模型。",
            );
          } else {
            setCleaningError(null);
          }
          try {
            sessionStorage.setItem(DATA_HUB_CLEANED_JSON_PREFIX + selectedId, formatted);
          } catch {
            /* quota */
          }
        } catch (e) {
          if (mySeq !== cleaningSeqRef.current) return;
          setCleaningError(e instanceof Error ? e.message : String(e));
          setCleanedJsonText("");
        } finally {
          if (mySeq === cleaningSeqRef.current) setCleaningPhase("idle");
        }
      })();
    }, 650);
    return () => window.clearTimeout(t);
  }, [
    cachedResponseBody,
    selectedId,
    savedJsonCleaningRules,
    savedJsonCleaningMode,
    savedJsonCleaningScriptSpec,
    llmEpoch,
  ]);

  const parsedJson = useMemo(() => {
    const raw = cachedResponseBody.trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }, [cachedResponseBody]);

  const businessExtracted = useMemo(() => {
    if (parsedJson === null) return { rows: [] as Record<string, string>[], columns: [] as string[] };
    return extractBusinessRowsFromJson(parsedJson);
  }, [parsedJson]);

  const displayColumns = useMemo(() => {
    const { columns } = businessExtracted;
    const vis = selected?.visibleBusinessFields;
    if (vis === undefined || vis === null) return columns;
    if (vis.length === 0) return [];
    const colSet = new Set(columns);
    return vis.filter((c) => colSet.has(c));
  }, [businessExtracted.columns, selected?.visibleBusinessFields]);

  const fieldPickerOrder = useMemo(
    () => buildDataHubFieldPickerOrder(businessExtracted.columns, selected?.visibleBusinessFields),
    [businessExtracted.columns, selected?.visibleBusinessFields],
  );

  const filteredRows = useMemo(
    () => filterDataHubBusinessRows(businessExtracted.rows, businessFilterQuery, businessFilterScope),
    [businessExtracted.rows, businessFilterQuery, businessFilterScope],
  );

  useEffect(() => {
    if (
      businessFilterScope !== "all" &&
      !businessExtracted.columns.includes(businessFilterScope)
    ) {
      setBusinessFilterScope("all");
    }
  }, [businessExtracted.columns, businessFilterScope]);

  /** 切换接口时恢复该接口下已保存的「业务数据」关键字筛选，供日报列表同源复用 */
  useLayoutEffect(() => {
    if (!selectedId) return;
    skipNextBusinessFilterSaveRef.current = true;
    const f = loadDataHubBusinessViewFilter(selectedId);
    if (f) {
      setBusinessFilterQuery(f.query);
      setBusinessFilterScope(f.scope);
    } else {
      setBusinessFilterQuery("");
      setBusinessFilterScope("all");
    }
  }, [selectedId]);

  /** 将业务 VIEW 筛选写入 localStorage，报告管理「日报列表」与 {@link filterDataHubBusinessRows} 共用 */
  useEffect(() => {
    if (!selectedId) return;
    if (skipNextBusinessFilterSaveRef.current) {
      skipNextBusinessFilterSaveRef.current = false;
      return;
    }
    saveDataHubBusinessViewFilter(selectedId, businessFilterQuery, businessFilterScope);
  }, [selectedId, businessFilterQuery, businessFilterScope]);

  const togglePlatformExpanded = (platformId: string) => {
    setExpandedPlatforms((prev) => {
      const n = new Set(prev);
      if (n.has(platformId)) n.delete(platformId);
      else n.add(platformId);
      return n;
    });
  };

  const handleAddPlatform = () => {
    const pl = createEmptyPlatform(`数据源 ${platforms.length + 1}`);
    persist([...platforms, pl], profiles);
    setExpandedPlatforms((prev) => new Set([...prev, pl.id]));
  };

  const handleDeletePlatform = (platformId: string) => {
    const count = profiles.filter((p) => p.platformId === platformId).length;
    if (count > 0) {
      window.alert("该数据源下仍有接口配置，请先删除或移动接口后再删除数据源。");
      return;
    }
    const nextPl = platforms.filter((p) => p.id !== platformId);
    if (nextPl.length === 0) {
      window.alert("至少保留一个数据源。");
      return;
    }
    persist(nextPl, profiles);
    setExpandedPlatforms((prev) => {
      const n = new Set(prev);
      n.delete(platformId);
      return n;
    });
  };

  const commitRenamePlatform = () => {
    if (!renamingPlatformId) return;
    const name = renameDraft.trim();
    if (!name) {
      setRenamingPlatformId(null);
      return;
    }
    persist(
      platforms.map((p) => (p.id === renamingPlatformId ? { ...p, name } : p)),
      profiles,
    );
    setRenamingPlatformId(null);
  };

  const handleAddProfile = (platformId: string) => {
    const p = createEmptyProfile(platformId);
    persist(platforms, [...profiles, p]);
    setSelectedId(p.id);
    setCurlImportText("");
    setImportError(null);
    setImportWarnings([]);
    setTestError(null);
    setTestHttpStatus(null);
    setCachedResponseBody("");
    setMainTab("basic");
  };

  const handleDelete = (id: string) => {
    const next = profiles.filter((p) => p.id !== id);
    persist(platforms, next);
    if (selectedId === id) {
      setSelectedId(next[0]?.id ?? null);
    }
  };

  /**
   * 解析 cURL 并写入 URL / 方法 / 请求头；若 cURL 中**未解析出非空请求体**，则**不改动**当前「请求体」配置，避免误清空。
   * 「从 cURL 导入」粘贴区在解析成功后**不会自动清空**，由用户自行编辑或清空。
   */
  const handleImportCurl = () => {
    setImportError(null);
    setImportWarnings([]);
    if (!selectedId) {
      setImportError("请先新增或选择一条配置");
      return;
    }
    try {
      const parsed = parseCurl(curlImportText);
      setImportWarnings(parsed.warnings);
      const patch: Partial<ExternalApiProfile> = {
        method: parsed.method,
        url: parsed.url,
        headers: parsed.headers,
      };
      if (parsed.body.trim() !== "") {
        patch.body = parsed.body;
      }
      updateProfile(selectedId, patch);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * 发送接口测试；响应体会写入会话缓存。
   * 当 HTTP 为成功（2xx）时，同时将当前「清洗规则」草稿写入配置，等效于在「清洗后的 JSON」中点击「保存清洗规则」，从而触发清洗后的 JSON 生成逻辑。
   */
  const handleRunTest = async () => {
    if (!selected) return;
    setTestPhase("running");
    setTestError(null);
    setTestHttpStatus(null);
    setTestDurationMs(null);
    setTestResponseHeaders("");

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), TEST_TIMEOUT_MS);
    const t0 = performance.now();

    const method = selected.method.trim().toUpperCase() || "GET";
    const headers = headersToRecord(selected.headers);
    const hasBody =
      ["POST", "PUT", "PATCH", "DELETE"].includes(method) && selected.body.trim().length > 0;
    if (hasBody && !headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }

    try {
      const res = await fetch(selected.url, {
        method,
        headers,
        body: hasBody ? selected.body : undefined,
        signal: ctrl.signal,
      });
      const ms = Math.round(performance.now() - t0);
      setTestHttpStatus(res.status);
      setTestDurationMs(ms);

      const headerLines: string[] = [];
      res.headers.forEach((v, k) => {
        headerLines.push(`${k}: ${v}`);
      });
      setTestResponseHeaders(headerLines.join("\n"));

      const text = await res.text();
      const preview =
        text.length > RESPONSE_PREVIEW_MAX
          ? `${text.slice(0, RESPONSE_PREVIEW_MAX)}\n\n…（已截断，原始长度 ${text.length} 字符）`
          : text;

      saveDataSyncLastBody(selected.id, preview);
      setCachedResponseBody(preview);

      const summary = `HTTP ${res.status} · ${ms} ms · 响应约 ${text.length} 字符`;
      let scriptSpecStr = "";
      try {
        scriptSpecStr = JSON.stringify(scriptSpecForm);
      } catch {
        scriptSpecStr = "";
      }
      updateProfile(selected.id, {
        lastTestAt: Date.now(),
        lastTestOk: res.ok,
        lastTestSummary: summary,
        ...(res.ok
          ? {
              jsonCleaningRules: cleaningRulesDraft.trim(),
              jsonCleaningMode: cleaningModeDraft,
              jsonCleaningScriptSpec: scriptSpecStr,
            }
          : {}),
      });
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === "AbortError"
            ? `请求超时（>${TEST_TIMEOUT_MS / 1000}s）或已中止`
            : e.message
          : String(e);
      setTestError(msg);
      updateProfile(selected.id, {
        lastTestAt: Date.now(),
        lastTestOk: false,
        lastTestSummary: `失败：${msg.slice(0, 120)}`,
      });
    } finally {
      window.clearTimeout(timer);
      setTestPhase("idle");
    }
  };

  const addHeaderRow = () => {
    if (!selectedId) return;
    const p = profiles.find((x) => x.id === selectedId);
    if (!p) return;
    updateProfile(selectedId, { headers: [...p.headers, { key: "", value: "" }] });
  };

  const patchHeaderRow = (index: number, patch: Partial<ExternalApiHeaderRow>) => {
    if (!selectedId) return;
    const p = profiles.find((x) => x.id === selectedId);
    if (!p) return;
    const next = p.headers.map((h, i) => (i === index ? { ...h, ...patch } : h));
    updateProfile(selectedId, { headers: next });
  };

  const removeHeaderRow = (index: number) => {
    if (!selectedId) return;
    const p = profiles.find((x) => x.id === selectedId);
    if (!p) return;
    updateProfile(selectedId, { headers: p.headers.filter((_, i) => i !== index) });
  };

  const toggleVisibleField = (col: string, checked: boolean) => {
    if (!selectedId) return;
    const p = profiles.find((x) => x.id === selectedId);
    if (!p) return;
    const all = businessExtracted.columns;
    const vis = p.visibleBusinessFields;
    const set = new Set(vis === undefined || vis === null ? all : vis);
    if (checked) set.add(col);
    else set.delete(col);
    const order = buildDataHubFieldPickerOrder(all, vis);
    const nextArr: string[] = [];
    for (const c of order) {
      if (set.has(c)) nextArr.push(c);
    }
    for (const c of all) {
      if (set.has(c) && !nextArr.includes(c)) nextArr.push(c);
    }
    if (nextArr.length === 0) {
      updateProfile(selectedId, { visibleBusinessFields: [] });
    } else if (nextArr.length === all.length && nextArr.every((c, i) => c === all[i])) {
      updateProfile(selectedId, { visibleBusinessFields: undefined });
    } else {
      updateProfile(selectedId, { visibleBusinessFields: nextArr });
    }
  };

  /**
   * 在「自定义展示字段」中拖拽重排后，按新顺序写回 `visibleBusinessFields`（未勾选列不参与表格列）。
   */
  const reorderFieldPickerColumns = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!selectedId || fromIndex === toIndex) return;
      const all = businessExtracted.columns;
      if (!all.length) return;
      const list = [...buildDataHubFieldPickerOrder(all, selected?.visibleBusinessFields)];
      if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return;
      const [moved] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, moved);
      const vis = selected?.visibleBusinessFields;
      const checkedSet = vis === undefined || vis === null ? new Set(all) : new Set(vis);
      const newVis = list.filter((c) => all.includes(c) && checkedSet.has(c));
      if (newVis.length === 0) {
        updateProfile(selectedId, { visibleBusinessFields: [] });
      } else if (newVis.length === all.length && newVis.every((c, i) => c === all[i])) {
        updateProfile(selectedId, { visibleBusinessFields: undefined });
      } else {
        updateProfile(selectedId, { visibleBusinessFields: newVis });
      }
    },
    [selectedId, selected?.visibleBusinessFields, businessExtracted.columns, updateProfile],
  );

  const setAllVisible = (allVisible: boolean) => {
    if (!selectedId) return;
    updateProfile(selectedId, {
      visibleBusinessFields: allVisible ? undefined : [],
    });
  };

  const colChecked = (col: string) => {
    const vis = selected?.visibleBusinessFields;
    if (vis === undefined || vis === null) return true;
    return vis.includes(col);
  };

  const openCellDetail = (columnTitle: string, text: string, rowIndex: number) => {
    setCellDetail({ columnTitle, text, rowIndex });
  };

  const basicPanel = selected ? (
    <div className="data-sync-basic-layout">
      <div className="card data-sync-form-card data-sync-card--accent">
        <div className="card-head tight">
          <h2 className="data-sync-card-title">基本参数</h2>
          <button type="button" className="ghost-btn tiny-btn" onClick={() => handleDelete(selected.id)}>
            删除此项
          </button>
        </div>
        <form className="task-form data-sync-form data-sync-form-top">
          <div className="data-sync-form-grid">
            <label className="data-sync-form-name">
              名称
              <input
                className="fld"
                value={selected.name}
                onChange={(e) => updateProfile(selected.id, { name: e.target.value })}
                placeholder="例如：获取协同平台车间日报信息"
              />
            </label>
            <label className="data-sync-inline-check data-sync-form-enable">
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(e) => updateProfile(selected.id, { enabled: e.target.checked })}
              />
              <span>启用</span>
            </label>
            <div className="data-sync-field-row data-sync-form-grid-span2">
              <label>
                方法
                <select
                  className="fld"
                  value={selected.method}
                  onChange={(e) => updateProfile(selected.id, { method: e.target.value })}
                >
                  {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="data-sync-url-field">
                URL
                <input
                  className="fld"
                  value={selected.url}
                  onChange={(e) => updateProfile(selected.id, { url: e.target.value })}
                  placeholder="https://"
                />
              </label>
            </div>
            <label className="data-sync-form-grid-span2">
              备注
              <input
                className="fld"
                value={selected.notes}
                onChange={(e) => updateProfile(selected.id, { notes: e.target.value })}
                placeholder="可选"
              />
            </label>
          </div>
        </form>
      </div>

      <div className="data-sync-config-columns">
        <div className="card data-sync-form-card data-sync-card--sub">
          <h2 className="data-sync-card-title">请求头</h2>
          <div className="data-sync-headers data-sync-scroll-pane">
            {selected.headers.length === 0 ? (
              <p className="muted tiny">无自定义请求头（可选）</p>
            ) : (
              selected.headers.map((row, idx) => (
                <div key={idx} className="data-sync-header-row">
                  <input
                    className="fld"
                    placeholder="Header 名"
                    value={row.key}
                    onChange={(e) => patchHeaderRow(idx, { key: e.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <input
                    className="fld"
                    placeholder="值（如 Bearer token）"
                    value={row.value}
                    onChange={(e) => patchHeaderRow(idx, { value: e.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="button" className="ghost-btn tiny-btn" onClick={() => removeHeaderRow(idx)}>
                    移除
                  </button>
                </div>
              ))
            )}
            <button type="button" className="ghost-btn tiny-btn" onClick={addHeaderRow}>
              + 添加请求头
            </button>
          </div>
        </div>

        <div className="card data-sync-form-card data-sync-card--sub">
          <h2 className="data-sync-card-title">请求体</h2>
          <label className="data-sync-label-fill">
            Body（JSON / 文本；GET 时通常留空）
            <textarea
              className="fld data-sync-body data-sync-textarea-fill"
              value={selected.body}
              onChange={(e) => updateProfile(selected.id, { body: e.target.value })}
              spellCheck={false}
              placeholder='例如：[{ "fieldName": "日报日期", "logic": "eq", "value": "2026-04-18" }]'
            />
          </label>
        </div>
      </div>

      <div className="data-sync-config-columns">
        <div className="card data-sync-form-card data-sync-card--sub">
          <h2 className="data-sync-card-title">从 cURL 导入</h2>
          <p className="muted tiny data-sync-hint">
            粘贴 Apifox「复制 cURL」后解析，将覆盖当前 URL、方法、请求头；若 cURL 中带非空 Body 则一并写入请求体，否则保留原请求体。解析后不会清空本框，可自行编辑或删除。
          </p>
          <textarea
            className="fld data-sync-curl data-sync-textarea-fill"
            value={curlImportText}
            onChange={(e) => setCurlImportText(e.target.value)}
            spellCheck={false}
            placeholder={"curl --location --request POST 'https://...' \\\n--header '...' \\\n--data-raw '...'"}
          />
          {importError ? <p className="data-sync-error">{importError}</p> : null}
          {importWarnings.length > 0 ? (
            <ul className="data-sync-warnings">
              {importWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="primary-btn data-sync-btn-block" onClick={handleImportCurl}>
            解析并写入当前配置
          </button>
        </div>

        <div className="card data-sync-form-card data-sync-card--sub">
          <div className="card-head tight">
            <h2 className="data-sync-card-title">接口测试</h2>
            <button
              type="button"
              className="primary-btn"
              onClick={() => void handleRunTest()}
              disabled={testPhase === "running"}
            >
              {testPhase === "running" ? "请求中…" : "发送测试请求"}
            </button>
          </div>
          <p className="muted tiny data-sync-hint">
            测试返回成功（2xx）时，会自动将「数据列表 → 清洗后的 JSON」中的<strong>当前清洗方式、自然语言规则与脚本分组配置草稿</strong>写入配置，并触发清洗结果生成（与点击「保存清洗规则」相同）。请在「数据列表」中查看业务数据、原始 JSON 与清洗结果。
          </p>
          {testError ? <p className="data-sync-error">{testError}</p> : null}
          {testHttpStatus !== null ? (
            <p className="data-sync-test-meta">
              状态码 <strong>{testHttpStatus}</strong>
              {testDurationMs !== null ? (
                <>
                  {" "}
                  · 耗时 <strong>{testDurationMs}</strong> ms
                </>
              ) : null}
            </p>
          ) : null}
          {testResponseHeaders ? (
            <details className="data-sync-details">
              <summary>响应头</summary>
              <pre className="data-sync-pre data-sync-pre--compact">{testResponseHeaders}</pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  const rawJsonPanel = (
    <div className="card data-sync-form-card data-sync-data-card">
      {!cachedResponseBody.trim() ? (
        <p className="muted">暂无数据。请先在「接口基础配置」中发送测试请求，成功后将在此展示原始 JSON。</p>
      ) : parsedJson !== null ? (
        <pre className="data-sync-pre">{JSON.stringify(parsedJson, null, 2)}</pre>
      ) : (
        <pre className="data-sync-pre">{cachedResponseBody}</pre>
      )}
    </div>
  );

  const cleanedJsonPanel = selected ? (
    <div className="card data-sync-form-card data-sync-data-card data-sync-custom-panel">
      <h2 className="data-sync-card-title">清洗后的 JSON</h2>
      <p className="muted tiny data-sync-hint">
        默认推荐<strong>脚本（本地分组）</strong>；也可切换为<strong>大模型（自然语言）</strong>。保存后按所选方式基于「原始 JSON」生成结果；接口测试<strong>成功（2xx）</strong>时会自动写入当前页草稿并触发清洗；若仅修改未测接口，可点击「保存清洗规则」。
        {cleaningModeDraft === "llm" ? (
          llmEnvReady ? (
            <span className="data-sync-llm-ok"> 已检测到可用的大模型配置。</span>
          ) : (
            <span className="data-sync-llm-miss"> 请先在顶部「设置」中配置 DeepSeek API Key。</span>
          )
        ) : (
          <span className="data-sync-llm-ok"> 脚本模式不调用大模型，适合长 JSON 与确定性分组。</span>
        )}
      </p>
      <div className="data-sync-cleaning-mode-row" role="radiogroup" aria-label="清洗方式">
        <span className="data-sync-cleaning-mode-label muted tiny">清洗方式</span>
        <label className="data-sync-cleaning-mode-opt">
          <input
            type="radio"
            name={`data-hub-cleaning-mode-${selected.id}`}
            checked={cleaningModeDraft === "script"}
            onChange={() => setCleaningModeDraft("script")}
          />
          脚本（本地分组）
        </label>
        <label className="data-sync-cleaning-mode-opt">
          <input
            type="radio"
            name={`data-hub-cleaning-mode-${selected.id}`}
            checked={cleaningModeDraft === "llm"}
            onChange={() => setCleaningModeDraft("llm")}
          />
          大模型（自然语言）
        </label>
      </div>
      {cleaningModeDraft === "llm" ? (
        <label>
          自定义清洗规则（自然语言）
          <textarea
            className="fld data-sync-custom-prompt"
            value={cleaningRulesDraft}
            onChange={(e) => setCleaningRulesDraft(e.target.value)}
            spellCheck={false}
            placeholder={CLEANING_RULES_PLACEHOLDER}
            rows={8}
          />
        </label>
      ) : (
        <div className="data-sync-script-cleaning-block">
          <p className="muted tiny">
            将「列表路径」解析为数组后，对每一项取「行对象路径」上的对象，再按下列<strong>键名</strong>从行对象上读值并聚合为
            <code> 分公司名称 + 日报日期 + 车间日报列表[] </code>
            结构输出。键名须与<strong>原始 JSON</strong>中行对象内字段一致，可按接口实际列名自由修改（如 <code>分公司名称</code>、<code>所属车间</code> 等）。
          </p>
          <div className="data-sync-script-fields">
            <label>
              列表路径（点分，空=根为数组）
              <input
                className="fld"
                value={scriptSpecForm.listPath}
                onChange={(e) => setScriptSpecForm((s) => ({ ...s, listPath: e.target.value }))}
                placeholder="如 data.list"
                spellCheck={false}
              />
            </label>
            <label>
              行对象路径（点分，空=列表项即行）
              <input
                className="fld"
                value={scriptSpecForm.itemPath}
                onChange={(e) => setScriptSpecForm((s) => ({ ...s, itemPath: e.target.value }))}
                placeholder="如 variables"
                spellCheck={false}
              />
            </label>
            <label>
              分公司字段名（行对象上的键）
              <input
                className="fld"
                value={scriptSpecForm.branchField}
                onChange={(e) => setScriptSpecForm((s) => ({ ...s, branchField: e.target.value }))}
                placeholder="如 所属分公司"
                spellCheck={false}
              />
            </label>
            <label>
              车间字段名（行对象上的键）
              <input
                className="fld"
                value={scriptSpecForm.workshopField}
                onChange={(e) => setScriptSpecForm((s) => ({ ...s, workshopField: e.target.value }))}
                placeholder="如 所属车间"
                spellCheck={false}
              />
            </label>
            <label>
              日报日期字段名（行对象上的键）
              <input
                className="fld"
                value={scriptSpecForm.dateField}
                onChange={(e) => setScriptSpecForm((s) => ({ ...s, dateField: e.target.value }))}
                placeholder="如 日报日期"
                spellCheck={false}
              />
            </label>
            <label>
              正文/详情字段名（行对象上的键）
              <input
                className="fld"
                value={scriptSpecForm.detailField}
                onChange={(e) => setScriptSpecForm((s) => ({ ...s, detailField: e.target.value }))}
                placeholder="如 日报内容"
                spellCheck={false}
              />
            </label>
          </div>
        </div>
      )}
      <div className="data-sync-custom-actions">
        <button type="button" className="primary-btn" onClick={handleSaveCleaningRules}>
          保存清洗规则
        </button>
        {cleaningPhase === "running" && cleaningModeDraft === "llm" ? (
          <span className="muted tiny data-sync-cleaning-status">正在根据规则调用大模型清洗 JSON…</span>
        ) : null}
      </div>
      {cleaningError ? <p className="data-sync-error">{cleaningError}</p> : null}
      {cleanedJsonText ? (
        <div className="data-sync-custom-output">
          <div className="data-sync-custom-output-head muted tiny">清洗结果（JSON）</div>
          <pre className="data-sync-pre data-sync-pre--custom-out">{cleanedJsonText}</pre>
        </div>
      ) : (
        <p className="muted tiny">
          {!cachedResponseBody.trim()
            ? "请先发送接口测试以获取原始 JSON；测试成功后会自动保存当前配置并生成结果，亦可手动点击「保存清洗规则」。"
            : savedJsonCleaningMode === "script"
              ? savedJsonCleaningScriptSpec.trim()
                ? "若脚本配置有效，清洗结果将显示在此处；若上方有错误提示，请修正字段后再次保存。"
                : "脚本模式：请填写分组字段并点击「保存清洗规则」。"
              : savedJsonCleaningRules.trim()
                ? llmEnvReady
                  ? "清洗结果将显示在此处。"
                  : "请在顶部「设置」中配置大模型。"
                : "请填写自然语言清洗规则并保存。"}
        </p>
      )}
    </div>
  ) : null;

  const businessPanel = (
    <div className="card data-sync-form-card data-sync-data-card">
      {businessExtracted.columns.length === 0 ? (
        <p className="muted">
          未能从响应中解析出列表数据（需包含如 <code>data.list</code> 等数组结构）。请先成功拉取 JSON，或检查接口返回格式。
        </p>
      ) : (
        <>
          <details className="data-sync-field-picker">
            <summary>自定义展示字段（列）</summary>
            <p className="muted tiny data-sync-field-picker-dnd-hint">
              拖动「⠿」手柄调整字段顺序（横向排列、自动换行），下方「数据view」表格列会同步更新；未勾选的列不会出现在表格中。
            </p>
            <div className="data-sync-field-picker-actions">
              <button type="button" className="ghost-btn tiny-btn" onClick={() => setAllVisible(true)}>
                全选列
              </button>
              <button type="button" className="ghost-btn tiny-btn" onClick={() => setAllVisible(false)}>
                清空（不展示列后再勾选）
              </button>
            </div>
            <div className="data-sync-field-checkboxes" role="list" aria-label="自定义展示字段，可拖拽排序">
              {fieldPickerOrder.map((col, index) => (
                <div
                  key={col}
                  className="data-sync-field-picker-row"
                  role="listitem"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const raw =
                      e.dataTransfer.getData(DATA_HUB_FIELD_DRAG_MIME) ||
                      e.dataTransfer.getData("text/plain");
                    const from = parseInt(raw, 10);
                    if (!Number.isFinite(from)) return;
                    reorderFieldPickerColumns(from, index);
                  }}
                >
                  <span
                    className="data-sync-field-drag-handle"
                    draggable
                    title="拖动排序"
                    aria-label={`拖动排序：${col}`}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DATA_HUB_FIELD_DRAG_MIME, String(index));
                      e.dataTransfer.setData("text/plain", String(index));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    ⠿
                  </span>
                  <label className="data-sync-field-check-label">
                    <input
                      type="checkbox"
                      checked={colChecked(col)}
                      onChange={(e) => toggleVisibleField(col, e.target.checked)}
                    />
                    <span title={col}>{col}</span>
                  </label>
                </div>
              ))}
            </div>
          </details>

          <div className="data-sync-business-toolbar">
            <label className="data-sync-business-scope">
              <span className="muted tiny">查询范围</span>
              <select
                className="fld"
                value={businessFilterScope}
                onChange={(e) => setBusinessFilterScope(e.target.value as "all" | string)}
              >
                <option value="all">全部字段（列名或单元格）</option>
                {businessExtracted.columns.map((c) => (
                  <option key={c} value={c}>
                    仅字段：{c.length > 32 ? `${c.slice(0, 32)}…` : c}
                  </option>
                ))}
              </select>
            </label>
            <label className="data-sync-business-search">
              <span className="muted tiny">关键字</span>
              <input
                className="fld"
                placeholder="按列标题或内容筛选…"
                value={businessFilterQuery}
                onChange={(e) => setBusinessFilterQuery(e.target.value)}
              />
            </label>
          </div>

          <p className="muted tiny data-sync-row-count">
            共 {businessExtracted.rows.length} 条，当前显示 {filteredRows.length} 条 · 列数 {displayColumns.length}
          </p>

          <p className="muted tiny data-sync-cell-hint">提示：点击单元格可在右侧查看完整内容。</p>

          <div className="data-sync-table-wrap">
            <table className="data-sync-table">
              <thead>
                <tr>
                  {displayColumns.map((col) => (
                    <th key={col} title={col}>
                      {col.length > 24 ? `${col.slice(0, 24)}…` : col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, ri) => (
                  <tr key={ri}>
                    {displayColumns.map((col) => {
                      const full = row[col] ?? "";
                      const short =
                        full.length > CELL_PREVIEW_CHARS ? `${full.slice(0, CELL_PREVIEW_CHARS)}…` : full;
                      return (
                        <td key={col}>
                          <button
                            type="button"
                            className="data-sync-cell-btn"
                            onClick={() => openCellDetail(col, full, ri)}
                            title="点击查看完整内容"
                          >
                            <span className="data-sync-cell-preview">{short || "—"}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="data-sync-page">
      <div className="data-sync-head">
        <h1 className="data-sync-title">数据中台</h1>
        <p className="data-sync-desc muted">
          配置外部系统 HTTP 接口参数，支持从 Apifox 复制的 cURL 一键导入。测试请求由本机浏览器直接发起；若遇跨域（CORS）失败，请在开发环境配置
          Vite 代理或由服务端转发。左侧按数据源（平台）分组管理接口。
        </p>
      </div>

      <div className="data-sync-layout">
        <aside className="data-sync-sidebar card">
          <div className="data-sync-sidebar-head">
            <span className="data-sync-sidebar-title">接口来源</span>
            <button type="button" className="ghost-btn tiny-btn" onClick={handleAddPlatform} title="新增数据源">
              新增数据源
            </button>
          </div>
          <div className="data-sync-platform-tree" aria-label="按数据源分组的接口列表">
            {platforms.length === 0 ? (
              <p className="data-sync-list-empty muted">请点击「新增数据源」</p>
            ) : (
              platforms.map((pl) => {
                const expanded = expandedPlatforms.has(pl.id);
                const list = profilesByPlatform.get(pl.id) ?? [];
                return (
                  <div key={pl.id} className="data-sync-platform-block">
                    <div className="data-sync-platform-head">
                      <span className="data-sync-tree-icon data-sync-tree-icon--source" aria-hidden title="数据源" />
                      <button
                        type="button"
                        className="data-sync-platform-chevron"
                        aria-expanded={expanded}
                        onClick={() => togglePlatformExpanded(pl.id)}
                        title={expanded ? "折叠" : "展开"}
                      >
                        {expanded ? "▼" : "▶"}
                      </button>
                      {renamingPlatformId === pl.id ? (
                        <input
                          className="fld data-sync-platform-rename-input"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={commitRenamePlatform}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRenamePlatform();
                            if (e.key === "Escape") setRenamingPlatformId(null);
                          }}
                          autoFocus
                        />
                      ) : (
                        <span
                          className="data-sync-platform-title"
                          onDoubleClick={() => {
                            setRenamingPlatformId(pl.id);
                            setRenameDraft(pl.name);
                          }}
                          title="双击重命名"
                        >
                          {pl.name}
                        </span>
                      )}
                      <div className="data-sync-platform-actions">
                        <button
                          type="button"
                          className="text-btn"
                          onClick={() => {
                            setRenamingPlatformId(pl.id);
                            setRenameDraft(pl.name);
                          }}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="primary-btn tiny-btn"
                          onClick={() => handleAddProfile(pl.id)}
                        >
                          添加接口
                        </button>
                        <button
                          type="button"
                          className="text-btn danger"
                          onClick={() => handleDeletePlatform(pl.id)}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    {expanded ? (
                      <ul className="data-sync-list data-sync-list--nested">
                        {list.length === 0 ? (
                          <li className="data-sync-list-empty muted">暂无接口，点击「添加接口」</li>
                        ) : (
                          list.map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                className={
                                  p.id === selectedId
                                    ? "data-sync-list-item data-sync-list-item--active data-sync-list-item--leaf"
                                    : "data-sync-list-item data-sync-list-item--leaf"
                                }
                                onClick={() => {
                                  setSelectedId(p.id);
                                  setImportError(null);
                                  setTestError(null);
                                }}
                              >
                                <span className="data-sync-tree-icon data-sync-tree-icon--api" aria-hidden />
                                <span className="data-sync-list-item-text">
                                  <span className="data-sync-list-name">{p.name || "未命名"}</span>
                                  {p.lastTestSummary ? (
                                    <span
                                      className={
                                        p.lastTestOk === false ? "data-sync-list-meta warn" : "data-sync-list-meta"
                                      }
                                    >
                                      {p.lastTestSummary}
                                    </span>
                                  ) : (
                                    <span className="data-sync-list-meta muted">未测试</span>
                                  )}
                                </span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <section className="data-sync-detail">
          {!selected ? (
            <div className="card data-sync-placeholder">请选择左侧接口或添加数据源与接口</div>
          ) : (
            <>
              <div className="report-main-tabs data-sync-main-tabs" role="tablist" aria-label="数据中台主分类">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mainTab === "basic"}
                  className={`report-main-tab${mainTab === "basic" ? " is-active" : ""}`}
                  onClick={() => setMainTab("basic")}
                >
                  接口基础配置
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mainTab === "data"}
                  className={`report-main-tab${mainTab === "data" ? " is-active" : ""}`}
                  onClick={() => setMainTab("data")}
                >
                  数据列表
                </button>
              </div>

              {mainTab === "basic" ? (
                basicPanel
              ) : (
                <>
                  <div className="report-main-tabs data-sync-subtabs" role="tablist" aria-label="数据列表视图">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={dataSubTab === "business"}
                      className={`report-main-tab${dataSubTab === "business" ? " is-active" : ""}`}
                      onClick={() => setDataSubTab("business")}
                    >
                      数据view
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={dataSubTab === "rawJson"}
                      className={`report-main-tab${dataSubTab === "rawJson" ? " is-active" : ""}`}
                      onClick={() => setDataSubTab("rawJson")}
                    >
                      原始JSON数据
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={dataSubTab === "cleanedJson"}
                      className={`report-main-tab${dataSubTab === "cleanedJson" ? " is-active" : ""}`}
                      onClick={() => setDataSubTab("cleanedJson")}
                    >
                      清洗后的JSON数据
                    </button>
                  </div>
                  {dataSubTab === "business"
                    ? businessPanel
                    : dataSubTab === "rawJson"
                      ? rawJsonPanel
                      : cleanedJsonPanel}
                </>
              )}
            </>
          )}
        </section>
      </div>

      {cellDetail ? (
        <div
          className="data-sync-drawer-backdrop"
          role="presentation"
          onClick={() => setCellDetail(null)}
        >
          <aside
            className="data-sync-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-sync-drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="data-sync-drawer-head">
              <h2 id="data-sync-drawer-title" className="data-sync-drawer-title">
                {cellDetail.columnTitle}
              </h2>
              <span className="data-sync-drawer-meta muted tiny">第 {cellDetail.rowIndex + 1} 行</span>
              <button
                type="button"
                className="data-sync-drawer-close ghost-btn tiny-btn"
                onClick={() => setCellDetail(null)}
                aria-label="关闭"
              >
                关闭
              </button>
            </div>
            <div className="data-sync-drawer-body">
              <pre className="data-sync-drawer-pre">{cellDetail.text || "（空）"}</pre>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
