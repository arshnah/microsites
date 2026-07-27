const { VALX, clip, header, row, frame, pick } = require("./_theme");

const API = process.env.API_BASE || "https://api.arshnah.in";
const STATUS_TXT = { online: "online", idle: "idle", dnd: "do not disturb", offline: "offline" };
const STATUS_COLOR = { online: "#3fb950", idle: "#d29922", dnd: "#f85149", offline: "#6e7681" };

async function getData() {
  const out = { status: "offline", commit: null, coding: null };
  const get = (p) => fetch(API + p).then((r) => r.json()).catch(() => null);
  const [dc, cm, wk] = await Promise.all([
    get("/api/discord-status"),
    get("/api/last-commit"),
    get("/api/coding")
  ]);

  if (dc && dc.status) out.status = dc.status;
  if (cm && cm.ok) out.commit = cm.message + "  ·  " + (cm.repo ? cm.repo.split("/")[1] : "") + "  ·  " + cm.ago;
  if (wk && wk.ok && wk.text) {
    out.coding = wk.text + (wk.range === "week" ? " this week" : " today") + (wk.language ? "  ·  mostly " + wk.language : "");
  }
  return out;
}

function svg(d, t) {
  const time = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toLowerCase();

  const rows = [];
  rows.push(["status", (STATUS_TXT[d.status] || d.status) + "  ·  " + time + " ist"]);
  // no listening row — the last.fm card directly above this one already has it
  if (d.coding) rows.push(["coding", clip(d.coding, 74)]);
  rows.push(["shipped", d.commit ? clip(d.commit, 74) : "nothing public lately"]);

  const y = 84;
  const body = rows.map(([k, v], i) => {
    const ry = y + i * 26;
    // the status row carries a presence dot, so its value starts further right
    if (k !== "status") return row(k, v, ry, t);
    return `<circle cx="${VALX + 6}" cy="${ry - 5}" r="4.5" fill="${STATUS_COLOR[d.status] || "#6e7681"}"/>` +
      row(k, v, ry, t, "v", VALX + 20);
  }).join("\n");

  const H = y + rows.length * 26 + 12;
  return frame(H, t, header("arshnah@now", "now.arshnah.in", 46, t) + "\n" + body);
}

module.exports = async (req, res) => {
  const t = pick(req);
  const d = await getData();
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=10");
  res.end(svg(d, t));
};
