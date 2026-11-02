// Claude Usage — claude.ai session and weekly quota in the menu bar.
//
// A port of Claude-Usage-Tracker (hamed-elfayome) to a Macotron plugin: same
// icon styles, same thresholds, same colors, same pace marker. Data comes from
// claude.ai's own usage endpoint, authenticated with the sessionKey cookie.
//
// Works for personal (Pro/Max) and Team/Enterprise logins. A Team member's
// login lists several orgs: a personal org with no quota, an API-console org
// that 403s on /usage, and the Team org that holds the numbers. The plugin
// probes each chat-capable org and remembers the one that reports a quota.

const opts = macotron.plugin({
  title: "Claude Usage",
  description: "Session and weekly claude.ai quota graphs in the menu bar, with pace markers.",
  help:
    "The session key is claude.ai's sessionKey cookie. Sign in to claude.ai in Safari, then Develop → " +
    "Show Web Inspector → Storage → Cookies → claude.ai (Chrome: Application → Cookies). Copy the " +
    "sessionKey value, which starts with sk-ant-sid, into the field below. It expires when you sign out. " +
    "Click the item for the dashboard.",
  options: {
    sessionKey: {
      type: "password",
      label: "Session key",
      required: true,
      placeholder: "sk-ant-sid02-…",
      help: "The sessionKey cookie from claude.ai. Stored in the Keychain.",
    },
    show: {
      type: "dropdown",
      label: "Show",
      default: "both",
      choices: [
        { value: "both", label: "Session and week" },
        { value: "session", label: "Session only" },
        { value: "week", label: "Week only" },
      ],
    },
    style: {
      type: "dropdown",
      label: "Style",
      default: "battery",
      choices: [
        { value: "battery", label: "Battery" },
        { value: "bar", label: "Progress bar" },
        { value: "ring", label: "Ring" },
        { value: "percent", label: "Percentage" },
        { value: "compact", label: "Compact dot" },
      ],
    },
    color: {
      type: "dropdown",
      label: "Color",
      default: "multi",
      choices: [
        { value: "multi", label: "Green, orange, red" },
        { value: "mono", label: "Monochrome" },
      ],
    },
    labels: { type: "boolean", label: "Show names", default: true, help: "Session and Week labels on the icons." },
    pace: {
      type: "boolean",
      label: "Pace marker",
      default: true,
      help: "A tick at the elapsed fraction of the window, colored by whether usage is ahead of it (plain in monochrome).",
    },
    refreshMs: { type: "number", label: "Refresh interval", default: 30000, help: "Milliseconds. The default is 30 seconds." },
  },
});

const API = "https://claude.ai/api";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const HOUR = 3600e3;
const SESSION_MS = 5 * HOUR;
const WEEK_MS = 7 * 24 * HOUR;
// CoreSVG ignores text-anchor and PostScript face names, but honors a numeric
// font-weight. Centered text is placed by hand from Helvetica Bold advances.
const FONT = "Helvetica";
const ADVANCE = { S: 0.667, W: 0.944, e: 0.556, s: 0.556, i: 0.278, o: 0.611, n: 0.611, k: 0.556, "%": 0.889, " ": 0.278 };
function textWidth(s, size) {
  let w = 0;
  for (const c of s) w += ADVANCE[c] || 0.556;
  return w * size;
}

// macOS system colors, light and dark.
const SYS = {
  green: ["#28CD41", "#32D74B"],
  orange: ["#FF9500", "#FF9F0A"],
  red: ["#FF3B30", "#FF453A"],
  teal: ["#59ADC4", "#6AC4DC"],
  yellow: ["#FFCC00", "#FFD60A"],
  purple: ["#AF52DE", "#BF5AF2"],
};
const PACE_COLOR = ["green", "teal", "yellow", "orange", "red", "purple"];

let data = null; // { session, week, models: [{ name, pct, resets }] }
let error = null;

// ---------------------------------------------------------------- math

// How far through the window we are, 0..1. A reset in the past is 1.
function elapsed(resets, duration, now) {
  if (!resets || !duration) return null;
  if (resets <= now) return 1;
  return Math.min(Math.max((duration - (resets - now)) / duration, 0), 1);
}

