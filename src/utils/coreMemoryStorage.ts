/**
 * @fileoverview 《核心记忆模块》正文：默认来自构建时打包的 md，可在系统配置中编辑并覆盖到 localStorage。
 */

import coreMemoryBundled from "../../docs/核心记忆模块.md?raw";

const STORAGE_KEY = "qifeng_core_memory_md_override_v1";

export function getBundledCoreMemoryText(): string {
  return coreMemoryBundled.trim();
}

export function getCoreMemoryText(): string {
  try {
    const s = localStorage.getItem(STORAGE_KEY)?.trim();
    if (s) return s;
  } catch {
    /* ignore */
  }
  return getBundledCoreMemoryText();
}

export function setCoreMemoryText(md: string): void {
  try {
    const t = md.trim();
    if (!t) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* ignore */
  }
}
