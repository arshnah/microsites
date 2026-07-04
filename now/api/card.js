// Server-rendered SVG of "what arsh is doing right now", for embedding in a
// GitHub README (which runs no JS). All data comes from the shared status api
// (api.arshnah.in) so the fetch logic lives in one place; this file only draws.

const API = process.env.API_BASE || "https://api.arshnah.in";
const STATUS_TXT = { online: "online", idle: "idle", dnd: "do not disturb", offline: "offline" };
const STATUS_COLOR = { online: "#3ba55d", idle: "#e0a838", dnd: "#e0483d", offline: "#5a626e" };

const xml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

async function getData() {
  const out = { status: "offline", listening: null, commit: null };
  const get = (p) => fetch(API + p).then((r) => r.json()).catch(() => null);
  const [dc, np, cm] = await Promise.all([get("/api/discord-status"), get("/api/now-playing"), get("/api/last-commit")]);
  if (dc && dc.status) out.status = dc.status;
  if (np && np.isPlaying && np.title) out.listening = np.title + " · " + (np.artist || "");
  if (cm && cm.ok) out.commit = cm.message + "  ·  " + (cm.repo ? cm.repo.split("/")[1] : "") + "  ·  " + cm.ago;
  return out;
}

function svg(d) {
  const W = 480, H = 180, P = 22;
  const time = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toLowerCase();
  const statusLine = (STATUS_TXT[d.status] || d.status) + "  ·  " + time + " ist";
  const listen = d.listening ? "♪  " + clip(d.listening, 44) : "not playing anything";
  const shipped = d.commit ? clip(d.commit, 46) : "nothing public lately";

  const row = (y, label, value, mono) =>
    `<text x="${P}" y="${y}" class="lbl">${label}</text>` +
    `<text x="${P + 96}" y="${y}" class="${mono ? "mv" : "v"}">${xml(value)}</text>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">
<style>
  .t{font:700 19px -apple-system,Segoe UI,Helvetica,sans-serif;fill:#e8ebf0}
  .u{font:400 10.5px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#5a626e}
  .lbl{font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#5a626e;letter-spacing:.08em}
  .v{font:400 13.5px -apple-system,Segoe UI,Helvetica,sans-serif;fill:#e8ebf0}
  .mv{font:400 13px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#c9cfda}
</style>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="#14171c" stroke="#232830"/>
<rect x="1" y="1" width="${W - 2}" height="5" rx="2.5" fill="#8fb6ff" opacity="0.9"/>
<text x="${P}" y="40" class="t">arsh / now</text>
<text x="${W - P}" y="34" text-anchor="end" class="u">now.arshnah.in</text>
<line x1="${P}" y1="56" x2="${W - P}" y2="56" stroke="#232830"/>
<circle cx="${P + 82}" cy="82.5" r="5" fill="${STATUS_COLOR[d.status] || "#5a626e"}"/>
${row(86, "STATUS", statusLine, true)}
${row(120, "LISTENING", listen, false)}
${row(154, "SHIPPED", shipped, true)}
</svg>`;
}

module.exports = async (req, res) => {
  const d = await getData();
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=120, s-maxage=120, stale-while-revalidate=600");
  res.end(svg(d));
};
