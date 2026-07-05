// A ~100-track "same taste" mix built from a listener's top artists. Default
// seed is arshnah's merged Last.fm accounts (the playlist page uses this); pass
// ?user=<lastfm> to build the mix for anyone (powers wrapped's "same taste mix"
// slide). Each seed artist's Spotify top tracks are pulled and interleaved, with
// real art + spotify links, and 30s iTunes previews for the top tracks so it
// plays. ?limit=N caps the list (default 100).

const { topArtists, lfm, isExcluded } = require("./_lastfm");

const FALLBACK_ARTISTS = [
  "Arijit Singh", "Rahat Fateh Ali Khan", "Atif Aslam", "Mohit Chauhan", "KK",
  "Shreya Ghoshal", "Armaan Malik", "Jubin Nautiyal", "Darshan Raval", "Vishal Mishra",
  "B Praak", "Ankit Tiwari", "Papon", "Javed Ali", "Sonu Nigam",
];

// Top artists for one specific Last.fm user (not the arshnah merge).
async function userTopArtists(user) {
  const r = await lfm("method=user.gettopartists&user=" + encodeURIComponent(user) + "&period=6month&limit=30");
  const list = (r && r.topartists && r.topartists.artist) || [];
  return list.map((a) => a && a.name).filter((n) => n && !isExcluded(n));
}

// Seed = the given user's top artists, else arshnah's merge, else the fallback.
async function seedArtists(user) {
  if (user) {
    const mine = await userTopArtists(user);
    return mine.length ? mine.slice(0, 15) : null; // null → user had nothing usable
  }
  const top = await topArtists("6month", 30);
  return top.length ? top.slice(0, 15).map((a) => a.name) : FALLBACK_ARTISTS;
}

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

async function pool(items, n, fn) {
  const out = new Array(items.length); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length || 1) }, worker));
  return out;
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

async function itunesPreview(title, artist) {
  try {
    const r = await (await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(artist + " " + title) + "&entity=song&limit=1")).json();
    const x = r && r.results && r.results[0];
    return x ? { preview: x.previewUrl || null } : {};
  } catch (e) { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=172800");
  res.statusCode = 200;

  const q = new URL(req.url, "http://x").searchParams;
  const user = (q.get("user") || "").trim();
  const limit = Math.min(100, Math.max(1, parseInt(q.get("limit"), 10) || 100));

  const token = await spotifyToken();
  if (!token) return res.end(JSON.stringify({ user: user || null, tracks: [] }));

  const artists = await seedArtists(user);
  if (!artists) return res.end(JSON.stringify({ user, tracks: [], error: "user not found" }));

  const ids = (await pool(artists, 8, (name) => artistId(token, name))).filter(Boolean);
  const lists = await pool(ids, 8, (id) => topTracks(token, id));

  // interleave round-robin so it's a mix, not 10 of each artist in a row
  const merged = [];
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < maxLen; i++) for (const list of lists) if (list[i]) merged.push(list[i]);

  const seen = new Set(), tracks = [];
  for (const t of merged) {
    const artist = (t.artists && t.artists[0] && t.artists[0].name) || "";
    const key = (t.name + "|" + artist).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push({
      title: t.name, artist,
      art: (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || null,
      preview: null,
      spotify: (t.external_urls && t.external_urls.spotify) || "https://open.spotify.com/search/" + encodeURIComponent(t.name + " " + artist),
    });
    if (tracks.length >= limit) break;
  }

  // 30s iTunes previews for the top slice so the mix actually plays
  const N = Math.min(25, tracks.length);
  await pool(tracks.slice(0, N), 8, async (t) => {
    const it = await itunesPreview(t.title, t.artist);
    t.preview = it.preview || null;
  });

  res.end(JSON.stringify({ user: user || null, tracks }));
};
