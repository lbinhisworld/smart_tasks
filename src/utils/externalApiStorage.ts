/**
 * @fileoverview 数据中台：数据源（平台）与接口配置的 localStorage 读写、从旧版扁平列表迁移。
 *
 * @module utils/externalApiStorage
 */

import type { DataPlatform, ExternalApiProfile } from "../types/externalApiProfile";

const LEGACY_KEY = "qifeng_external_api_profiles_v1";
const STATE_KEY = "qifeng_data_hub_state_v1";

/** 持久化根结构 */
interface DataHubStateV2 {
  version: 2;
  platforms: DataPlatform[];
  profiles: ExternalApiProfile[];
}

function isHeaderRow(x: unknown): x is { key: string; value: string } {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as { key?: unknown }).key === "string" &&
    typeof (x as { value?: unknown }).value === "string"
  );
}

function normalizeProfile(raw: unknown, defaultPlatformId: string): ExternalApiProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const method = typeof o.method === "string" ? o.method.trim().toUpperCase() : "GET";
  const url = typeof o.url === "string" ? o.url.trim() : "";
  if (!id || !name || !url) return null;
  const headers = Array.isArray(o.headers) ? o.headers.filter(isHeaderRow) : [];
  const platformId =
    typeof o.platformId === "string" && o.platformId.trim() ? o.platformId.trim() : defaultPlatformId;
  return {
    id,
    platformId,
    name,
    enabled: o.enabled !== false,
    method: method || "GET",
    url,
    headers,
    body: typeof o.body === "string" ? o.body : "",
    notes: typeof o.notes === "string" ? o.notes : "",
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
    lastTestAt: typeof o.lastTestAt === "number" ? o.lastTestAt : undefined,
    lastTestSummary: typeof o.lastTestSummary === "string" ? o.lastTestSummary : undefined,
    lastTestOk: typeof o.lastTestOk === "boolean" ? o.lastTestOk : undefined,
    visibleBusinessFields: Array.isArray(o.visibleBusinessFields)
      ? (o.visibleBusinessFields as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined,
    jsonCleaningRules:
      typeof o.jsonCleaningRules === "string"
        ? o.jsonCleaningRules
        : typeof (o as { customDataFormatPrompt?: unknown }).customDataFormatPrompt === "string"
          ? String((o as { customDataFormatPrompt: string }).customDataFormatPrompt)
          : undefined,
  };
}

function normalizePlatform(raw: unknown): DataPlatform | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!id || !name) return null;
  return { id, name };
}

/**
 * 读取完整数据中台状态；自动从旧版「仅接口数组」迁移。
 */
export function loadDataHubState(): { platforms: DataPlatform[]; profiles: ExternalApiProfile[] } {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as DataHubStateV2).version === 2 &&
        Array.isArray((parsed as DataHubStateV2).platforms) &&
        Array.isArray((parsed as DataHubStateV2).profiles)
      ) {
        const p = parsed as DataHubStateV2;
        const platforms = p.platforms.map(normalizePlatform).filter((x): x is DataPlatform => x !== null);
        const defaultPid = platforms[0]?.id ?? "";
        const profiles = p.profiles
          .map((row) => normalizeProfile(row, defaultPid))
          .filter((x): x is ExternalApiProfile => x !== null);
        if (platforms.length === 0) {
          const pl = createDefaultPlatform();
          return { platforms: [pl], profiles: profiles.map((pr) => ({ ...pr, platformId: pl.id })) };
        }
        return { platforms, profiles };
      }
    }

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as unknown;
      const defaultPl = createDefaultPlatform();
      if (Array.isArray(parsed)) {
        const profiles = parsed
          .map((row) => normalizeProfile(row, defaultPl.id))
          .filter((x): x is ExternalApiProfile => x !== null);
        const state: DataHubStateV2 = { version: 2, platforms: [defaultPl], profiles };
        saveDataHubState(state.platforms, state.profiles);
        try {
          localStorage.removeItem(LEGACY_KEY);
        } catch {
          /* ignore */
        }
        return { platforms: state.platforms, profiles: state.profiles };
      }
    }
  } catch {
    /* ignore */
  }

  const pl = createDefaultPlatform();
  return { platforms: [pl], profiles: [] };
}

/**
 * 持久化数据源与接口列表。
 */
export function saveDataHubState(platforms: DataPlatform[], profiles: ExternalApiProfile[]): void {
  const state: DataHubStateV2 = { version: 2, platforms, profiles };
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

/**
 * @deprecated 使用 {@link loadDataHubState}
 */
export function loadExternalApiProfiles(): ExternalApiProfile[] {
  return loadDataHubState().profiles;
}

/**
 * @deprecated 使用 {@link saveDataHubState}
 */
export function saveExternalApiProfiles(profiles: ExternalApiProfile[]): void {
  const { platforms } = loadDataHubState();
  saveDataHubState(platforms.length ? platforms : [createDefaultPlatform()], profiles);
}

function createDefaultPlatform(): DataPlatform {
  return { id: crypto.randomUUID(), name: "默认数据源" };
}

/**
 * 新建数据源。
 */
export function createEmptyPlatform(name?: string): DataPlatform {
  return {
    id: crypto.randomUUID(),
    name: (name?.trim() || `数据源 ${new Date().toLocaleString("zh-CN", { hour12: false })}`).slice(0, 64),
  };
}

/**
 * 新建一条接口配置，须指定所属数据源 id。
 * @param platformId 数据源 id
 */
export function createEmptyProfile(platformId: string): ExternalApiProfile {
  return {
    id: crypto.randomUUID(),
    platformId,
    name: "未命名接口",
    enabled: true,
    method: "GET",
    url: "https://",
    headers: [],
    body: "",
    notes: "",
    updatedAt: Date.now(),
  };
}
