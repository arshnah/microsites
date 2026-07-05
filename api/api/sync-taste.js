// Writes the "same taste" Spotify playlist. Two modes:
//
//   (default)     Full rebuild. Re-pulls each taste artist's current top tracks
//                 and PUT-replaces the playlist contents. This is the cron path
//                 (Vercel sends Authorization: Bearer <CRON_SECRET>).
//   ?mode=grow    Append-only. Keeps everything already in the playlist
//                 (including hand-added tracks) and adds only tracks not already
//                 present, widening the seed with Last.fm similar-artists so the
//                 additions are genuinely new. Optional ?max=N caps additions
//                 (default 80). Trigger manually with ?key=<SHUFFLE_KEY> /
//                 <GROW_KEY>, or the CRON_SECRET Bearer.
//
// Uses the stored user refresh token to write.

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

// Last.fm similar artists for a name (taste-adjacent, usually not already seeded).
async function similarArtists(name, limit) {
  const r = await lfm("method=artist.getsimilar&artist=" + encodeURIComponent(name) + "&limit=" + (limit || 8));
  const list = (r && r.similarartists && r.similarartists.artist) || [];
  return list.map((a) => a && a.name).filter(Boolean);
}

// Base seed: merged top artists (or the fallback list).
async function seedArtists() {
  const top = await topArtists("6month", 30);
  return top.length ? top.slice(0, 15).map((a) => a.name) : FALLBACK_ARTISTS;
}

// Widened seed for grow mode: top 40 plus Last.fm similars off the top few,
// de-excluded and de-duped.
async function wideSeedArtists() {
  const top = await topArtists("6month", 40);
  const base = top.length ? top.map((a) => a.name) : FALLBACK_ARTISTS.slice();
  const sim = (await pool(base.slice(0, 15), 8, (n) => similarArtists(n, 8))).flat();
  const seen = new Set(), out = [];
  for (const name of [...base, ...sim]) {
    if (!name || isExcluded(name)) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(name);
  }
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

// Round-robin interleave of the per-artist track lists so the result is a mix.
function interleave(lists) {
  const merged = [];
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < maxLen; i++) for (const list of lists) if (list[i]) merged.push(list[i]);
  return merged;
}

// Candidate Spotify track objects for a set of artist names.
async function candidateTracks(token, artists) {
  const ids = (await pool(artists, 8, (name) => artistId(token, name))).filter(Boolean);
  const lists = await pool(ids, 8, (id) => topTracks(token, id));
  return interleave(lists);
}

// URIs already in the playlist, so grow never adds a duplicate.
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

async function doReplace(res, token, pid) {
  const tracks = await candidateTracks(token, await seedArtists());
  const seen = new Set(), uris = [];
  for (const t of tracks) {
    if (!t.uri || seen.has(t.uri)) continue;
    const artist = (t.artists && t.artists[0] && t.artists[0].name) || "";
    if (isExcluded(artist)) continue;
    seen.add(t.uri); uris.push(t.uri);
    if (uris.length >= 100) break;
  }
  if (!uris.length) { res.statusCode = 500; return res.end(JSON.stringify({ error: "no tracks resolved" })); }
  const put = await fetch("https://api.spotify.com/v1/playlists/" + pid + "/tracks", {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ uris }),
  });
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: put.ok, mode: "replace", replaced: uris.length, status: put.status }));
}

async function doGrow(res, token, pid, cap) {
  const have = await existingUris(token, pid);
  const tracks = await candidateTracks(token, await wideSeedArtists());
  const seen = new Set(), fresh = [];
  for (const t of tracks) {
    if (!t.uri || have.has(t.uri) || seen.has(t.uri)) continue;
    const artist = (t.artists && t.artists[0] && t.artists[0].name) || "";
    if (isExcluded(artist)) continue;
    seen.add(t.uri); fresh.push(t.uri);
    if (fresh.length >= cap) break;
  }
  if (!fresh.length) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, mode: "grow", added: 0, before: have.size, note: "nothing new to add" }));
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
  res.end(JSON.stringify({ ok: true, mode: "grow", added, before: have.size, after: have.size + added }));
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const params = new URL(req.url, "http://x").searchParams;
  const grow = params.get("mode") === "grow";

  // Replace is cron-privileged (CRON_SECRET only). Grow also accepts the plain
  // SHUFFLE_KEY / GROW_KEY via ?key= so it can be triggered by hand.
  const cronSecret = process.env.CRON_SECRET;
  const growKey = process.env.GROW_KEY || process.env.SHUFFLE_KEY;
  const bearer = req.headers.authorization;
  const authedCron = cronSecret && bearer === "Bearer " + cronSecret;
  const authedGrow = growKey && (params.get("key") === growKey || bearer === "Bearer " + growKey);
  const ok = grow ? (authedCron || authedGrow) : (!cronSecret || authedCron);
  if (!ok) { res.statusCode = 401; return res.end(JSON.stringify({ error: "unauthorized" })); }

  const pid = process.env.SAME_TASTE_PLAYLIST_ID;
  const token = await userToken();
  if (!token || !pid) { res.statusCode = 500; return res.end(JSON.stringify({ error: "not configured" })); }

  try {
    if (grow) {
      const maxParam = Number(params.get("max"));
      const cap = Number.isFinite(maxParam) && maxParam > 0 ? Math.min(maxParam, 500) : 80;
      return await doGrow(res, token, pid, cap);
    }
    return await doReplace(res, token, pid);
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ error: String(e) }));
  }
};