// Tracker's UsageStatusCalculator: pace-aware once 15% of the window has gone.
function statusColor(pct, frac) {
  if (frac !== null && frac >= 0.15 && frac < 1 && pct > 0) {
    const projected = pct / 100 / frac;
    return projected < 0.7 ? "green" : projected < 0.9 ? "orange" : "red";
  }
  return pct < 70 ? "green" : pct < 90 ? "orange" : "red";
}

// Tracker's PaceStatus: 0 comfortable … 5 runaway, or null when too early.
function paceTier(pct, frac) {
  if (frac === null || frac < 0.03 || frac >= 1) return null;
  if (pct <= 0) return 0;
  const p = pct / 100 / frac;
  return p < 0.5 ? 0 : p < 0.75 ? 1 : p < 0.9 ? 2 : p < 1 ? 3 : p < 1.2 ? 4 : 5;
}

function resetsIn(resets, now) {
  const ms = resets - now;
  if (ms <= 0) return "Reset now";
  const m = Math.floor(ms / 60e3);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return h % 24 ? d + "d " + (h % 24) + "h" : d + (d === 1 ? " day" : " days");
  if (h > 0) return m % 60 ? h + "h " + (m % 60) + "m" : h + "h";
  return m > 0 ? m + "m" : "< 1m";
}

// One quota as the renderer wants it.
function view(q, duration, now) {
  // Only the session reads zero once its window has passed.
  const pct = !q ? 0 : duration === SESSION_MS && q.resets && q.resets <= now ? 0 : q.pct;
  const frac = q ? elapsed(q.resets, duration, now) : null;
  const tier = opts.pace ? paceTier(pct, frac) : null;
  return {
    pct,
    shown: Math.max(0, pct),
    mark: opts.pace ? frac : null,
    color: statusColor(pct, frac),
    tier,
    resets: q && q.resets ? q.resets : null,
  };
}

// ---------------------------------------------------------------- svg

function color(name, dark) {
  return SYS[name][dark ? 1 : 0];
}

function text(x, y, size, weight, fill, opacity, s, anchor) {
  if (anchor === "middle") x -= textWidth(s, size) / 2;
  return (
    `<text x="${x}" y="${y}" font-family="${FONT}" font-weight="${weight >= 600 ? 700 : 400}" font-size="${size}"` +
    ` fill="${fill}" fill-opacity="${opacity}">${s}</text>`
  );
}

