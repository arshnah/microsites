// What arshnah is listening to, merged across the Last.fm accounts in
// LASTFM_USERNAMES (priority order; first wins "now playing" ties). Excluded
// artists (see _lastfm) are skipped, so a devotional track that auto-runs never
// shows as the status; the last real song shows as "last played" instead.

const { usernames, isExcluded, artistOf, lfm } = require("./_lastfm");
const { fetchLyrics } = require("./_lyrics");

// Real-time playback position, via Discord's Spotify Rich Presence (through
// Lanyard) rather than Last.fm — scrobbles are polled/delayed and carry no
// exact timestamp, so they can't drive synced lyrics. Lives behind ?live=1
// on this same route rather than its own file: this project is at its
// Hobby-plan cap of 12 Serverless Functions, so new routes aren't free.
const SPOTIFY_LIVE_IDS = (process.env.DISCORD_IDS || "1352866897900732446,300137175238836225")
  .split(",").map((s) => s.trim()).filter(Boolean);
const LANYARD_HOSTS = ["https://larpyard.arshnah.in", "https://api.lanyard.rest"];

async function fetchPresence(id) {
  for (const host of LANYARD_HOSTS) {
    const r = await fetch(host + "/v1/users/" + id).then((r) => r.json()).catch(() => null);
    if (r && r.success && r.data) return r.data;
  }
  return null;
}

async function spotifyLiveNow() {
  const results = await Promise.all(SPOTIFY_LIVE_IDS.map(fetchPresence));
  const withSpotify = results.find((d) => d && d.listening_to_spotify && d.spotify);
  if (!withSpotify) return { playing: false };
  const sp = withSpotify.spotify;
  const start = sp.timestamps && sp.timestamps.start;
  const end = sp.timestamps && sp.timestamps.end;
  if (!sp.song || !start) return { playing: false };
  return {
    playing: true,
    title: sp.song,
    artist: sp.artist || "",
    album: sp.album || "",
    trackId: sp.track_id || null,
    albumArt: sp.album_art_url || null,
    startMs: start,
    endMs: end || null,
  };
}

// Last.fm frequently has no cover for non-Western tracks (bollywood
// especially), so fall back to iTunes artwork when its own image is empty.
// Same fallback lastly's now-playing card already uses, ported over.
async function itunesArt(artist, track) {
  const term = (artist + " " + track).trim();
  if (!term) return null;
  try {
    const r = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(term) + "&entity=song&limit=1");
    const d = await r.json();
    const art = d && d.results && d.results[0] && d.results[0].artworkUrl100;
    return art ? art.replace("100x100bb", "600x600bb") : null;
  } catch (e) {
    return null;
  }
}

async function trackFor(user, priority) {
  const r = await lfm("method=user.getrecenttracks&user=" + encodeURIComponent(user) + "&limit=5");
  const arr = (r && r.recenttracks && r.recenttracks.track) || [];
  const t = arr.find((x) => x && x.name && !isExcluded(artistOf(x.artist)));
  if (!t) return null;
  const img = Array.isArray(t.image) && t.image.length ? t.image[t.image.length - 1]["#text"] : "";
  const artist = artistOf(t.artist);
  const albumArt = img || (await itunesArt(artist, t.name));
  return {
    priority,
    isPlaying: !!(t["@attr"] && t["@attr"].nowplaying === "true"),
    uts: t.date && t.date.uts ? Number(t.date.uts) : 0,
    title: t.name || "",
    artist,
    url: t.url || "",
    albumArt: albumArt || null,
  };
}

const ago = (uts) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - uts);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};

// last few *finished* scrobbles (currently-playing track excluded — that's
// already shown by the main now-playing widget), merged across accounts.
async function recentTracks(limit) {
  const list = usernames();
  if (!process.env.LASTFM_API_KEY || !list.length) return [];
  const per = await Promise.all(list.map((u) => lfm("method=user.getrecenttracks&user=" + encodeURIComponent(u) + "&limit=10")));
  const flat = [];
  for (const r of per) {
    const arr = (r && r.recenttracks && r.recenttracks.track) || [];
    for (const t of arr) {
      if (!t || !t.name) continue;
      if (t["@attr"] && t["@attr"].nowplaying === "true") continue; // shown elsewhere
      const uts = t.date && t.date.uts ? Number(t.date.uts) : 0;
      if (!uts) continue;
      const artist = artistOf(t.artist);
      if (isExcluded(artist)) continue;
      const img = Array.isArray(t.image) && t.image.length ? t.image[t.image.length - 1]["#text"] : "";
      flat.push({ title: t.name, artist, uts, albumArt: img || null, url: t.url || "" });
    }
  }
  flat.sort((a, b) => b.uts - a.uts);
  const out = [];
  const seen = new Set();
  for (const t of flat) {
    const key = (t.title + "|" + t.artist).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: t.title, artist: t.artist, albumArt: t.albumArt, url: t.url, ago: ago(t.uts) });
    if (out.length >= limit) break;
  }
  return out;
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

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (q.get("live") === "1") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3, s-maxage=3, stale-while-revalidate=8");
    try {
      return res.end(JSON.stringify(await spotifyLiveNow()));
    } catch (e) {
      return res.end(JSON.stringify({ playing: false }));
    }
  }

  if (q.get("recent") === "1") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    try {
      return res.end(JSON.stringify({ tracks: await recentTracks(5) }));
    } catch (e) {
      return res.end(JSON.stringify({ tracks: [] }));
    }
  }

  if (q.get("lyrics") === "1") {
    // lyrics for a given track never change — cache this shape hard. The
    // query string (track+artist+album+duration) is the cache key.
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400");
    const track = (q.get("track") || "").trim();
    const artist = (q.get("artist") || "").trim();
    const album = (q.get("album") || "").trim();
    const duration = Number(q.get("duration") || "") || null;
    try {
      return res.end(JSON.stringify(await fetchLyrics(track, artist, album, duration)));
    } catch (e) {
      return res.end(JSON.stringify({ found: false }));
    }
  }

  const isSvg = q.get("svg") === "true";
  const d = await nowPlaying();

  if (isSvg) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=10");
    return res.end(svgCard(d));
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=10");
  res.statusCode = 200;
  res.end(JSON.stringify(d));
};

handler.nowPlaying = nowPlaying;
module.exports = handler;
