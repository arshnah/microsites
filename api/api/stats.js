// A full Last.fm dashboard for a user: lifetime totals, top artists (with
// Spotify photos), top albums + top tracks (iTunes art), and recent plays.
// ?user=NAME&period=7day|1month|3month|6month|12month|overall (default overall).

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
  const user = (q.get("user") || process.env.LASTFM_USERNAME || "").trim();
  const valid = ["7day", "1month", "3month", "6month", "12month", "overall"];
  const period = valid.includes(q.get("period")) ? q.get("period") : "overall";
  if (!user) return res.end(JSON.stringify({ error: "no username" }));

  const info = await lastfm(user, "user.getinfo");
  if (!info || !info.user || info.error) return res.end(JSON.stringify({ error: "user not found" }));

  const [artistsR, albumsR, tracksR, recentR, token] = await Promise.all([
    lastfm(user, "user.gettopartists", "&period=" + period + "&limit=8"),
    lastfm(user, "user.gettopalbums", "&period=" + period + "&limit=8"),
    lastfm(user, "user.gettoptracks", "&period=" + period + "&limit=8"),
    lastfm(user, "user.getrecenttracks", "&limit=8"),
    spotifyToken(),
  ]);

  const artists = await Promise.all(((artistsR && artistsR.topartists && artistsR.topartists.artist) || []).map(async (a) => ({
    name: a.name, plays: +a.playcount || 0, image: await artistImage(token, a.name),
  })));

  const albums = await Promise.all(((albumsR && albumsR.topalbums && albumsR.topalbums.album) || []).map(async (a) => {
    const artist = artistName(a.artist);
    const it = await itunes(artist + " " + a.name, "album", 300);
    return { name: a.name, artist, plays: +a.playcount || 0, art: it.art };
  }));

  const tracks = await Promise.all(((tracksR && tracksR.toptracks && tracksR.toptracks.track) || []).map(async (t) => {
    const artist = artistName(t.artist);
    const [it, sp] = await Promise.all([itunes(artist + " " + t.name, "song", 300), spotifyTrack(token, t.name, artist)]);
    return { title: t.name, artist, plays: +t.playcount || 0, art: it.art || sp.art, preview: it.preview || null, spotify: sp.url || "https://open.spotify.com/search/" + encodeURIComponent(t.name + " " + artist) };
  }));

  const recentRaw = ((recentR && recentR.recenttracks && recentR.recenttracks.track) || []).slice(0, 8);
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
