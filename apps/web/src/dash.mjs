import { FREE_GB_PER_MONTH, forecastOf } from "./usage.mjs";

const COOKIE = "live_dash";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const signingKey = (password) =>
  crypto.subtle.importKey("raw", encoder.encode(`milagre-live-dash:${password}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sign = async (password, text) => hex(await crypto.subtle.sign("HMAC", await signingKey(password), encoder.encode(text)));

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

/** Compares digests, so the time taken says nothing about the password. */
export async function passwordMatches(given, password) {
  const digest = async (text) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
  return typeof given === "string" && sameText(await digest(given), await digest(password));
}

/** A session is `<expiry>.<HMAC of expiry>` keyed by the password, so changing the password signs everyone out. */
export async function sessionCookie(password, now) {
  const expires = now + SESSION_MS;
  return `${COOKIE}=${expires}.${await sign(password, String(expires))}; Path=/dash; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`;
}

export const signOutCookie = () => `${COOKIE}=; Path=/dash; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function signedIn(cookieHeader, password, now) {
  const value = (cookieHeader ?? "")
    .split(/;\s*/)
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const match = /^(\d{13})\.([0-9a-f]{64})$/.exec(value ?? "");
  if (!match || Number(match[1]) < now) return false;
  return sameText(await sign(password, match[1]), match[2]);
}

const escape = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const STYLE = `
:root{color-scheme:dark;--page:#0d1624;--surface:#172232;--field:#212c3c;--line:#273242;--ink:#e9eff7;--ink-2:#abb2bd;--ink-3:#939ca9;--green:#3cbb72;--red:#fd696d}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1080px;margin:0 auto;padding:24px 16px 48px;display:grid;gap:20px}
header{display:flex;align-items:center;gap:12px}h1{font-size:17px;margin:0;font-weight:600}.muted{color:var(--ink-3);font-size:12px}
header form{margin-left:auto}button{font:inherit;color:var(--ink);background:var(--field);border:0;border-radius:8px;height:32px;padding:0 12px;font-weight:600;cursor:pointer}
.cards{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.card{background:var(--surface);border-radius:12px;padding:14px 16px;box-shadow:0 0 0 1px var(--line)}
.card b{display:block;font-size:26px;font-weight:600;letter-spacing:-.02em}.card span{color:var(--ink-3);font-size:12px;font-weight:600}
h2{font-size:13px;margin:0;color:var(--ink-2);font-weight:600}
table{width:100%;border-collapse:collapse;background:var(--surface);border-radius:12px;overflow:hidden;box-shadow:0 0 0 1px var(--line)}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--ink-3);font-size:12px;font-weight:600}
tr:last-child td{border-bottom:0}a{color:#80b9fd;text-decoration:none}.tag{display:inline-block;padding:0 6px;border-radius:5px;background:var(--field);color:var(--ink-2);font-size:11px;font-weight:600;margin-left:4px}
.empty{background:var(--surface);border-radius:12px;padding:28px;text-align:center;color:var(--ink-3);box-shadow:0 0 0 1px var(--line)}
.login{min-height:100vh;display:grid;place-items:center;padding:24px}.login form{width:min(340px,100%);background:var(--surface);border-radius:12px;padding:24px;display:grid;gap:14px;box-shadow:0 0 0 1px var(--line)}
input{font:inherit;color:var(--ink);height:36px;padding:0 12px;border-radius:8px;border:1px solid #303b4a;background:var(--field)}.error{color:var(--red);margin:0;font-size:13px}
.login button{background:var(--ink);color:var(--surface);height:36px}
.charts{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))}
.chart-card{background:var(--surface);border-radius:12px;padding:14px 16px 12px;box-shadow:0 0 0 1px var(--line);display:grid;gap:10px}
.chart-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.chart-head b{font-weight:600}.legend{display:flex;gap:12px;color:var(--ink-3);font-size:12px;margin-left:auto}
.legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px}
.plot{position:relative;height:150px;margin-left:30px}.plot svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.plot .y{position:absolute;left:-30px;width:24px;text-align:right;color:var(--ink-3);font-size:11px;transform:translateY(-50%)}
.x{display:flex;justify-content:space-between;margin-left:30px;color:var(--ink-3);font-size:11px}
.grid line{stroke:var(--line);stroke-width:1}
.plot .free{position:absolute;right:0;transform:translateY(-120%);color:var(--red);font-size:11px;font-weight:600}
.wide{grid-column:1/-1}
@media(max-width:640px){.hide-small{display:none}}
`;

const page = (title, body, refresh = false) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">${refresh ? '<meta http-equiv="refresh" content="10">' : ""}<title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;

export function renderLogin(error = "") {
  return page(
    "Milagre Live stats",
    `<div class="login"><form method="post" action="/dash/login"><h1>Milagre Live stats</h1><input type="password" name="password" autocomplete="current-password" placeholder="Password" autofocus required>${error ? `<p class="error">${escape(error)}</p>` : ""}<button type="submit">Sign in</button></form></div>`,
  );
}

function niceMax(value) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((step) => step * power).find((step) => step >= value) ?? 10 * power;
}

function round(value) {
  if (value >= 10 || Number.isInteger(value)) return String(Math.round(value));
  return value >= 1 ? value.toFixed(1) : value.toFixed(2);
}

function frame(max, inner) {
  const ticks = [0, 0.5, 1];
  const grid = ticks.map((tick) => `<line x1="0" x2="100" y1="${100 - tick * 100}" y2="${100 - tick * 100}" vector-effect="non-scaling-stroke"/>`).join("");
  const labels = ticks.map((tick) => `<span class="y" style="top:${100 - tick * 100}%">${round(max * tick)}</span>`).join("");
  return `<div class="plot">${labels}<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g class="grid">${grid}</g>${inner}</svg></div>`;
}

/** Lines over the last 24 hours, the first one filled. */
function lineChart(points, series) {
  const max = niceMax(Math.max(...series.flatMap(({ key }) => points.map((point) => point[key]))));
  const x = (index) => (index / Math.max(points.length - 1, 1)) * 100;
  const y = (value) => 100 - (value / max) * 100;
  const path = (key) => points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(2)},${y(point[key]).toFixed(2)}`).join("");
  const shapes = series
    .map(({ key, color }, index) => {
      const line = `<path d="${path(key)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      return index ? line : `<path d="${path(key)}L100,100L0,100Z" fill="${color}" fill-opacity="0.16"/>${line}`;
    })
    .join("");
  return `${frame(max, shapes)}<div class="x"><span>24 h ago</span><span>18 h</span><span>12 h</span><span>6 h</span><span>now</span></div>`;
}

