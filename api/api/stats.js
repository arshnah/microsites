// Last.fm dashboard, merged across all accounts (usernames()): summed totals,
// merged top artists/albums/tracks (by playcount) and recent (by time), with
// excluded artists dropped. ?user=NAME forces a single account; ?period=...
// (7day|1month|3month|6month|12month|overall, default overall).

const { usernames, isExcluded } = require("./_lastfm");

const artistName = (a) => (a && (a.name || a["#text"])) || "";

async function lfm(user, method, extra) {
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

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400");
  res.statusCode = 200;

  const q = new URL(req.url, "http://x").searchParams;
  const valid = ["7day", "1month", "3month", "6month", "12month", "overall"];
  const period = valid.includes(q.get("period")) ? q.get("period") : "overall";
  const forced = (q.get("user") || "").trim();
  const users = forced ? [forced] : usernames();
  if (!users.length) return res.end(JSON.stringify({ error: "no username" }));

  const per = await Promise.all(users.map(async (u) => {
    const [info, ar, al, tr, rc] = await Promise.all([
      lfm(u, "user.getinfo"),
      lfm(u, "user.gettopartists", "&period=" + period + "&limit=30"),
      lfm(u, "user.gettopalbums", "&period=" + period + "&limit=30"),
      lfm(u, "user.gettoptracks", "&period=" + period + "&limit=30"),
      lfm(u, "user.getrecenttracks", "&limit=12"),
    ]);
    return { info, ar, al, tr, rc };
  }));

  let scrobbles = 0, artistsC = 0, albumsC = 0, tracksC = 0, since = null;
  const names = [];
  let anyUrl = null;
  for (const p of per) {
    const u = p.info && p.info.user;
    if (!u) continue;
    scrobbles += +u.playcount || 0; artistsC += +u.artist_count || 0; albumsC += +u.album_count || 0; tracksC += +u.track_count || 0;
    const reg = u.registered && +u.registered.unixtime;
    if (reg && (!since || reg < since)) since = reg;
    names.push(u.name); anyUrl = anyUrl || u.url;
  }

  const aMap = new Map();
  for (const p of per) for (const a of (p.ar && p.ar.topartists && p.ar.topartists.artist) || []) {
    if (!a || !a.name || isExcluded(a.name)) continue;
    aMap.set(a.name, (aMap.get(a.name) || 0) + (+a.playcount || 0));
  }
  const topA = [...aMap.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);

  const alMap = new Map();
  for (const p of per) for (const a of (p.al && p.al.topalbums && p.al.topalbums.album) || []) {
    const artist = artistName(a.artist);
    if (isExcluded(artist)) continue;
    const key = a.name.toLowerCase().replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    const img = Array.isArray(a.image) && a.image.length ? a.image[a.image.length - 1]["#text"] : "";
    const cur = alMap.get(key) || { name: a.name, artist, plays: 0, art: img || null, url: a.url || "https://www.last.fm/music/" + encodeURIComponent(artist) };
    cur.plays += +a.playcount || 0; if (!cur.art && img) cur.art = img;
    alMap.set(key, cur);
  }
  const albumsMerged = [...alMap.values()].sort((x, y) => y.plays - x.plays).slice(0, 10);

  const tMap = new Map();
  for (const p of per) for (const t of (p.tr && p.tr.toptracks && p.tr.toptracks.track) || []) {
    const artist = artistName(t.artist);
    if (isExcluded(artist)) continue;
    const key = (t.name + "|" + artist).toLowerCase();
    const cur = tMap.get(key) || { title: t.name, artist, plays: 0 };
    cur.plays += +t.playcount || 0; tMap.set(key, cur);
  }
  const topT = [...tMap.values()].sort((x, y) => y.plays - x.plays).slice(0, 8);

  const recentAll = [];
  for (const p of per) for (const t of (p.rc && p.rc.recenttracks && p.rc.recenttracks.track) || []) {
    const artist = artistName(t.artist);
    if (isExcluded(artist)) continue;
    recentAll.push({ title: t.name, artist, nowplaying: !!(t["@attr"] && t["@attr"].nowplaying), uts: t.date && t.date.uts ? +t.date.uts : Math.floor(Date.now() / 1000), when: (t.date && t.date["#text"]) || null, url: t.url });
  }
  recentAll.sort((a, b) => b.uts - a.uts);

  const token = await spotifyToken();
  const artists = await Promise.all(topA.map(async ([n, plays]) => ({ name: n, plays, image: await artistImage(token, n) })));
  const tracks = await Promise.all(topT.map(async (t) => {
    const [it, sp] = await Promise.all([itunes(t.artist + " " + t.title, "song", 300), spotifyTrack(token, t.title, t.artist)]);
    return { title: t.title, artist: t.artist, plays: t.plays, art: sp.art || it.art, preview: it.preview || null, spotify: sp.url || "https://open.spotify.com/search/" + encodeURIComponent(t.title + " " + t.artist) };
  }));
  const recent = await Promise.all(recentAll.slice(0, 8).map(async (t) => {
    const it = await itunes(t.artist + " " + t.title, "song", 100);
    return { title: t.title, artist: t.artist, art: it.art, nowplaying: t.nowplaying, when: t.when, url: t.url };
  }));

  res.end(JSON.stringify({
    user: { name: names.join(" + "), scrobbles, artists: artistsC, albums: albumsC, tracks: tracksC, registered: since, url: anyUrl },
    period, artists, albums: albumsMerged, tracks, recent,
  }));
};