function tick(x1, y1, x2, y2, stroke) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>`;
}

// Each style returns { w, h, body } for one quota. `v` is a view(), `label`
// is "Session"/"Week", `fg` the bar's text color, `fill` the status color,
// `pace` the pace tick color (fg when pace tiers are off or unavailable).
const STYLES = {
  // The status bar resamples anything taller than 18pt, so the tracker's
  // 42x28 layout is squeezed vertically: an 8pt bar over a 7.5pt label.
  battery(v, label, fg, fill, pace) {
    let out =
      `<rect x="1.6" y="1" width="39.4" height="7" rx="2" fill="none" stroke="${fg}" stroke-opacity="0.5" stroke-width="1.2"/>`;
    const fw = 36 * Math.min(v.shown / 100, 1);
    if (fw > 1) out += `<rect x="3" y="2.5" width="${fw}" height="4" rx="1.2" fill="${fill}"/>`;
    if (v.mark !== null) {
      const x = Math.round(3 + 36 * v.mark);
      out += tick(x, 1, x, 8, pace);
    }
    out += text(21, 17, 7.5, 500, fg, 0.85, opts.labels ? label : Math.floor(v.shown) + "%", "middle");
    return { w: 42, h: 18, body: out };
  },

  bar(v, label, fg, fill, pace) {
    const x0 = opts.labels ? 13 : 1;
    let out = "";
    if (opts.labels) out += text(1, 13, 10, 600, fg, 0.9, label[0]);
    out += `<rect x="${x0}" y="4.5" width="40" height="9" rx="4" fill="${fg}" fill-opacity="0.2"/>`;
    const fw = 40 * Math.min(v.shown / 100, 1);
    if (fw > 1) {
      out += `<rect x="${x0}" y="4.5" width="${fw}" height="9" rx="4" fill="${fill}"/>`;
      if (v.mark !== null) {
        const x = Math.round(x0 + 40 * v.mark);
        out += tick(x, 4.5, x, 13.5, pace);
      }
    }
    return { w: x0 + 42, h: 18, body: out };
  },

  // The tracker's labeled ring is 22pt; 18pt is all the status bar gives,
  // so the stroke runs right to the edge of the slot.
  ring(v, label, fg, fill, pace) {
    const size = 18;
    const r = (size - 3) / 2;
    const cx = 1 + size / 2;
    const cy = size / 2;
    const c = 2 * Math.PI * r;
    let out = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${fg}" stroke-opacity="0.15" stroke-width="3"/>`;
    const len = c * Math.min(v.shown / 100, 1);
    if (len > 0) {
      out +=
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${fill}" stroke-width="3" stroke-linecap="round"` +
        ` stroke-dasharray="${len} ${c}" transform="rotate(-90 ${cx} ${cy})"/>`;
    }
    if (v.mark !== null) {
      const a = (-90 + 360 * v.mark) * (Math.PI / 180);
      out += tick(cx + (r - 2) * Math.cos(a), cy + (r - 2) * Math.sin(a), cx + (r + 2) * Math.cos(a), cy + (r + 2) * Math.sin(a), pace);
    }
    if (opts.labels) out += text(cx, cy + 3.3, 9, 700, fg, 1, label[0], "middle");
    return { w: size + 1, h: size, body: out };
  },

  percent(v, label, fg, fill, pace) {
    const s = (opts.labels ? label[0] + ": " : "") + Math.floor(v.shown) + "%";
    const tw = Math.ceil(s.length * 7.2) + 4;
    let out = text(2, 13, 12, 600, fill, 1, s);
    let w = tw + 2;
    if (v.tier !== null) {
      out += `<circle cx="${w + 4}" cy="9" r="2" fill="${pace}"/>`;
      w += 8;
    }
    return { w, h: 18, body: out };
  },

  compact(v, label, fg, fill, pace) {
    let x = 1;
    let out = "";
    if (opts.labels) {
      out += text(1, 12.5, 9, 500, fg, 0.85, label[0] + ":");
      x = 18;
    }
    out += `<circle cx="${x + 4}" cy="9" r="4" fill="${fill}"/>`;
    x += 8;
    if (v.tier !== null) {
      out += `<circle cx="${x + 4}" cy="9" r="2" fill="${pace}"/>`;
      x += 6;
    }
    return { w: x, h: 18, body: out };
  },
};

function render(dark) {
  const fg = dark ? "#FFFFFF" : "#000000";
  const mono = opts.color === "mono";
  const now = Date.now();
  const parts = [];
  let want = (opts.show || "both").toLowerCase();
  if (data && !data.session) want = "week";
  if (want !== "week") parts.push(["Session", view(data && data.session, SESSION_MS, now)]);
  if (want !== "session") parts.push(["Week", view(data && data.week, WEEK_MS, now)]);
  const draw = STYLES[opts.style] || STYLES.battery;
  const pieces = parts.map(([label, v]) => {
    const fill = mono ? fg : color(v.color, dark);
    const pace = v.tier !== null && !mono ? color(PACE_COLOR[v.tier], dark) : fg;
    return draw(v, label, fg, fill, pace);
  });
  const gap = 6;
  const h = Math.max(...pieces.map((p) => p.h));
  const w = pieces.reduce((n, p) => n + p.w, 0) + gap * (pieces.length - 1);
  let x = 0;
  let body = "";
  for (const p of pieces) {
    body += `<g transform="translate(${x} ${(h - p.h) / 2})">${p.body}</g>`;
    x += p.w + gap;
  }
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
    // A monochrome icon is a plain mask the bar tints for its own background.
    template: mono,
  };
}

// ---------------------------------------------------------------- menu

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

const DASH_GREEN = ["#1B6B34", "#3CC75F"];

function card(title, tag, subtitle, v, dark, now) {
  const fill = v.color === "green" ? DASH_GREEN[dark ? 1 : 0] : color(v.color, dark);
  const pace = v.tier !== null ? color(PACE_COLOR[v.tier], dark) : "canvastext";
  const width = Math.min(v.shown / 100, 1) * 100;
  return (
    `<div class="row"><div class="head"><div class="t">${esc(title)}` +
    (tag ? `<span class="tag">${tag}</span>` : "") +
    (subtitle ? `<div class="sub">${esc(subtitle)}</div>` : "") +
    `</div><div class="pct" style="color:${fill}">${Math.floor(v.shown)}%</div></div>` +
    `<div class="bar"><div class="fill" style="width:${width}%;background:${fill}"></div>` +
    (v.mark !== null ? `<div class="mark" style="left:calc(${v.mark * 100}% - 0.75px);background:${pace}"></div>` : "") +
    `</div>` +
    (v.resets ? `<div class="reset">Resets in ${resetsIn(v.resets, now)}</div>` : "") +
    `</div>`
  );
}

