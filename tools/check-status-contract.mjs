#!/usr/bin/env node
/**
 * status 文档 ↔ 面板字段契约检查。
 *
 * 为什么需要它：2026-10-18 一天内，2.4.0 的新面板因为「字段名对不上」连爆四次
 *   · 余额：宿主发 `credits: {total, packages}`，面板按数字读 → 整列 `—`
 *   · 最近使用：宿主根本不发 `lastUsedAt` → 整列空
 *   · 任务「执行时刻」：面板读 `job.hours`，宿主发在 `automation.taskHours`（还是单数）
 *   · 任务「上次执行」：面板读 `job.lastAt`，宿主发 `job.lastRunAtMs`
 *   · 今日已签账号：面板读 `earningsToday.accounts` 数组，宿主发 `{accountId: {...}}` 映射
 *
 * 这一整类故障的共同点：**界面照常渲染，只是那一格是空的**。没有异常、没有日志、
 * 加载检查（tools/verify-client-loads.mjs）也全绿 —— 只能靠"看"发现。
 *
 * 所以这个脚本把「面板依赖的每个字段」写成断言，直接对**运行中宿主**的 status 文档核。
 * 它不测渲染，只测数据形状；数据形状不对，界面一定是错的。
 *
 * 用法：
 *   node tools/check-status-contract.mjs            # 打 19387
 *   node tools/check-status-contract.mjs http://127.0.0.1:19387
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:19387';
const PLUGIN = '/plugins/dsh-rotakit';
const REGIONS = ['cn', 'global'];

const JOB_KINDS = ['checkin', 'report', 'tasks', 'streak', 'travel'];
/** 面板用 `${kind.key}Hours` 取时刻，注意 tasks 的键是 **taskHours**（单数）。 */
const HOUR_KEYS = ['checkinHours', 'reportHours', 'taskHours', 'streakHours', 'travelHours'];

let pass = 0;
const failures = [];

const ok = (label) => { pass += 1; console.log(`  ok   ${label}`); };
const bad = (label, detail) => {
  failures.push(`${label}${detail === undefined ? '' : ` — ${detail}`}`);
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`);
};
const need = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 可选的 ISO 时间串：字段缺失是合法的（"从未使用"），存在就必须能解析。 */
function optionalIso(value) {
  if (value === undefined) return true;
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

function checkStatusDoc(region, doc) {
  console.log(`\n=== ${region} ===`);
  need(isObj(doc), 'status 是对象');
  need(doc.region === region, `doc.region === "${region}"`, `实际 ${JSON.stringify(doc.region)}（面板区域列拿它兜底）`);
  need(Array.isArray(doc.accounts), 'accounts 是数组');
  need(Array.isArray(doc.models), 'models 是数组');

  /* ── 账号行 ─────────────────────────────────────────────── */
  const rows = Array.isArray(doc.accounts) ? doc.accounts : [];
  need(rows.length > 0, '至少一个账号（空池无法验证行契约）');
  const withCredits = rows.filter((row) => isObj(row.credits) && isNum(row.credits.total));
  const failedRead = rows.filter((row) => row.creditsError !== undefined);
  need(
    withCredits.length + failedRead.length === rows.length,
    '每个账号要么有 credits.total，要么有 creditsError',
    `${rows.length - withCredits.length - failedRead.length} 行两者都没有（面板会显示 —）`,
  );
  need(
    withCredits.every((row) => Array.isArray(row.credits.packages)),
    'credits.packages 是数组',
  );
  need(rows.every((row) => isNum(row.creditReserve)), 'creditReserve 是数字（保留线列）');
  need(rows.every((row) => typeof row.disabled === 'boolean'), 'disabled 是布尔（状态列）');
  need(rows.every((row) => typeof row.cooling === 'boolean'), 'cooling 是布尔（状态列）');
  need(rows.every((row) => isNum(row.rateLimitHits)), 'rateLimitHits 是数字（限流次数列）');
  need(rows.every((row) => optionalIso(row.lastUsedAt)), 'lastUsedAt 在时是 ISO 串（最近使用列）');
  need(rows.every((row) => typeof row.label === 'string' && row.label !== ''), 'label 是非空串');

  /* ── 模型 + 启用范围（模型启用面板）─────────────────────── */
  const models = Array.isArray(doc.models) ? doc.models : [];
  need(models.every((m) => typeof m.id === 'string' && m.id !== ''), 'models[].id 是非空串');
  need(models.every((m) => typeof m.enabled === 'boolean'), 'models[].enabled 是布尔（启用列勾选态）');
  need(isObj(doc.selection), 'selection 是对象');
  need(
    Array.isArray(doc.selection?.enabledModelIds),
    'selection.enabledModelIds 是数组',
    '面板用它算初始勾选；为空数组 = 该区域一个模型都不启用',
  );
  need(Array.isArray(doc.selection?.imageModelIds), 'selection.imageModelIds 是数组');

  /* ── 自动任务（任务页）──────────────────────────────────── */
  const automation = doc.automation;
  need(isObj(automation), 'automation 是对象');
  if (isObj(automation)) {
    for (const key of HOUR_KEYS) {
      need(Array.isArray(automation[key]), `automation.${key} 是数组（执行时刻列）`, `实际 ${typeof automation[key]}`);
    }
    for (const key of JOB_KINDS) {
      const job = automation.jobs?.[key];
      need(isObj(job), `automation.jobs.${key} 存在`);
      if (!isObj(job)) continue;
      need(isNum(job.ok) || typeof job.ok === 'boolean', `jobs.${key}.ok 是计数或布尔`);
      need(isNum(job.failed), `jobs.${key}.failed 是数字（状态列）`, `实际 ${typeof job.failed}`);
      /*
       * `lastRunAtMs` 是**进程内**状态：重启后到该任务第一次跑之前就是 undefined，
       * 面板那一格理应为空。所以只要求"在时是数字"，不要求恒存在。
       * （想让它跨重启可见，得把调度器运行记录落盘 —— 见优化清单 P2。）
       */
      need(
        job.lastRunAtMs === undefined || isNum(job.lastRunAtMs),
        `jobs.${key}.lastRunAtMs 在时是数字（上次执行列）`,
        `实际 ${typeof job.lastRunAtMs}`,
      );
    }
    need(
      isObj(automation.earningsToday),
      'automation.earningsToday 是 {accountId: {...}} 映射',
      '面板会把它归一成数组；若宿主改回 {accounts:[]} 形态，这里应当同步改',
    );
    const sample = Object.values(automation.earningsToday ?? {}).find(isObj);
    if (sample !== undefined) {
      need(isNum(sample.credit) || sample.credit === undefined, 'earningsToday[*].credit 是数字');
    }
  }
}

async function main() {
  console.log(`status 契约检查 @ ${BASE}`);
  for (const region of REGIONS) {
    const doc = await get(`${PLUGIN}/status?region=${region}`);
    checkStatusDoc(region, doc);
  }
  const failed = failures.length;
  console.log(`\n${pass} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\n失败项：');
    for (const line of failures) console.log(`  · ${line}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`无法完成检查：${error.message}`);
  console.error('宿主没起或 19387 不可达时无法验证契约。');
  process.exitCode = 2;
});