function barChart(days, key, color) {
  const max = niceMax(Math.max(...days.map((day) => day[key])));
  const width = 100 / days.length;
  const bars = days
    .map((day, index) => {
      const height = (day[key] / max) * 100;
      return `<rect x="${(index * width + width * 0.15).toFixed(2)}" y="${(100 - height).toFixed(2)}" width="${(width * 0.7).toFixed(2)}" height="${height.toFixed(2)}" rx="0.6" fill="${color}" fill-opacity="${index === days.length - 1 ? 1 : 0.75}"/>`;
    })
    .join("");
  const label = (date) => `${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;
  return `${frame(max, bars)}<div class="x"><span>${label(days[0].date)}</span><span>${label(days[Math.floor(days.length / 2)].date)}</span><span>today</span></div>`;
}

const legend = (items) =>
  `<div class="legend">${items.map(([label, color]) => `<span><i style="background:${color}"></i>${escape(label)}</span>`).join("")}</div>`;
const chartCard = (title, note, body) => `<div class="chart-card"><div class="chart-head"><b>${escape(title)}</b>${note}</div>${body}</div>`;

const BLUE = "#3e9afd";
const GREEN = "#3cbb72";
const PURPLE = "#ad46ff";

const usd = (value) => `$${value < 10 ? value.toFixed(2) : Math.round(value).toLocaleString("en-US")}`;
const gbText = (value) => `${round(value)} GB`;

/** Cloudflare's real video per day when the analytics token is set; the page's own upper bound otherwise. */
function videoChart(snapshot) {
  const real = snapshot.usage?.days;
  if (!real?.length) return chartCard("Video per day", '<span class="muted">GB, at most</span>', barChart(snapshot.days, "gb", PURPLE));
  const byDate = new Map(real.map((day) => [day.date, day.bytes / 1e9]));
  const days = snapshot.days.map((day) => ({ ...day, sent: byDate.get(day.date) ?? 0 }));
  return chartCard("Video per day", '<span class="muted">GB sent, from Cloudflare</span>', barChart(days, "sent", PURPLE));
}

/** What Realtime has cost: Cloudflare's own numbers when the analytics token is set, else the page's estimate. */
function costCards(snapshot) {
  const usage = snapshot.usage;
  const card = (value, label) => `<div class="card"><b>${escape(value)}</b><span>${escape(label)}</span></div>`;
  if (!usage) {
    const billable = Math.max(0, snapshot.monthGb - 1000);
    return `<h2>Cost</h2><div class="cards">${card(usd(billable * 0.05), "This month, estimated")}${card(gbText(snapshot.monthGb), "Video this month, at most, of 1,000 free")}</div><p class="muted">Set CF_ANALYTICS_TOKEN to see what Cloudflare measured.</p>`;
  }
  const month = new Date().toISOString().slice(0, 7);
  const current = usage.cost.months.find((row) => row.month === month) ?? { gb: 0, cost: 0, freeLeftGb: 1000 };
  const turn = usage.days.filter((day) => day.date.startsWith(month)).reduce((sum, day) => sum + day.turnBytes, 0) / 1e9;
  const since = usage.cost.months[0]?.month;
  const checked = usage.at ? `Cloudflare, checked ${Math.max(0, Math.round((Date.now() - usage.at) / 60000))} min ago` : "Cloudflare";
  return `<h2>Cost <span class="muted">${escape(checked)}${usage.error ? ` · last check failed: ${escape(usage.error)}` : ""}</span></h2>
<div class="cards">${card(usd(current.cost), "This month")}${card(usd(usage.cost.totalCost), since ? `So far, since ${since}` : "So far")}${card(gbText(current.gb), "Video sent this month")}${card(gbText(current.freeLeftGb), "Free left this month, of 1,000 GB")}${card(usd(forecastOf(usage.days, new Date().toISOString().slice(0, 10)).projectedCost), "Month end, at this pace")}${card(gbText(turn), "Relayed by TURN, free")}</div>`;
}

const shortDate = (date) => `${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;

/** This month's video so far and, dashed, where it ends if the last week's pace holds, against the free 1,000 GB. */
function forecastChart(snapshot, now) {
  const days = snapshot.usage?.days;
  if (!days?.length) return "";
  const forecast = forecastOf(days, new Date(now).toISOString().slice(0, 10));
  const { month, dayOfMonth, daysInMonth, sent, soFarGb, projectedGb } = forecast;
  const showFree = projectedGb >= FREE_GB_PER_MONTH * 0.4;
  const max = niceMax(Math.max(projectedGb, showFree ? FREE_GB_PER_MONTH * 1.05 : 0));
  const x = (day) => ((day - 1) / (daysInMonth - 1)) * 100;
  const y = (gb) => 100 - (gb / max) * 100;
  const line = sent.map((gb, index) => `${index ? "L" : "M"}${x(index + 1).toFixed(2)},${y(gb).toFixed(2)}`).join("");
  const stroke = 'stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"';
  const shapes = `<path d="${line}L${x(dayOfMonth).toFixed(2)},100L0,100Z" fill="${PURPLE}" fill-opacity="0.16"/>
<path d="${line}" fill="none" stroke="${PURPLE}" ${stroke}/>
<path d="M${x(dayOfMonth).toFixed(2)},${y(soFarGb).toFixed(2)}L100,${y(projectedGb).toFixed(2)}" fill="none" stroke="${PURPLE}" stroke-opacity="0.7" stroke-dasharray="5 4" ${stroke}/>
${showFree ? `<line x1="0" x2="100" y1="${y(FREE_GB_PER_MONTH).toFixed(2)}" y2="${y(FREE_GB_PER_MONTH).toFixed(2)}" stroke="var(--red)" stroke-dasharray="2 3" ${stroke}/>` : ""}`;
  const plot = frame(max, shapes).replace("</div>", showFree ? `<span class="free" style="top:${y(FREE_GB_PER_MONTH)}%">Free 1,000 GB</span></div>` : "</div>");
  const pace = forecast.basedOnDays
    ? `${gbText(forecast.perDay)} a day, last ${forecast.basedOnDays} day${forecast.basedOnDays > 1 ? "s" : ""}`
    : `${gbText(forecast.perDay)} today so far`;
  const verdict =
    soFarGb >= FREE_GB_PER_MONTH
      ? `past the free 1,000 GB, month ends near ${usd(forecast.projectedCost)}`
      : forecast.freeRunsOutOn
        ? `free runs out ${shortDate(forecast.freeRunsOutOn)}, month ends near ${usd(forecast.projectedCost)}`
        : `month ends near ${gbText(projectedGb)}, ${Math.round((projectedGb / FREE_GB_PER_MONTH) * 100)}% of the free 1,000 GB, $0`;
  const head = `${legend([
    ["Sent", PURPLE],
    ["At this pace", `${PURPLE}b3`],
  ])}<span class="muted" style="flex-basis:100%">${escape(pace)} · ${escape(verdict)} · a full month at this pace costs ${escape(usd(forecast.monthAtPaceCost))}</span>`;
  const middle = `${month}-${String(Math.ceil(daysInMonth / 2)).padStart(2, "0")}`;
  return `<div class="wide">${chartCard(
    "This month, and where it ends",
    head,
    `${plot}<div class="x"><span>1/${Number(month.slice(5))}</span><span>${shortDate(middle)}</span><span>${daysInMonth}/${Number(month.slice(5))}</span></div>`,
  )}</div>`;
}

function charts(snapshot, now) {
  return `<div class="charts">${forecastChart(snapshot, now)}${chartCard(
    "Last 24 hours",
    legend([
      ["People", BLUE],
      ["Rooms", GREEN],
    ]),
    lineChart(snapshot.day24, [
      { key: "people", color: BLUE },
      { key: "rooms", color: GREEN },
    ]),
  )}
${chartCard("Joins per day", '<span class="muted">last 14 days, UTC</span>', barChart(snapshot.days, "joins", BLUE))}
${videoChart(snapshot)}
${chartCard("Most people at once", '<span class="muted">per day</span>', barChart(snapshot.days, "peak", GREEN))}</div>`;
}

const ago = (ms) => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
};

export function renderDash(snapshot, now) {
  const { totals, today, yesterday, rooms } = snapshot;
  const card = (value, label) => `<div class="card"><b>${escape(value)}</b><span>${escape(label)}</span></div>`;
  const person = (peer) =>
    `${escape(peer.name)}${peer.host ? '<span class="tag">Host</span>' : ""}${peer.camera ? '<span class="tag">Camera</span>' : ""}${peer.screen ? '<span class="tag">Screen</span>' : ""}${peer.mic ? '<span class="tag">Mic</span>' : ""}`;
  const table = rooms.length
    ? `<table><thead><tr><th>Room</th><th>People</th><th class="hide-small">Open for</th></tr></thead><tbody>${rooms
        .map(
          (room) =>
            `<tr><td><a href="/r/${escape(room.id)}" target="_blank" rel="noopener">${escape(room.id)}</a><div class="muted">${room.peers.length} here</div></td><td>${room.peers.map(person).join("<br>")}</td><td class="hide-small">${ago(now - room.since)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : `<div class="empty">No rooms open right now.</div>`;
  return page(
    "Milagre Live stats",
    `<main><header><h1>Milagre Live</h1><span class="muted">Updates every 10 seconds</span><form method="post" action="/dash/logout"><button type="submit">Sign out</button></form></header>
<div class="cards">${card(totals.rooms, "Rooms open")}${card(totals.people, "People live")}${card(totals.cameras, "Cameras on")}${card(totals.screens, "Screens shared")}${card(totals.mics ?? 0, "Mics on")}${card(`${totals.gbPerHour.toFixed(1)} GB/h`, "Video right now, at most")}</div>
<h2>Today (UTC)</h2><div class="cards">${card(today.joins, "Joins")}${card(today.rooms, "Rooms started")}${card(today.peak, "Most people at once")}${card(yesterday.joins, "Joins yesterday")}</div>
${costCards(snapshot)}
${charts(snapshot, now)}
<h2>Open rooms</h2>${table}</main>`,
    true,
  );
}
