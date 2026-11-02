// Self-check: stub the host, load the plugin, exercise the math and every style.
// Run: node test.js
const src = require("fs").readFileSync(__dirname + "/claude-usage.js", "utf8");

const calls = { status: [], checks: [] };
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => (store[k] = v), removeItem: (k) => delete store[k] };
globalThis.macotron = {
  plugin: (m) => ({ sessionKey: "sk-ant-test", show: "both", style: "battery", color: "multi", labels: true, pace: true, refreshMs: 30000 }),
  system: { darkMode: () => true },
  menubar: { status: (id, o) => calls.status.push(o), isDark: () => false },
  on: () => {},
  checks: (c) => calls.checks.push(c),
  every: () => {},
  url: { open() {} },
  settings: { open() {} },
  http: {
    get: async (url) => {
      // A Team member's login: a quota-less personal org, an API-console org
      // that rejects the cookie, then the Team org that has the numbers.
      if (url.endsWith("/organizations")) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify([
            { uuid: "personal", name: "Personal", capabilities: ["chat"] },
            { uuid: "console", name: "Console", capabilities: ["api"] },
            { uuid: "team", name: "Team", capabilities: ["chat"] },
          ]),
        };
      }
      if (url.includes("/personal/")) return { status: 200, headers: {}, body: JSON.stringify({ five_hour: null, seven_day: null, limits: [] }) };
      if (url.includes("/console/")) return { status: 403, headers: {}, body: "" };
      const in2h = new Date(Date.now() + 2 * 3600e3).toISOString();
      const in3d = new Date(Date.now() + 3 * 86400e3).toISOString();
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          five_hour: { utilization: 42, resets_at: in2h },
          seven_day: { utilization: "61%", resets_at: in3d },
          seven_day_opus: { utilization: 12 },
          limits: [{ kind: "weekly_scoped", percent: 80, resets_at: in3d, scope: { model: { id: "opus-4", display_name: "Claude Opus" } } }],
        }),
      };
    },
  },
};
function assert(ok, msg) { if (!ok) throw new Error("FAIL: " + msg); }

(0, eval)(src + "\n;globalThis.__t = { elapsed, statusColor, paceTier, resetsIn, render, parse, view, dashboard, STYLES, opts, setData: (d) => { data = d; } };");
const t = globalThis.__t;
const now = Date.now();

// Window math.
assert(t.elapsed(now - 1, 5 * 3600e3, now) === 1, "past reset is fully elapsed");
assert(Math.abs(t.elapsed(now + 2.5 * 3600e3, 5 * 3600e3, now) - 0.5) < 1e-9, "halfway through session");
assert(t.statusColor(60, 0.5) === "red", "60% at half time projects to 1.2 → red");
assert(t.statusColor(30, 0.5) === "green", "30% at half time → green");
assert(t.statusColor(75, 0.05) === "orange", "before 15% elapsed falls back to used thresholds");
assert(t.paceTier(0, 0.5) === 0 && t.paceTier(10, 0.5) === 0 && t.paceTier(30, 0.5) === 1, "pace tiers");
assert(t.paceTier(70, 0.5) === 5 && t.paceTier(50, 0.01) === null, "runaway and too-early");
assert(t.resetsIn(now + 3.75 * 3600e3 + 1, now) === "3h 45m", "3h 45m: " + t.resetsIn(now + 3.75 * 3600e3 + 1, now));
assert(t.resetsIn(now + 2 * 86400e3 + 1, now) === "2 days", "2 days");
assert(t.resetsIn(now - 5, now) === "Reset now", "reset now");

// Parsing merges limits over legacy fields and reads string percentages.
const in2h = new Date(now + 2 * 3600e3).toISOString();
const d = t.parse(JSON.parse(`{"five_hour":{"utilization":"42%","resets_at":"${in2h}"},"seven_day":{"utilization":61,"resets_at":"${in2h}"},
  "seven_day_opus":{"utilization":12},"limits":[{"kind":"weekly_scoped","percent":80,"scope":{"model":{"display_name":"Claude Opus"}}}]}`));
assert(d.session.pct === 42 && d.week.pct === 61, "utilization parsed");
assert(d.models.length === 1 && d.models[0].pct === 80 && d.models[0].name === "Opus", "limits override legacy opus");
assert(t.view({ pct: 50, resets: now - 1 }, 5 * 3600e3, now).pct === 0, "expired session reads 0");
assert(t.view({ pct: 50, resets: now - 1 }, 7 * 86400e3, now).pct === 50, "expired week keeps its number");
assert(t.view({ pct: 50, resets: now + 1e6 }, 0, now).mark === null, "model rows have no marker");
assert(t.view({ pct: -3, resets: now + 1e6 }, 5 * 3600e3, now).shown === 0, "shown never goes negative");

// Every style renders both quotas into well-formed SVG with a pace tick.
t.setData(d);
for (const style of Object.keys(t.STYLES)) {
  for (const labels of [true, false]) {
    t.opts.style = style; t.opts.labels = labels;
    const out = t.render(true);
    assert(/^<svg [^>]*width="\d+(\.\d+)?" height="\d+"/.test(out.svg), style + " has a size");
    assert(out.svg.endsWith("</svg>") && (out.svg.match(/<g /g) || []).length === 2, style + " has two quotas");
    assert(out.template === false, style + " is not a template in multi color");
    assert(out.svg.includes(style === "percent" || style === "compact" ? 'r="2"' : "<line"), style + " shows the pace marker");
  }
}
t.opts.style = "battery"; t.opts.labels = true;
t.opts.color = "mono"; t.opts.pace = false;
assert(t.render(false).template === true, "mono without pace is a template");
assert(!t.render(false).svg.includes("<line"), "no tick without pace");
t.opts.pace = true;
assert(t.render(false).template === true, "mono with pace is still a template");
assert(!/stroke="#(?!000000)/.test(t.render(false).svg), "mono pace tick takes the text color");

// Ultra: no five_hour block → week only, and the dropdown says so.
const ultra = t.parse({ five_hour: null, seven_day: { utilization: 30 } });
assert(ultra.session === null, "no session on Ultra");
t.setData(ultra);
assert((t.render(true).svg.match(/<g /g) || []).length === 1, "Ultra draws the week only");
t.opts.show = "session";
assert((t.render(true).svg.match(/<g /g) || []).length === 1, "session-only falls back to week on Ultra");
t.opts.show = "both";
assert(t.dashboard(true).html.includes("No session limit"), "dropdown notes no session limit");
t.setData(d);

// End to end through the stubbed host.
t.opts.color = "multi"; t.opts.pace = true;
setTimeout(() => {
  const last = calls.status[calls.status.length - 1];
  assert(last.svg.includes("<line") && last.menu[0].html.includes("Resets in"), "fetch → paint with tick and dashboard");
  assert(calls.checks[calls.checks.length - 1][0].ok === true, "check is green");
  assert(store["claude-usage.org"] === "team", "picked the org with a quota, not the first: " + store["claude-usage.org"]);
  assert(last.menu[0].html.includes("42%"), "dashboard shows the team org's numbers");
  console.log("ok: " + calls.status.length + " paints, styles " + Object.keys(t.STYLES).join(", "));
}, 50);
