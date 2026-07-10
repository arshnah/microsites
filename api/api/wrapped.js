// A Last.fm "year in sound" for any username. ?user=NAME (defaults to the site's
// own listener). Pulls the last 12 months of top artists (with Spotify photos),
// top tracks (with iTunes covers + 30s previews), the top album, and lifetime
// totals. CORS-open so any front-end can build a wrapped from it.

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
  if (user.toLowerCase() === "arshnah") user = "arshnahbtw";
  if (!user) return res.end(JSON.stringify({ error: "no username" }));

  const info = await lastfm(user, "user.getinfo");
  if (!info || !info.user || info.error) return res.end(JSON.stringify({ error: "user not found" }));

  const [artistsR, tracksR, albumsR, token] = await Promise.all([
    lastfm(user, "user.gettopartists", "&period=12month&limit=5"),
    lastfm(user, "user.gettoptracks", "&period=12month&limit=5"),
    lastfm(user, "user.gettopalbums", "&period=12month&limit=1"),
    spotifyToken(),
  ]);

  const rawArtists = (artistsR && artistsR.topartists && artistsR.topartists.artist) || [];
  const topArtists = await Promise.all(rawArtists.map(async (a) => ({
    name: a.name, plays: +a.playcount || 0, image: await artistImage(token, a.name),
  })));

  const rawTracks = (tracksR && tracksR.toptracks && tracksR.toptracks.track || []).slice(0, 5);
  const topTracks = await Promise.all(rawTracks.map(async (t) => {
    const artist = (t.artist && (t.artist.name || t.artist["#text"])) || "";
    const it = await itunes(artist + " " + t.name, "song", 300);
    return { title: t.name, artist, plays: +t.playcount || 0, art: it.art, preview: it.preview || null };
  }));

  let topAlbum = null;
  const al = albumsR && albumsR.topalbums && albumsR.topalbums.album && albumsR.topalbums.album[0];
  if (al) {
    const artist = (al.artist && (al.artist.name || al.artist["#text"])) || "";
    const img = Array.isArray(al.image) && al.image.length ? al.image[al.image.length - 1]["#text"] : "";
    const it = img ? {} : await itunes(artist + " " + al.name, "album", 600);
    topAlbum = { name: al.name, artist, plays: +al.playcount || 0, art: img || it.art || null };
  }

  res.end(JSON.stringify({
    user: { name: info.user.name, scrobbles: +info.user.playcount || 0, artists: +info.user.artist_count || 0, url: info.user.url },
    topArtists, topTracks, topAlbum,
  }));
};
