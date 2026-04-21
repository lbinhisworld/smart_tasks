/**
 * @fileoverview 命令行向企业微信智能表格 Webhook 发送一条 `add_records` 测试数据（与 App 默认列 id、Apifox 字符串形态一致）。
 *
 * 用法（PowerShell 示例）：
 * ```powershell
 * $env:SMARTSHEET_WEBHOOK_URL="https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=你的key"
 * npm run smartsheet:test-webhook
 * ```
 *
 * 若列 id 与贵司表不一致，可覆盖环境变量（均为可选，缺省用内置文档示例 id）：
 * `SMARTSHEET_F_INITIATOR`、`SMARTSHEET_F_DEPARTMENT`、… 或整段 JSON：`SMARTSHEET_VALUES_JSON='{"f6SjhW":"张三"}'`
 * （仅当设置 `SMARTSHEET_VALUES_JSON` 时，其它 F_* 忽略，且须为合法 JSON 对象字符串。）
 */

const url = process.env.SMARTSHEET_WEBHOOK_URL?.trim();
if (!url) {
  console.error(
    "未设置环境变量 SMARTSHEET_WEBHOOK_URL。\n" +
      "请从企业微信智能表 Webhook 配置页复制完整 URL（含 key=），再执行：\n" +
      '  $env:SMARTSHEET_WEBHOOK_URL="https://qyapi.weixin.qq.com/...webhook?key=..."\n' +
      "  npm run smartsheet:test-webhook",
  );
  process.exit(1);
}

/** @type {Record<string, string>} */
let values;
const rawOverride = process.env.SMARTSHEET_VALUES_JSON?.trim();
if (rawOverride) {
  try {
    values = JSON.parse(rawOverride);
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error("SMARTSHEET_VALUES_JSON 须为 JSON 对象");
    }
  } catch (e) {
    console.error("SMARTSHEET_VALUES_JSON 解析失败:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
} else {
  const g = (k, def) => (process.env[k]?.trim() || def);
  const noonMs = (isoDate) => {
    const ms = new Date(`${isoDate}T12:00:00`).getTime();
    return Number.isFinite(ms) ? String(ms) : String(Date.now());
  };
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  values = {
    [g("SMARTSHEET_F_INITIATOR", "f6SjhW")]: "CLI自动化测试-发起人",
    [g("SMARTSHEET_F_DEPARTMENT", "fZH7pY")]: "行政部",
    [g("SMARTSHEET_F_EXEC_DEPT", "f16De8")]: "华林分公司",
    [g("SMARTSHEET_F_RECEIVER", "fKbWx2")]: "财务部",
    [g("SMARTSHEET_F_CATEGORY", "fJHWpA")]: "安全生产",
    [g("SMARTSHEET_F_MOTIVATION", "fLPVvn")]: "CLI 推送探针：验证 Webhook 与列 id。",
    [g("SMARTSHEET_F_DESCRIPTION", "feD5kT")]: `smart_tasks/scripts/push-smartsheet-webhook-test.mjs @ ${new Date().toISOString()}`,
    [g("SMARTSHEET_F_DUE_MS", "f5RQdB")]: noonMs(iso),
    [g("SMARTSHEET_F_STATUS", "fyPpwG")]: "进行中",
  };
}

const body = { add_records: [{ values }] };

console.log("POST", url.replace(/key=[^&]+/i, "key=***"));
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log("HTTP", res.status);
console.log(text);
try {
  const j = JSON.parse(text);
  if (typeof j.errcode === "number" && j.errcode !== 0) {
    process.exit(2);
  }
} catch {
  if (!res.ok) process.exit(2);
}
