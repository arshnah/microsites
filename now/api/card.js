const API = process.env.API_BASE || "https://api.arshnah.in";
const STATUS_TXT = { online: "online", idle: "idle", dnd: "do not disturb", offline: "offline" };
const STATUS_COLOR = { online: "#3ba55d", idle: "#e0a838", dnd: "#e0483d", offline: "#5a626e" };

// palettes — ?theme=light serves the light card (via <picture> in the readme)
const THEMES = {
  dark:  { bg: "#14171c", stroke: "#232830", line: "#232830", accent: "#8fb6ff", ink: "#e8ebf0", mv: "#c9cfda", faint: "#5a626e" },
  light: { bg: "#ffffff", stroke: "#d0d7de", line: "#d8dee4", accent: "#4f7fd1", ink: "#1f2328", mv: "#57606a", faint: "#8c959f" },
};

const xml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

async function getData() {
  const out = { status: "offline", listening: null, commit: null, coding: null };
  const get = (p) => fetch(API + p).then((r) => r.json()).catch(() => null);
  const [dc, np, cm, wk] = await Promise.all([
    get("/api/discord-status"),
    get("/api/now-playing"),
    get("/api/last-commit"),
    get("/api/coding")
  ]);

  if (dc && dc.status) out.status = dc.status;
  if (np && np.isPlaying && np.title) out.listening = np.title + " · " + (np.artist || "");
  if (cm && cm.ok) out.commit = cm.message + "  ·  " + (cm.repo ? cm.repo.split("/")[1] : "") + "  ·  " + cm.ago;
  if (wk && wk.ok && wk.text) {
    out.coding = wk.text + " today" + (wk.language ? "  ·  mostly " + wk.language : "");
  }
  return out;
}

function svg(d, t) {
  const W = 480, P = 22;
  const time = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toLowerCase();
  const statusLine = (STATUS_TXT[d.status] || d.status) + "  ·  " + time + " ist";
  const listen = d.listening ? "♪  " + clip(d.listening, 44) : "not playing anything";
  const shipped = d.commit ? clip(d.commit, 46) : "nothing public lately";

  const rows = [];
  rows.push({ label: "STATUS", value: statusLine, mono: true });
  rows.push({ label: "LISTENING", value: listen, mono: false });
  if (d.coding) {
    rows.push({ label: "CODING", value: d.coding, mono: true });
  }
  rows.push({ label: "SHIPPED", value: shipped, mono: true });

  const rowHtml = rows.map((r, i) => {
    const y = 82 + i * 34;
    return `<text x="${P}" y="${y}" class="lbl">${r.label}</text>` +
           `<text x="${P + 96}" y="${y}" class="${r.mono ? "mv" : "v"}">${xml(r.value)}</text>`;
  }).join("");

  const H = 82 + rows.length * 34 + 10;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">
<style>
  .t{font:700 19px -apple-system,Segoe UI,Helvetica,sans-serif;fill:${t.ink}}
  .u{font:400 10.5px ui-monospace,SFMono-Regular,Menlo,monospace;fill:${t.faint}}
  .lbl{font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace;fill:${t.faint};letter-spacing:.08em}
  .v{font:400 13.5px -apple-system,Segoe UI,Helvetica,sans-serif;fill:${t.ink}}
  .mv{font:400 13px ui-monospace,SFMono-Regular,Menlo,monospace;fill:${t.mv}}
</style>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="${t.bg}" stroke="${t.stroke}"/>
<rect x="1" y="1" width="${W - 2}" height="5" rx="2.5" fill="${t.accent}" opacity="0.9"/>
<text x="${P}" y="40" class="t">arsh / now</text>
<text x="${W - P}" y="34" text-anchor="end" class="u">now.arshnah.in</text>
<line x1="${P}" y1="56" x2="${W - P}" y2="56" stroke="${t.line}"/>
<circle cx="${P + 82}" cy="82" r="5" fill="${STATUS_COLOR[d.status] || "#5a626e"}"/>
${rowHtml}
</svg>`;
}

module.exports = async (req, res) => {
  const theme = new URL(req.url, "http://x").searchParams.get("theme") === "light" ? "light" : "dark";
  const d = await getData();
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=10");
  res.end(svg(d, THEMES[theme]));
};
