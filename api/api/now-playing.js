// What arshnah is listening to, merged across the Last.fm accounts in
// LASTFM_USERNAMES (priority order; first wins "now playing" ties). Excluded
// artists (see _lastfm) are skipped, so a devotional track that auto-runs never
// shows as the status; the last real song shows as "last played" instead.

const { usernames, isExcluded, artistOf, lfm } = require("./_lastfm");

async function trackFor(user, priority) {
  const r = await lfm("method=user.getrecenttracks&user=" + encodeURIComponent(user) + "&limit=5");
  const arr = (r && r.recenttracks && r.recenttracks.track) || [];
  const t = arr.find((x) => x && x.name && !isExcluded(artistOf(x.artist)));
  if (!t) return null;
  const img = Array.isArray(t.image) && t.image.length ? t.image[t.image.length - 1]["#text"] : "";
  return {
    priority,
    isPlaying: !!(t["@attr"] && t["@attr"].nowplaying === "true"),
    uts: t.date && t.date.uts ? Number(t.date.uts) : 0,
    title: t.name || "",
    artist: artistOf(t.artist),
    url: t.url || "",
    albumArt: img || null,
  };
}

async function nowPlaying() {
  const list = usernames();
  if (!process.env.LASTFM_API_KEY || !list.length) return { isPlaying: false };
  const results = (await Promise.all(list.map((u, i) => trackFor(u, i)))).filter(Boolean);
  if (!results.length) return { isPlaying: false };
  const playing = results.filter((r) => r.isPlaying);
  const pick = playing.length
    ? playing.sort((a, b) => a.priority - b.priority)[0] // playing now; first-listed account wins
    : results.sort((a, b) => b.uts - a.uts)[0]; // else most recent scrobble across accounts
  return { isPlaying: pick.isPlaying, title: pick.title, artist: pick.artist, url: pick.url, albumArt: pick.albumArt };
}

const xml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

function svgCard(d) {
  const W = 480, H = 120;
  const isPlaying = !!d.isPlaying;
  const title = d.title || "Not Playing";
  const artist = d.artist || "Nothing playing right now";
  const statusText = isPlaying ? "NOW PLAYING" : "LAST PLAYED";
  const statusClass = isPlaying ? "status-playing" : "status-idle";
  
  const fallbackArt = `
    <rect width="88" height="88" rx="8" fill="#1b1f26"/>
    <path d="M52 28v36.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V36h12v-8H52z" fill="#5a626e"/>
  `;

  const artHtml = d.albumArt 
    ? `<rect width="88" height="88" rx="8" fill="#1b1f26"/>
       <image href="${xml(d.albumArt)}" width="88" height="88" clip-path="inset(0% round 8px)"/>`
    : fallbackArt;

  const eqHtml = isPlaying ? `
    <g transform="translate(102, -10)">
      <rect class="bar bar-1" x="0" y="2" width="2.5" height="10" fill="#1db954" rx="1" style="transform-origin: 1.25px 12px;"/>
      <rect class="bar bar-2" x="4.5" y="2" width="2.5" height="10" fill="#1db954" rx="1" style="transform-origin: 5.75px 12px;"/>
      <rect class="bar bar-3" x="9" y="2" width="2.5" height="10" fill="#1db954" rx="1" style="transform-origin: 10.25px 12px;"/>
    </g>
  ` : "";

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">
<style>
  .card { fill: #14171c; stroke: #232830; stroke-width: 1.5; }
  .t { font: 700 15px -apple-system, Segoe UI, Helvetica, sans-serif; fill: #e8ebf0; }
  .a { font: 400 13px -apple-system, Segoe UI, Helvetica, sans-serif; fill: #8b93a1; }
  .lbl { font: 700 9px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.12em; }
  .status-playing { fill: #1db954; }
  .status-idle { fill: #5a626e; }
  @keyframes bounce {
    0%, 100% { transform: scaleY(0.3); }
    50% { transform: scaleY(1.0); }
  }
  .bar { animation: bounce 0.8s ease-in-out infinite; }
  .bar-1 { animation-delay: 0.1s; }
  .bar-2 { animation-delay: 0.3s; }
  .bar-3 { animation-delay: 0.5s; }
</style>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" class="card"/>
<g transform="translate(16, 16)">
  ${artHtml}
</g>
<g transform="translate(120, 36)">
  <text x="0" y="0" class="lbl ${statusClass}">${statusText}</text>
  ${eqHtml}
  <text x="0" y="24" class="t">${xml(clip(title, 34))}</text>
  <text x="0" y="44" class="a">${xml(clip(artist, 38))}</text>
</g>
</svg>`;
}

const handler = async (req, res) => {
  const q = new URL(req.url, "http://x").searchParams;
  const isSvg = q.get("svg") === "true";
  const d = await nowPlaying();

  if (isSvg) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=10");
    return res.end(svgCard(d));
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=10");
  res.statusCode = 200;
  res.end(JSON.stringify(d));
};

handler.nowPlaying = nowPlaying;
module.exports = handler;
