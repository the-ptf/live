// Cloudflare Realtime pricing: video sent out by the SFU, the first 1,000 GB of each month free, then $0.05 a GB. TURN is
// free when used with the SFU, so it is shown but never billed. https://developers.cloudflare.com/realtime/sfu/pricing/
export const FREE_GB_PER_MONTH = 1000;
export const USD_PER_GB = 0.05;
const GB = 1e9;

/**
 * Turns Cloudflare's daily SFU egress into what it costs: per calendar month (UTC) the GB sent, what is past the free
 * allowance, and its price, plus the totals since the first day reported.
 */
export function costOf(days, { freeGb = FREE_GB_PER_MONTH, perGb = USD_PER_GB } = {}) {
  const months = new Map();
  for (const { date, bytes } of days) {
    const month = date.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + bytes / GB);
  }
  const rows = [...months]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, gb]) => {
      const billableGb = Math.max(0, gb - freeGb);
      return { month, gb, billableGb, cost: billableGb * perGb, freeLeftGb: Math.max(0, freeGb - gb) };
    });
  return {
    months: rows,
    totalGb: rows.reduce((sum, row) => sum + row.gb, 0),
    totalCost: rows.reduce((sum, row) => sum + row.cost, 0),
  };
}

export const USAGE_QUERY = `query($account: String!, $start: Date!, $end: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    sfu: callsUsageAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) { sum { egressBytes } dimensions { date } }
    turn: callsTurnUsageAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) { sum { egressBytes } dimensions { date } }
  } }
}`;

/** Sums Cloudflare's GraphQL answer into one row per date: SFU bytes (billed) and TURN bytes (free with the SFU). */
export function daysFrom(answer) {
  const account = answer?.data?.viewer?.accounts?.[0];
  if (!account) throw new Error(answer?.errors?.[0]?.message ?? "no usage in the answer");
  const days = new Map();
  for (const [kind, rows] of [
    ["bytes", account.sfu ?? []],
    ["turnBytes", account.turn ?? []],
  ])
    for (const row of rows) {
      const day = days.get(row.dimensions.date) ?? { date: row.dimensions.date, bytes: 0, turnBytes: 0 };
      day[kind] += row.sum.egressBytes;
      days.set(row.dimensions.date, day);
    }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Where this month ends if the pace holds: the pace is the average GB a day over the last complete days (up to a week,
 * never before the first day with any video), today counts as it stands, and every day left sends the pace.
 */
export function forecastOf(days, today, { freeGb = FREE_GB_PER_MONTH, perGb = USD_PER_GB, windowDays = 7 } = {}) {
  const gbOn = new Map(days.map((day) => [day.date, day.bytes / GB]));
  const first = days.find((day) => day.bytes > 0)?.date;
  const window = [];
  for (let back = 1; back <= windowDays; back++) {
    const date = shiftDate(today, -back);
    if (!first || date < first) break;
    window.push(gbOn.get(date) ?? 0);
  }
  const todayGb = gbOn.get(today) ?? 0;
  const perDay = window.length ? window.reduce((sum, gb) => sum + gb, 0) / window.length : todayGb;
  const [year, monthNumber, dayOfMonth] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const month = today.slice(0, 7);
  const sent = [];
  let soFarGb = 0;
  for (let day = 1; day <= dayOfMonth; day++) {
    soFarGb += gbOn.get(`${month}-${String(day).padStart(2, "0")}`) ?? 0;
    sent.push(soFarGb);
  }
  const projectedGb = soFarGb + perDay * (daysInMonth - dayOfMonth);
  let freeRunsOutOn = null;
  if (soFarGb >= freeGb) freeRunsOutOn = today;
  else if (projectedGb > freeGb) freeRunsOutOn = shiftDate(today, Math.ceil((freeGb - soFarGb) / perDay));
  return {
    month,
    dayOfMonth,
    daysInMonth,
    perDay,
    basedOnDays: window.length,
    sent,
    soFarGb,
    projectedGb,
    projectedCost: Math.max(0, projectedGb - freeGb) * perGb,
    monthAtPaceCost: Math.max(0, perDay * 30 - freeGb) * perGb,
    freeRunsOutOn,
  };
}
