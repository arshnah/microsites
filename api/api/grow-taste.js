// Grow the "same taste" Spotify playlist by APPENDING new tracks, never
// replacing. Unlike sync-taste (which PUT-wipes the playlist) this reads what's
// already there, keeps all of it (including hand-added tracks), and adds only
// tracks not already present. To find genuinely new songs it widens the artist
// seed with Last.fm similar-artists, resolves each on Spotify, and pulls their
// top tracks. Trigger with ?key=<SHUFFLE_KEY> (or GROW_KEY), optional ?max=N
// to cap how many new tracks are added per run (default 80).

const { topArtists, lfm, isExcluded } = require("./_lastfm");

const FALLBACK_ARTISTS = [
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

// Last.fm similar artists for a name (taste-adjacent, likely NOT already seeded).
async function similarArtists(name, limit) {
  const r = await lfm("method=artist.getsimilar&artist=" + encodeURIComponent(name) + "&limit=" + (limit || 8));
  const list = (r && r.similarartists && r.similarartists.artist) || [];
  return list.map((a) => a && a.name).filter(Boolean);
}

// Seed = merged top artists, widened with similar artists off the top few.
async function seedArtists() {
  const top = await topArtists("6month", 40);
  const base = top.length ? top.map((a) => a.name) : FALLBACK_ARTISTS.slice();
  const heads = base.slice(0, 15);
  const sim = (await pool(heads, 8, (n) => similarArtists(n, 8))).flat();
  const seen = new Set(), out = [];
  for (const name of [...base, ...sim]) {
    if (!name || isExcluded(name)) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(name);
  }
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

// URIs already in the playlist, so we never add a duplicate.
async function existingUris(token, pid) {
  const set = new Set();
  let url = "https://api.spotify.com/v1/playlists/" + pid + "/tracks?fields=items(track(uri)),next&limit=100";
  while (url) {
    const r = await (await fetch(url, { headers: { Authorization: "Bearer " + token } })).json();
    for (const it of (r.items || [])) if (it && it.track && it.track.uri) set.add(it.track.uri);
    url = r.next;
  }
  return set;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const key = process.env.GROW_KEY || process.env.SHUFFLE_KEY;
  const given = new URL(req.url, "http://x").searchParams.get("key");
  if (key && given !== key && req.headers.authorization !== "Bearer " + key) {
    res.statusCode = 401; return res.end(JSON.stringify({ error: "unauthorized" }));
  }

  const pid = process.env.SAME_TASTE_PLAYLIST_ID;
  const token = await userToken();
  if (!token || !pid) { res.statusCode = 500; return res.end(JSON.stringify({ error: "not configured" })); }

  const maxParam = Number(new URL(req.url, "http://x").searchParams.get("max"));
  const cap = Number.isFinite(maxParam) && maxParam > 0 ? Math.min(maxParam, 500) : 80;

  try {
    const have = await existingUris(token, pid);

    const artists = await seedArtists();
    const ids = (await pool(artists, 8, (name) => artistId(token, name))).filter(Boolean);
    const lists = await pool(ids, 8, (id) => topTracks(token, id));

    // interleave round-robin so the additions are a mix, not blocks per artist
    const merged = [];
    const maxLen = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < maxLen; i++) for (const list of lists) if (list[i]) merged.push(list[i]);

    const seen = new Set(), fresh = [];
    for (const t of merged) {
      if (!t.uri || have.has(t.uri) || seen.has(t.uri)) continue;
      const artist = (t.artists && t.artists[0] && t.artists[0].name) || "";
      if (isExcluded(artist)) continue;
      seen.add(t.uri); fresh.push(t.uri);
      if (fresh.length >= cap) break;
    }

    if (!fresh.length) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, added: 0, before: have.size, note: "nothing new to add" }));
    }

    let added = 0;
    for (let i = 0; i < fresh.length; i += 100) {
      const batch = fresh.slice(i, i + 100);
      const r = await fetch("https://api.spotify.com/v1/playlists/" + pid + "/tracks", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: batch }),
      });
      if (!r.ok) { res.statusCode = 500; return res.end(JSON.stringify({ error: "add batch failed", status: r.status, added, before: have.size })); }
      added += batch.length;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, added, before: have.size, after: have.size + added }));
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ error: String(e) }));
  }
};
