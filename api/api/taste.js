// A ~100-track "same taste" mix, auto-built from what arshnah actually listens
// to. The artist seed is the merged top artists across the Last.fm accounts
// (excluded artists removed); if that comes back empty we fall back to a curated
// bollywood-romantic / sufi list. Each seed artist's Spotify top tracks are
// pulled and interleaved. Real art + spotify links.

const { topArtists } = require("./_lastfm");

const FALLBACK_ARTISTS = [
  "Arijit Singh", "Rahat Fateh Ali Khan", "Atif Aslam", "Mohit Chauhan", "KK",
  "Shreya Ghoshal", "Armaan Malik", "Jubin Nautiyal", "Darshan Raval", "Vishal Mishra",
  "B Praak", "Ankit Tiwari", "Papon", "Javed Ali", "Sonu Nigam",
];

async function seedArtists() {
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

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=172800");
  res.statusCode = 200;

  const token = await spotifyToken();
  if (!token) return res.end(JSON.stringify({ tracks: [] }));

  const artists = await seedArtists();
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
    if (tracks.length >= 100) break;
  }

  res.end(JSON.stringify({ tracks }));
};
