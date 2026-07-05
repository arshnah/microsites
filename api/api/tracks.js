// Top tracks for the playlist page, merged across all Last.fm accounts
// (LASTFM_USERNAMES) with excluded artists removed. ?period=7day|1month|3month|
// 6month|12month|overall (default 1month), ?limit=N (default 24, up to 100).
// Art + real spotify links come from Spotify (pooled). 30s previews from iTunes,
// top tracks only, so a 100-item list stays within limits.

const { topTracks } = require("./_lastfm");

async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    return (await r.json()).access_token || null;
  } catch (e) { return null; }
}

async function spotifyTrack(token, title, artist) {
  if (!token) return {};
  try {
    const r = await (await fetch("https://api.spotify.com/v1/search?type=track&limit=1&q=" + encodeURIComponent(title + " " + artist), { headers: { Authorization: "Bearer " + token } })).json();
    const t = r && r.tracks && r.tracks.items && r.tracks.items[0];
    if (!t) return {};
    return { url: t.external_urls && t.external_urls.spotify, art: (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || null };
  } catch (e) { return {}; }
}

async function itunesPreview(title, artist) {
  try {
    const r = await (await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(artist + " " + title) + "&entity=song&limit=1")).json();
    const x = r && r.results && r.results[0];
    return x ? { preview: x.previewUrl || null, art: x.artworkUrl100 ? x.artworkUrl100.replace("100x100bb", "300x300bb") : null } : {};
  } catch (e) { return {}; }
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length || 1) }, worker));
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600");
  res.statusCode = 200;
  if (!process.env.LASTFM_API_KEY) return res.end(JSON.stringify({ tracks: [] }));

  const q = new URL(req.url, "http://x").searchParams;
  const valid = ["7day", "1month", "3month", "6month", "12month", "overall"];
  const period = valid.includes(q.get("period")) ? q.get("period") : "1month";
  const limit = Math.min(100, Math.max(1, parseInt(q.get("limit"), 10) || 24));

  try {
    const merged = (await topTracks(period, 100)).slice(0, limit);
    const token = await spotifyToken();

    // spotify art + link for every track (pooled to avoid rate limits)
    const tracks = await pool(merged, 10, async (t) => {
      const sp = await spotifyTrack(token, t.title, t.artist);
      return {
        title: t.title, artist: t.artist, plays: t.plays, url: t.url,
        art: sp.art || null, preview: null,
        spotify: sp.url || "https://open.spotify.com/search/" + encodeURIComponent(t.title + " " + t.artist),
      };
    });

    // itunes previews (and art fallback) for the top tracks only
    const N = Math.min(25, tracks.length);
    await pool(tracks.slice(0, N), 8, async (t) => {
      const it = await itunesPreview(t.title, t.artist);
      t.preview = it.preview || null;
      if (!t.art) t.art = it.art || null;
    });

    res.end(JSON.stringify({ period, tracks }));
  } catch (e) {
    res.end(JSON.stringify({ tracks: [] }));
  }
};
