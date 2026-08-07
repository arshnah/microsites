// A Last.fm "year in sound" for any username. ?user=NAME (defaults to the site's
// own listener). Pulls the last 12 months of top artists (with Spotify photos),
// top tracks (with iTunes covers + 30s previews), the top album, and lifetime
// totals. CORS-open so any front-end can build a wrapped from it.
//
// ?user2=NAME merges a second Last.fm account into the same wrapped: playcounts
// are summed per artist/track/album across both accounts before re-ranking, so
// someone with an alt account gets one combined year instead of two partial ones.

async function lastfm(user, method, extra) {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return null;
  const url = "https://ws.audioscrobbler.com/2.0/?method=" + method + "&user=" + encodeURIComponent(user) +
    "&api_key=" + encodeURIComponent(key) + "&format=json" + (extra || "");
  try { return await (await fetch(url)).json(); } catch (e) { return null; }
}

// Merged top artists across the given accounts (playcounts summed), re-sorted.
async function mergedArtists(users, extra) {
  const per = await Promise.all(users.map((u) => lastfm(u, "user.gettopartists", extra)));
  const totals = new Map();
  for (const r of per) {
    for (const a of (r && r.topartists && r.topartists.artist) || []) {
      if (!a || !a.name) continue;
      const key = a.name.toLowerCase();
      const prev = totals.get(key);
      totals.set(key, { name: a.name, plays: (Number(a.playcount) || 0) + (prev ? prev.plays : 0) });
    }
  }
  return [...totals.values()].sort((x, y) => y.plays - x.plays);
}

// Merged top tracks across the given accounts (playcounts summed), re-sorted.
async function mergedTracks(users, extra) {
  const per = await Promise.all(users.map((u) => lastfm(u, "user.gettoptracks", extra)));
  const totals = new Map();
  for (const r of per) {
    for (const t of (r && r.toptracks && r.toptracks.track) || []) {
      if (!t || !t.name) continue;
      const artist = (t.artist && (t.artist.name || t.artist["#text"])) || "";
      const key = (t.name + "|" + artist).toLowerCase();
      const prev = totals.get(key);
      totals.set(key, { name: t.name, artist, plays: (Number(t.playcount) || 0) + (prev ? prev.plays : 0) });
    }
  }
  return [...totals.values()].sort((a, b) => b.plays - a.plays);
}

// Merged top albums across the given accounts (playcounts summed), re-sorted.
async function mergedAlbums(users, extra) {
  const per = await Promise.all(users.map((u) => lastfm(u, "user.gettopalbums", extra)));
  const totals = new Map();
  for (const r of per) {
    for (const al of (r && r.topalbums && r.topalbums.album) || []) {
      if (!al || !al.name) continue;
      const artist = (al.artist && (al.artist.name || al.artist["#text"])) || "";
      const key = (al.name + "|" + artist).toLowerCase();
      const img = Array.isArray(al.image) && al.image.length ? al.image[al.image.length - 1]["#text"] : "";
      const prev = totals.get(key);
      totals.set(key, { name: al.name, artist, plays: (Number(al.playcount) || 0) + (prev ? prev.plays : 0), image: (prev && prev.image) || img });
    }
  }
  return [...totals.values()].sort((a, b) => b.plays - a.plays);
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

async function artistImage(token, name) {
  if (!token) return null;
  try {
    const r = await (await fetch("https://api.spotify.com/v1/search?type=artist&limit=1&q=" + encodeURIComponent(name), { headers: { Authorization: "Bearer " + token } })).json();
    const a = r && r.artists && r.artists.items && r.artists.items[0];
    return (a && a.images && a.images[0] && a.images[0].url) || null;
  } catch (e) { return null; }
}

async function itunes(term, entity, size) {
  try {
    const r = await (await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(term) + "&entity=" + entity + "&limit=1")).json();
    const x = r && r.results && r.results[0];
    if (!x) return {};
    return { art: x.artworkUrl100 ? x.artworkUrl100.replace("100x100bb", size + "x" + size + "bb") : null, preview: x.previewUrl || null };
  } catch (e) { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400");
  res.statusCode = 200;

  const q = new URL(req.url, "http://x").searchParams;
  let user = (q.get("user") || process.env.LASTFM_USERNAME || "").trim();
  let user2 = (q.get("user2") || "").trim();
  if (user.toLowerCase() === "arshnah") user = "arshnahbtw";
  if (user2.toLowerCase() === "arshnah") user2 = "arshnahbtw";
  if (user2.toLowerCase() === user.toLowerCase()) user2 = "";
  if (!user) return res.end(JSON.stringify({ error: "no username" }));

  const info = await lastfm(user, "user.getinfo");
  if (!info || !info.user || info.error) return res.end(JSON.stringify({ error: "user not found" }));

  let info2 = null;
  if (user2) {
    info2 = await lastfm(user2, "user.getinfo");
    if (!info2 || !info2.user || info2.error) return res.end(JSON.stringify({ error: "second user not found" }));
  }

  const users = info2 ? [user, user2] : [user];
  const limit = info2 ? "&limit=50" : "&limit=5";

  const [rawArtists, rawTracks, rawAlbums, token] = await Promise.all([
    mergedArtists(users, "&period=12month" + limit),
    mergedTracks(users, "&period=12month" + limit),
    mergedAlbums(users, "&period=12month" + (info2 ? "&limit=50" : "&limit=1")),
    spotifyToken(),
  ]);

  const topArtists = await Promise.all(rawArtists.slice(0, 5).map(async (a) => ({
    name: a.name, plays: a.plays, image: await artistImage(token, a.name),
  })));

  const topTracks = await Promise.all(rawTracks.slice(0, 5).map(async (t) => {
    const it = await itunes(t.artist + " " + t.name, "song", 300);
    return { title: t.name, artist: t.artist, plays: t.plays, art: it.art, preview: it.preview || null };
  }));

  let topAlbum = null;
  const al = rawAlbums[0];
  if (al) {
    const it = al.image ? {} : await itunes(al.artist + " " + al.name, "album", 600);
    topAlbum = { name: al.name, artist: al.artist, plays: al.plays, art: al.image || it.art || null };
  }

  const name = info2 ? info.user.name + " & " + info2.user.name : info.user.name;
  const scrobbles = (+info.user.playcount || 0) + (info2 ? (+info2.user.playcount || 0) : 0);
  const artists = (+info.user.artist_count || 0) + (info2 ? (+info2.user.artist_count || 0) : 0);

  res.end(JSON.stringify({
    user: { name, scrobbles, artists, url: info.user.url },
    topArtists, topTracks, topAlbum,
  }));
};
