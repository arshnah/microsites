// Server-rendered SVG of "what arsh is doing right now", for embedding in a
// GitHub README (which runs no JS). Fetches Lanyard (Discord + Spotify) and
// GitHub (last push) on the server, returns a static-looking card.

// Lanyard only tracks accounts that joined discord.gg/lanyard, so query all
// ids and take the best presence (1352… is not in the server, 3001… is).
const DISCORD_IDS = (process.env.DISCORD_IDS || "1352866897900732446,300137175238836225").split(",").map((s) => s.trim()).filter(Boolean);
const rank = (s) => (s === "online" ? 4 : s === "idle" ? 3 : s === "dnd" ? 2 : 1);
const STATUS_TXT = { online: "online", idle: "idle", dnd: "do not disturb", offline: "offline" };
const STATUS_COLOR = { online: "#3ba55d", idle: "#e0a838", dnd: "#e0483d", offline: "#5a626e" };

const xml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

async function getData() {
  const out = { status: "offline", listening: null, commit: null };
  try {
    const results = await Promise.all(
      DISCORD_IDS.map((id) => fetch("https://api.lanyard.rest/v1/users/" + id).then((r) => r.json()).catch(() => null))
    );
    const presences = results.filter((r) => r && r.success && r.data).map((r) => r.data);
    if (presences.length) out.status = presences.sort((a, b) => rank(b.discord_status) - rank(a.discord_status))[0].discord_status || "offline";
  } catch (e) {}
  try {
    // listening from last.fm (only when a track is playing right now)
    const key = process.env.LASTFM_API_KEY, user = process.env.LASTFM_USERNAME;
    if (key && user) {
      const lf = await (await fetch("https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=" + encodeURIComponent(user) + "&api_key=" + encodeURIComponent(key) + "&format=json&limit=1")).json();
      const t = lf && lf.recenttracks && lf.recenttracks.track && lf.recenttracks.track[0];
      if (t && t["@attr"] && t["@attr"].nowplaying === "true") out.listening = t.name + " · " + ((t.artist && t.artist["#text"]) || "");
    }
  } catch (e) {}
  try {
    const ghHeaders = { "User-Agent": "now.arshnah.in" };
    if (process.env.GITHUB_TOKEN) ghHeaders.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
    const ev = await (await fetch("https://api.github.com/users/arshnah/events/public?per_page=30", { headers: ghHeaders })).json();
    // the user events feed returns push payloads without the commits list, only the head sha
    const push = Array.isArray(ev) ? ev.find((e) => e.type === "PushEvent" && e.payload && e.payload.head && e.repo) : null;
    if (push) {
      let msg = "pushed";
      try {
        const cj = await (await fetch("https://api.github.com/repos/" + push.repo.name + "/commits/" + push.payload.head, { headers: ghHeaders })).json();
        if (cj && cj.commit && cj.commit.message) msg = cj.commit.message.split("\n")[0].toLowerCase();
      } catch (e) {}
      out.commit = msg + "  ·  " + push.repo.name.split("/")[1] + "  ·  " + ago(push.created_at);
    }
  } catch (e) {}
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
