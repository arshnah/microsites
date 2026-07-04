// Weekly refresh of the "same taste" Spotify playlist. Re-pulls each taste
// artist's current top tracks and replaces the playlist's contents. Runs via
// Vercel cron (which sends Authorization: Bearer <CRON_SECRET>); also callable
// manually with that header. Uses the stored user refresh token to write.

const ARTISTS = [
  "Arijit Singh", "Rahat Fateh Ali Khan", "Atif Aslam", "Mohit Chauhan", "KK",
  "Shreya Ghoshal", "Armaan Malik", "Jubin Nautiyal", "Darshan Raval", "Vishal Mishra",
  "B Praak", "Ankit Tiwari", "Papon", "Javed Ali", "Sonu Nigam",
];

async function pool(items, n, fn) {
  const out = new Array(items.length); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length || 1) }, worker));
  return out;
}

async function userToken() {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET, refresh = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(refresh),
  });
  return (await r.json()).access_token || null;
}

async function artistId(token, name) {
  try {
    const r = await (await fetch("https://api.spotify.com/v1/search?type=artist&limit=1&q=" + encodeURIComponent(name), { headers: { Authorization: "Bearer " + token } })).json();
    const a = r && r.artists && r.artists.items && r.artists.items[0];
    return (a && a.id) || null;
  } catch (e) { return null; }
}

async function topTracks(token, id) {
  try {
    const r = await (await fetch("https://api.spotify.com/v1/artists/" + id + "/top-tracks?market=IN", { headers: { Authorization: "Bearer " + token } })).json();
    return (r && r.tracks) || [];
  } catch (e) { return []; }
}

async function buildUris(token) {
  const ids = (await pool(ARTISTS, 8, (name) => artistId(token, name))).filter(Boolean);
  const lists = await pool(ids, 8, (id) => topTracks(token, id));
  const merged = [];
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < maxLen; i++) for (const list of lists) if (list[i]) merged.push(list[i]);
  const seen = new Set(), uris = [];
  for (const t of merged) {
    if (!t.uri || seen.has(t.uri)) continue;
    seen.add(t.uri); uris.push(t.uri);
    if (uris.length >= 100) break;
  }
  return uris;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== "Bearer " + secret) {
    res.statusCode = 401; return res.end(JSON.stringify({ error: "unauthorized" }));
  }

  const pid = process.env.SAME_TASTE_PLAYLIST_ID;
  const token = await userToken();
  if (!token || !pid) { res.statusCode = 500; return res.end(JSON.stringify({ error: "not configured" })); }

  try {
    const uris = await buildUris(token);
    if (!uris.length) { res.statusCode = 500; return res.end(JSON.stringify({ error: "no tracks resolved" })); }
    // PUT replaces the whole playlist in one shot (max 100)
    const put = await fetch("https://api.spotify.com/v1/playlists/" + pid + "/tracks", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ uris }),
    });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: put.ok, replaced: uris.length, status: put.status }));
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ error: String(e) }));
  }
};