// Card height in points: frame and head, then a line each for subtitle and
// reset. The web row clips, so this has to be right.
function cardHeight(subtitle, v) {
  return 48 + (subtitle ? 13 : 0) + (v.resets ? 15 : 0);
}

const CSS =
  "<style>" +
  "body{margin:0;padding:8px 14px;font:13px -apple-system,sans-serif;color:canvastext}" +
  ".row{border:0.5px solid color-mix(in srgb,canvastext 10%,transparent);border-radius:8px;padding:8px 10px;margin-bottom:6px}" +
  ".head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:5px}" +
  ".t{font-weight:500}.tag{font-size:9px;font-weight:500;color:graytext;" +
  "background:color-mix(in srgb,canvastext 8%,transparent);border-radius:99px;padding:1px 5px;margin-left:6px;vertical-align:1px}" +
  ".sub{font-size:10px;color:graytext;margin-top:1px}" +
  ".pct{font-weight:600;font-variant-numeric:tabular-nums}" +
  ".bar{position:relative;height:4px;border-radius:2.5px;background:color-mix(in srgb,canvastext 8%,transparent)}" +
  ".fill{height:4px;border-radius:2.5px;transition:width .6s ease-in-out}" +
  ".mark{position:absolute;top:-2px;width:2.5px;height:8px;border-radius:1px}" +
  ".reset{font-size:9px;color:graytext;margin-top:4px}" +
  ".note{color:graytext;font-size:12px}" +
  "</style>";

// The popover's own inset: 14pt sides, 8pt top and bottom.
function dashboard(dark) {
  const now = Date.now();
  let html = CSS;
  let height = 16;
  const add = (title, tag, subtitle, v) => {
    html += card(title, tag, subtitle, v, dark, now);
    height += cardHeight(subtitle, v);
  };
  if (data.session) add("Session Usage", "", "5-hour rolling window", view(data.session, SESSION_MS, now));
  else {
    html += `<div class="row note">No session limit on this plan</div>`;
    height += 38;
  }
  add("All models", "Weekly", "", view(data.week, WEEK_MS, now));
  // Per-model rows carry no marker in the original, hence no duration.
  for (const m of data.models) if (m.pct > 0) add(m.name, "Weekly", "", view(m, 0, now));
  return { html, height };
}

// The bar follows the wallpaper, not only the system theme, so the icon asks
// the bar (Macotron 0.5.6+) and the dropdown asks the system.
function barIsDark() {
  return macotron.menubar.isDark ? macotron.menubar.isDark() : macotron.system.darkMode();
}

function paint() {
  const dark = macotron.system.darkMode();
  const icon = render(barIsDark());
  macotron.menubar.status("claude-usage", {
    title: "",
    svg: icon.svg,
    template: icon.template,
    menu: [
      // A plain row until there is something to draw; stale data stays up
      // with the error under it.
      ...(data ? [Object.assign({ title: "", width: 280 }, dashboard(dark))] : [{ title: error || "Loading…" }]),
      ...(data && error ? [{ title: error }] : []),
      "-",
      { title: "Refresh", onClick: refresh },
      { title: "Open claude.ai", onClick: () => macotron.url.open("https://claude.ai") },
      { title: "Settings…", onClick: () => macotron.settings.open() },
    ],
  });
  macotron.checks([
    {
      title: "claude.ai",
      ok: !error,
      message:
        error ||
        (data
          ? (data.session ? "Session " + Math.floor(view(data.session, SESSION_MS, Date.now()).pct) + "% · " : "") +
            "Week " + Math.floor(data.week.pct) + "%"
          : "Waiting"),
    },
  ]);
}

// ---------------------------------------------------------------- fetch

