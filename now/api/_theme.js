// Shared card chrome for the profile widgets (leading _ so Vercel ignores it as
// a route). Same palette, type scale and width as arshnah.in/api/neofetch, so
// the cards read as one stack rather than three unrelated boxes.

const THEMES = {
  dark: { bg: "#0d1117", stroke: "#21262d", rule: "#30363d", head: "#58a6ff", key: "#d29922", ink: "#c9d1d9", mut: "#8b949e", faint: "#6e7681", dot: "#30363d" },
  light: { bg: "#ffffff", stroke: "#d0d7de", rule: "#d8dee4", head: "#0969da", key: "#9a6700", ink: "#1f2328", mut: "#57606a", faint: "#8c959f", dot: "#d8dee4" },
};

const W = 940;
const PAD = 30;
const FS = 14;
const CW = FS * 0.62;
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const xml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

function styles(t) {
  return `<style>
  .hd{font:700 ${FS + 3}px ${MONO};fill:${t.head}}
  .u{font:400 11px ${MONO};fill:${t.faint}}
  .k{font:400 ${FS}px ${MONO};fill:${t.key}}
  .v{font:400 ${FS}px ${MONO};fill:${t.ink}}
  .m{font:400 ${FS}px ${MONO};fill:${t.mut}}
  .bul{font:400 ${FS}px ${MONO};fill:${t.key}}
</style>`;
}

// blue prompt on the left, rule filling the gap, host on the right
function header(title, host, y, t) {
  const w = title.length * (CW + 1.4) + 16;
  return `<text x="${PAD}" y="${y}" class="hd">${xml(title)}</text>` +
    `<text x="${W - PAD}" y="${y}" text-anchor="end" class="u">${xml(host)}</text>` +
    `<line x1="${PAD + w}" y1="${y - 5}" x2="${W - PAD - host.length * 6.6 - 14}" y2="${y - 5}" stroke="${t.rule}"/>`;
}

const VALX = PAD + 150;

function row(label, value, y, t, cls = "v", valX = VALX) {
  const lx = PAD + CW * 1.6;
  return `<text x="${PAD}" y="${y}" class="bul">.</text>` +
    `<text x="${lx}" y="${y}" class="k">${xml(label + ":")}</text>` +
    `<text x="${valX}" y="${y}" class="${cls}">${xml(value)}</text>`;
}

// No rounded box: github's readme canvas is the same colour as the card, so a
// border is the only thing making four stacked cards look like four things.
// Without it they read as one continuous block, and the rail down the left plus
// a hairline at the top do the separating instead.
function frame(H, t, body, { rule = true } = {}) {
  const railX = 12;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">
${styles(t)}
<rect width="${W}" height="${H}" fill="${t.bg}"/>
${rule ? `<line x1="${PAD}" y1="0.5" x2="${W - PAD}" y2="0.5" stroke="${t.rule}"/>` : ""}
<line x1="${railX}" y1="0" x2="${railX}" y2="${H}" stroke="${t.rule}" stroke-width="1.5"/>
${body}
</svg>`;
}

const pick = (req) =>
  THEMES[new URL(req.url, "http://x").searchParams.get("theme") === "light" ? "light" : "dark"];

module.exports = { THEMES, W, PAD, FS, CW, VALX, MONO, xml, clip, styles, header, row, frame, pick };
