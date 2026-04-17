/**
 * @fileoverview 部门架构编辑框：支持「每行一条」或 JSON；解析后得到规范化文本与可选的当前视角建议。
 */

import { perspectiveLabelFromOrgLine } from "./leaderPerspective";

export type ParseOrgStructureResult =
  | {
      ok: true;
      linesText: string;
      /** JSON 中指定且与新架构下拉选项一致时，用于更新当前视角 */
      suggestedPerspective?: string;
      /** JSON 中写了视角但不在新选项内 */
      ignoredPerspective?: string;
    }
  | { ok: false; error: string };

function perspectiveOptionsSet(lines: string[]): Set<string> {
  return new Set(lines.map(perspectiveLabelFromOrgLine).filter(Boolean));
}

/** 公司架构 JSON：`structure` 树展开为「一级.二级.三级」路径，每节点一行 */
function flattenOrgStructureNodes(nodes: unknown, parentPath: string): string[] {
  if (!Array.isArray(nodes)) return [];
  const out: string[] = [];
  for (const raw of nodes) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const nameRaw = o.name;
    if (typeof nameRaw !== "string" || !nameRaw.trim()) continue;
    const name = nameRaw.trim();
    const path = parentPath ? `${parentPath}.${name}` : name;
    out.push(path);
    const ch = o.children;
    if (Array.isArray(ch) && ch.length) out.push(...flattenOrgStructureNodes(ch, path));
  }
  return out;
}

function tryExtractLinesFromCompanyStructureRoot(parsed: unknown): string[] | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const struct = o.structure;
  if (!Array.isArray(struct) || struct.length === 0) return null;
  const lines = flattenOrgStructureNodes(struct, "");
  return lines.length ? lines : null;
}

/** 将 JSON 数组单项转为部门/架构行名称（支持字符串或 { name } 等常见对象形态） */
function normalizeJsonLineEntry(entry: unknown): string | null {
  if (entry === null || entry === undefined) return null;
  if (typeof entry === "string") {
    const t = entry.trim();
    return t || null;
  }
  if (typeof entry === "number" && Number.isFinite(entry)) {
    return String(entry);
  }
  if (typeof entry === "object" && !Array.isArray(entry)) {
    const o = entry as Record<string, unknown>;
    const nameKeys = [
      "name",
      "label",
      "title",
      "department",
      "unit",
      "orgName",
      "line",
      "value",
      "名称",
      "部门",
      "分公司",
    ] as const;
    for (const k of nameKeys) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
  }
  return null;
}

function extractLinesFromJsonArray(arr: unknown[]): string[] {
  const out: string[] = [];
  for (const x of arr) {
    const line = normalizeJsonLineEntry(x);
    if (line) out.push(line);
  }
  return out;
}

function extractLinesFromJson(parsed: unknown): string[] | null {
  if (Array.isArray(parsed)) {
    const lines = extractLinesFromJsonArray(parsed);
    return lines.length ? lines : null;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const fromTree = tryExtractLinesFromCompanyStructureRoot(parsed);
    if (fromTree) return fromTree;
    const o = parsed as Record<string, unknown>;
    const keys = ["lines", "departments", "orgStructure", "组织架构", "部门列表"] as const;
    for (const k of keys) {
      const v = o[k];
      if (Array.isArray(v)) {
        const lines = extractLinesFromJsonArray(v);
        if (lines.length) return lines;
      }
    }
  }
  return null;
}

function extractPerspectiveFromJson(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const o = parsed as Record<string, unknown>;
  const keys = ["currentPerspective", "perspective", "defaultPerspective", "当前视角"] as const;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * 解析系统配置中「部门架构」文本框内容：多行文本，或 JSON（对象含 lines 等 / 根为字符串数组）。
 */
export function parseOrgStructureUserInput(raw: string): ParseOrgStructureResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "内容不能为空。" };

  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (looksJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return { ok: false, error: "JSON 格式无法解析，请检查括号、引号与逗号。" };
    }
    const lines = extractLinesFromJson(parsed);
    if (!lines?.length) {
      return {
        ok: false,
        error:
          "JSON 中未解析出任何部门名称。可使用根字段 structure（树形，每项 name + 可选 children）；或 lines 等字符串/对象扁平数组。勿直接放入未序列化的对象。",
      };
    }
    if (lines.some((l) => l === "[object Object]")) {
      return {
        ok: false,
        error:
          "部门名称中出现了无效占位「[object Object]」，通常表示 JSON 里把对象当成了字符串。请改为字符串数组，或为对象项填写 name / label / department 等字段后再保存。",
      };
    }
    const linesText = lines.join("\n");
    const opts = perspectiveOptionsSet(lines);
    const rawPerspective = extractPerspectiveFromJson(parsed);
    let suggestedPerspective: string | undefined;
    let ignoredPerspective: string | undefined;
    if (rawPerspective) {
      if (opts.has(rawPerspective)) suggestedPerspective = rawPerspective;
      else ignoredPerspective = rawPerspective;
    }
    return { ok: true, linesText, suggestedPerspective, ignoredPerspective };
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, error: "请至少填写一条部门或分公司名称（每行一条）。" };
  return { ok: true, linesText: lines.join("\n") };
}
