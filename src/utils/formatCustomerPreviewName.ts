/**
 * CSV 保存为销售数据预览时，将「往来户名称」规范为【缩写】公司：
 * 去掉开头的行政区片段后，取至多 5 个字作为缩写；缩写中间两个字替换为 **（脱敏展示）。
 */

const LEGAL_SUFFIX_RE = /(股份有限公司|有限责任公司|有限公司|股份公司|集团有限公司|集团)$/u;

/** 自字符串开头逐级剥离的行政区后缀（较长者优先，避免误匹配短后缀） */
const ADMIN_START_SUFFIXES: string[] = [
  "特别行政区",
  "壮族自治区",
  "回族自治区",
  "维吾尔自治区",
  "自治区",
  "省",
  "市",
  "州",
  "盟",
  "地区",
  "县",
  "区",
  "旗",
];

function stripLegalSuffixes(s: string): string {
  let t = s.trim();
  let guard = 0;
  while (guard++ < 20 && LEGAL_SUFFIX_RE.test(t)) {
    t = t.replace(LEGAL_SUFFIX_RE, "").trim();
  }
  return t;
}

function stripLeadingAdminRegions(s: string): string {
  let t = s.trim();
  let guard = 0;
  while (guard++ < 30) {
    let changed = false;
    for (const suf of ADMIN_START_SUFFIXES) {
      const re = new RegExp(`^[\\u4e00-\\u9fff]{1,18}${suf}`);
      const m = t.match(re);
      if (m) {
        t = t.slice(m[0].length).trim();
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return t;
}

/** 将缩写中间两个字符替换为字面量 **（奇数长度 3 字时为「首 + ** + 尾」；≤2 字则整段为 **） */
function maskAbbrevMiddleTwo(abbrev: string): string {
  const u = Array.from(abbrev);
  const n = u.length;
  if (n <= 0) return "";
  if (n <= 2) return "**";
  if (n === 3) return `${u[0]}**${u[2]}`;
  const start = n % 2 === 1 ? Math.floor(n / 2) : n / 2 - 1;
  return `${u.slice(0, start).join("")}**${u.slice(start + 2).join("")}`;
}

/**
 * @param raw - 往来户名称原始单元格文本
 * @returns 形如 `【麒胜**材】公司`；原始为空则返回空字符串
 */
export function formatCustomerPreviewName(raw: string): string {
  const orig = raw.trim();
  if (!orig) return "";

  let core = stripLegalSuffixes(orig);
  core = stripLeadingAdminRegions(core);
  core = stripLegalSuffixes(core);
  core = core.trim();

  let abbrev = Array.from(core).slice(0, 5).join("");
  if (!abbrev) {
    abbrev = Array.from(stripLegalSuffixes(stripLeadingAdminRegions(orig))).slice(0, 5).join("");
  }
  if (!abbrev) {
    abbrev = Array.from(orig).slice(0, 5).join("");
  }

  return `【${maskAbbrevMiddleTwo(abbrev)}】公司`;
}