async function api(path) {
  const r = await macotron.http.get(API + path, {
    headers: { Cookie: "sessionKey=" + String(opts.sessionKey).trim(), Accept: "application/json", "User-Agent": UA },
    timeout: 15000,
  });
  if (r.status === 0) throw new Error("Offline: " + r.body);
  if (r.status === 401 || r.status === 403) {
    const cf = /just a moment|cf-mitigated/i.test(r.body) || (r.headers && r.headers["cf-mitigated"]);
    throw new Error(cf ? "Blocked by Cloudflare, try again later" : "Session key rejected");
  }
  if (r.status !== 200) throw new Error("HTTP " + r.status + " from " + path);
  return JSON.parse(r.body);
}

function num(v) {
  const n = parseFloat(String(v === undefined || v === null ? "" : v).replace("%", ""));
  return isFinite(n) ? n : 0;
}

function quota(o) {
  if (!o) return { pct: 0, resets: null };
  const t = o.resets_at ? Date.parse(o.resets_at) : NaN;
  return { pct: num(o.utilization), resets: isNaN(t) ? null : t };
}

function parse(u) {
  const models = [];
  const legacy = { seven_day_opus: "Opus", seven_day_sonnet: "Sonnet", seven_day_fable: "Fable", seven_day_omelette: "Design" };
  for (const k in legacy) if (u[k]) models.push(Object.assign({ name: legacy[k] }, quota(u[k])));
  // Newer responses carry a `limits` list, which wins over the legacy fields.
  for (const l of Array.isArray(u.limits) ? u.limits : []) {
    if (l.kind !== "weekly_scoped") continue;
    const scope = (l.scope && l.scope.model) || {};
    const name = scope.display_name || scope.id || "Model";
    const q = { name, pct: num(l.percent), resets: l.resets_at ? Date.parse(l.resets_at) || null : null };
    const i = models.findIndex((m) => name.toLowerCase().includes(m.name.toLowerCase()));
    if (i >= 0) models[i] = Object.assign(models[i], q, { name: models[i].name });
    else models.push(q);
  }
  // Ultra (verified) has no 5-hour window; the reply carries no five_hour block.
  return { session: u.five_hour ? quota(u.five_hour) : null, week: quota(u.seven_day), models };
}

const ORG_KEY = "claude-usage.org";

function usage(org) {
  return api("/organizations/" + org + "/usage");
}

// A quota-less usage reply is what a personal org returns when the seat that
// actually consumes quota lives in a Team/Enterprise org on the same login.
function hasQuota(u) {
  return !!(u && (u.five_hour || u.seven_day || (Array.isArray(u.limits) && u.limits.length)));
}

// Find the org whose usage endpoint reports a quota. One login can carry a
// personal org, an API-console org (403 on usage) and a Team/Enterprise org;
// only one of them has the numbers, and it is not necessarily the first.
async function fetchUsage() {
  const cached = localStorage.getItem(ORG_KEY);
  if (cached) {
    const u = await usage(cached);
    if (hasQuota(u)) return u;
    localStorage.removeItem(ORG_KEY);
  }
  const orgs = await api("/organizations");
  if (!Array.isArray(orgs) || !orgs.length) throw new Error("No organization on this account");
  let fallback = null;
  for (const o of orgs) {
    if (!o.uuid || !(o.capabilities || []).includes("chat")) continue;
    let u;
    try {
      u = await usage(o.uuid);
    } catch (e) {
      console.log("claude: usage for " + o.name + " failed: " + e.message);
      continue;
    }
    if (hasQuota(u)) {
      console.log("claude: using org " + o.name);
      localStorage.setItem(ORG_KEY, o.uuid);
      return u;
    }
    fallback = fallback || u;
  }
  if (!fallback) throw new Error("No claude.ai organization on this account");
  return fallback;
}

let busy = false;

async function refresh() {
  if (!String(opts.sessionKey || "").trim()) {
    error = "Set the session key in Settings";
    return paint();
  }
  if (busy) return;
  busy = true;
  try {
    data = parse(await fetchUsage());
    error = null;
  } catch (e) {
    error = String(e.message || e);
    if (/rejected|HTTP 404/.test(error)) localStorage.removeItem(ORG_KEY);
    console.warn("claude: " + error);
  }
  busy = false;
  paint();
}

paint();
refresh();
macotron.every(Math.max(10000, Number(opts.refreshMs) || 30000), refresh);
// The window keeps moving while the data stands still, so the tick and the
// countdown redraw each minute between fetches.
macotron.every(60000, paint);
macotron.on("menubar:appearance", paint);
