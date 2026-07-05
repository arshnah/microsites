const fs = require("fs");
const path = require("path");

const API = process.env.API_BASE || "https://api.arshnah.in";
const STATUS_TXT = { online: "online", idle: "idle", dnd: "do not disturb", offline: "offline" };
const STATUS_COLOR = { online: "#3ba55d", idle: "#e0a838", dnd: "#e0483d", offline: "#5a626e" };

const xml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

const cleanXml = (s) => s
  .replace(/&rsquo;/g, "’")
  .replace(/&ldquo;/g, "“")
  .replace(/&rdquo;/g, "”")
  .replace(/&middot;/g, "·")
  .replace(/&nbsp;/g, " ");

function getFocusText() {
  try {
    const htmlPath = path.join(__dirname, "../index.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    const focusMatch = html.match(/<div class="focus">([\s\S]*?)<\/div>/);
    if (!focusMatch) return null;
    const pMatches = [...focusMatch[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
    return pMatches.map(m => cleanXml(m[1]).trim());
  } catch (e) {
    return null;
  }
}

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

function svg(d) {
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

  const yFocus = 82 + rows.length * 34 + 6;
  const paragraphs = getFocusText() || [];
  
  let focusHtml = "";
  let H = yFocus - 18;
  
  if (paragraphs.length) {
    const focusHeight = paragraphs.length > 1 ? 84 : 50;
    H = yFocus + focusHeight + 10;
    
    const p1 = paragraphs[0] || "";
    const p2 = paragraphs[1] ? `<p style="margin:0;color:#8b93a1;font-size:11.5px;">${paragraphs[1]}</p>` : "";
    
    focusHtml = `
      <foreignObject x="${P}" y="${yFocus}" width="${W - 2 * P}" height="${focusHeight}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#8b93a1;font-size:12.5px;line-height:1.5;">
          <div style="color:#5a626e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px;">WHAT I'M FOCUSED ON</div>
          <p style="margin:0 0 5px;color:#e8ebf0;">${p1}</p>
          ${p2}
        </div>
      </foreignObject>
    `;
  }

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
<circle cx="${P + 82}" cy="82" r="5" fill="${STATUS_COLOR[d.status] || "#5a626e"}"/>
${rowHtml}
${focusHtml}
</svg>`;
}

module.exports = async (req, res) => {
  const d = await getData();
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=120, s-maxage=120, stale-while-revalidate=600");
  res.end(svg(d));
};
