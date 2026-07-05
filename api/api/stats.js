// A full Last.fm dashboard for a user: lifetime totals, top artists (with
// Spotify photos), top albums + top tracks (iTunes art), and recent plays.
// ?user=NAME&period=7day|1month|3month|6month|12month|overall (default overall).
// Defaults to the priority account and drops excluded artists.

const { usernames, isExcluded } = require("./_lastfm");

async function lastfm(user, method, extra) {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return null;
  const url = "https://ws.audioscrobbler.com/2.0/?method=" + method + "&user=" + encodeURIComponent(user) +
    "&api_key=" + encodeURIComponent(key) + "&format=json" + (extra || "");
  try { return await (await fetch(url)).json(); } catch (e) { return null; }
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

async function spotifyTrack(token, title, artist) {
  if (!token) return {};
  try {
    const r = await (await fetch("https://api.spotify.com/v1/search?type=track&limit=1&q=" + encodeURIComponent(title + " " + artist), { headers: { Authorization: "Bearer " + token } })).json();
    const t = r && r.tracks && r.tracks.items && r.tracks.items[0];
    if (!t) return {};
    return { url: t.external_urls && t.external_urls.spotify, art: (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || null };
  } catch (e) { return {}; }
}

async function spotifyAlbum(token, name, artist) {
  if (!token) return {};
  try {
    const r = await (await fetch("https://api.spotify.com/v1/search?type=album&limit=1&q=" + encodeURIComponent(name + " " + artist), { headers: { Authorization: "Bearer " + token } })).json();
    const a = r && r.albums && r.albums.items && r.albums.items[0];
    if (!a) return {};
    return { art: (a.images && a.images[0] && a.images[0].url) || null, url: (a.external_urls && a.external_urls.spotify) || null };
  } catch (e) { return {}; }
}

async function itunes(term, entity, size) {
  try {
    const r = await (await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(term) + "&entity=" + entity + "&limit=1")).json();
    const x = r && r.results && r.results[0];
    if (!x) return {};
    return { art: x.artworkUrl100 ? x.artworkUrl100.replace("100x100bb", size + "x" + size + "bb") : null, preview: x.previewUrl || null };
  } catch (e) { return {}; }
}

const artistName = (a) => (a && (a.name || a["#text"])) || "";

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400");
  res.statusCode = 200;

  const q = new URL(req.url, "http://x").searchParams;
  const user = (q.get("user") || usernames()[0] || "").trim();
  const valid = ["7day", "1month", "3month", "6month", "12month", "overall"];
  const period = valid.includes(q.get("period")) ? q.get("period") : "overall";
  if (!user) return res.end(JSON.stringify({ error: "no username" }));

  const info = await lastfm(user, "user.getinfo");
  if (!info || !info.user || info.error) return res.end(JSON.stringify({ error: "user not found" }));

  const [artistsR, albumsR, tracksR, recentR, token] = await Promise.all([
    lastfm(user, "user.gettopartists", "&period=" + period + "&limit=8"),
    lastfm(user, "user.gettopalbums", "&period=" + period + "&limit=24"),
    lastfm(user, "user.gettoptracks", "&period=" + period + "&limit=8"),
    lastfm(user, "user.getrecenttracks", "&limit=8"),
    spotifyToken(),
  ]);

  const artists = await Promise.all(((artistsR && artistsR.topartists && artistsR.topartists.artist) || [])
    .filter((a) => a && a.name && !isExcluded(a.name))
    .map(async (a) => ({
      name: a.name, plays: +a.playcount || 0, image: await artistImage(token, a.name),
    })));

  // Last.fm already has the correct cover for the exact album scrobbled, so use
  // it directly (external search mis-matches bollywood albums badly). Also
  // dedupe near-identical entries like "Rockstar" vs "Rockstar (OST)".
  const seenAl = new Set(), albums = [];
  for (const a of (albumsR && albumsR.topalbums && albumsR.topalbums.album) || []) {
    const artist = artistName(a.artist);
    if (isExcluded(artist)) continue;
    // dedupe by title only, a bollywood OST shows up credited to both the
    // singer and the composer, and as base + "(Original Motion Picture...)".
    const key = a.name.toLowerCase().replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    if (seenAl.has(key)) continue;
    seenAl.add(key);
    const img = Array.isArray(a.image) && a.image.length ? a.image[a.image.length - 1]["#text"] : "";
    albums.push({ name: a.name, artist, plays: +a.playcount || 0, art: img || null, url: a.url || "https://www.last.fm/music/" + encodeURIComponent(artist) });
    if (albums.length >= 10) break;
  }

  const tracks = await Promise.all(((tracksR && tracksR.toptracks && tracksR.toptracks.track) || [])
    .filter((t) => t && !isExcluded(artistName(t.artist)))
    .map(async (t) => {
    const artist = artistName(t.artist);
    const [it, sp] = await Promise.all([itunes(artist + " " + t.name, "song", 300), spotifyTrack(token, t.name, artist)]);
    return { title: t.name, artist, plays: +t.playcount || 0, art: sp.art || it.art, preview: it.preview || null, spotify: sp.url || "https://open.spotify.com/search/" + encodeURIComponent(t.name + " " + artist) };
  }));

  const recentRaw = ((recentR && recentR.recenttracks && recentR.recenttracks.track) || []).filter((t) => t && !isExcluded(artistName(t.artist))).slice(0, 8);
  const recent = await Promise.all(recentRaw.map(async (t) => {
    const artist = artistName(t.artist);
    const it = await itunes(artist + " " + t.name, "song", 100);
    return { title: t.name, artist, art: it.art, nowplaying: !!(t["@attr"] && t["@attr"].nowplaying), when: (t.date && t.date["#text"]) || null, url: t.url };
  }));

  res.end(JSON.stringify({
    user: { name: info.user.name, scrobbles: +info.user.playcount || 0, artists: +info.user.artist_count || 0, albums: +info.user.album_count || 0, tracks: +info.user.track_count || 0, registered: info.user.registered && info.user.registered.unixtime ? +info.user.registered.unixtime : null, url: info.user.url },
    period, artists, albums, tracks, recent,
  }));
};
