// Top tracks from Last.fm for the playlist page. ?period=7day|1month|3month|
// 6month|12month|overall (default 1month), ?limit=N (default 24, up to 100).
// Art + real spotify links come from Spotify (pooled). 30s previews come from
// iTunes, but only for the top tracks so a 100-item list stays within limits.

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

  const key = process.env.LASTFM_API_KEY, user = process.env.LASTFM_USERNAME;
  if (!key || !user) return res.end(JSON.stringify({ tracks: [] }));

  const q = new URL(req.url, "http://x").searchParams;
  const valid = ["7day", "1month", "3month", "6month", "12month", "overall"];
  const period = valid.includes(q.get("period")) ? q.get("period") : "1month";
  const limit = Math.min(100, Math.max(1, parseInt(q.get("limit"), 10) || 24));

  try {
    const r = await (await fetch(
      "https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=" + encodeURIComponent(user) +
      "&period=" + period + "&limit=" + limit + "&api_key=" + encodeURIComponent(key) + "&format=json"
    )).json();
    const arr = (r && r.toptracks && r.toptracks.track) || [];
    const token = await spotifyToken();

    // spotify art + link for every track (pooled to avoid rate limits)
    const tracks = await pool(arr, 10, async (t) => {
      const artist = (t.artist && (t.artist.name || t.artist["#text"])) || "";
      const sp = await spotifyTrack(token, t.name, artist);
      return {
        title: t.name, artist, plays: +t.playcount || 0, url: t.url,
        art: sp.art || null, preview: null,
        spotify: sp.url || "https://open.spotify.com/search/" + encodeURIComponent(t.name + " " + artist),
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
