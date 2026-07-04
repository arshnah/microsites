// Top tracks from Last.fm for the playlist page. ?period=7day|1month|3month|
// 6month|12month|overall (default 1month), ?limit=N (default 24). Returns title,
// artist, play count, url, and album art (from iTunes, since Last.fm serves a
// placeholder "star" for most tracks).

const STAR = "2a96cbd8b46e442fc41c2b86b821562f"; // last.fm no-cover placeholder hash

async function itunesInfo(title, artist) {
  try {
    const r = await (await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent((artist + " " + title).trim()) + "&entity=song&limit=1")).json();
    const x = r && r.results && r.results[0];
    if (!x) return {};
    return { art: x.artworkUrl100 ? x.artworkUrl100.replace("100x100bb", "300x300bb") : null, preview: x.previewUrl || null };
  } catch (e) { return {}; }
}

// Spotify client-credentials flow (no user login) — just to resolve each track
// to its real open.spotify.com link so tapping opens the actual song.
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

async function spotifyUrl(token, title, artist) {
  if (!token) return null;
  try {
    const r = await (await fetch(
      "https://api.spotify.com/v1/search?type=track&limit=1&q=" + encodeURIComponent(title + " " + artist),
      { headers: { Authorization: "Bearer " + token } }
    )).json();
    const t = r && r.tracks && r.tracks.items && r.tracks.items[0];
    return (t && t.external_urls && t.external_urls.spotify) || null;
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600");
  res.statusCode = 200;

  const key = process.env.LASTFM_API_KEY, user = process.env.LASTFM_USERNAME;
  if (!key || !user) return res.end(JSON.stringify({ tracks: [] }));

  const q = new URL(req.url, "http://x").searchParams;
  const valid = ["7day", "1month", "3month", "6month", "12month", "overall"];
  const period = valid.includes(q.get("period")) ? q.get("period") : "1month";
  const limit = Math.min(50, Math.max(1, parseInt(q.get("limit"), 10) || 24));

  try {
    const r = await (await fetch(
      "https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=" + encodeURIComponent(user) +
      "&period=" + period + "&limit=" + limit + "&api_key=" + encodeURIComponent(key) + "&format=json"
    )).json();
    const arr = (r && r.toptracks && r.toptracks.track) || [];
    const token = await spotifyToken();
    const tracks = await Promise.all(arr.map(async (t) => {
      const artist = (t.artist && (t.artist.name || t.artist["#text"])) || "";
      const lf = Array.isArray(t.image) && t.image.length ? t.image[t.image.length - 1]["#text"] : "";
      const [it, sp] = await Promise.all([itunesInfo(t.name, artist), spotifyUrl(token, t.name, artist)]);
      const art = it.art || (lf && lf.indexOf(STAR) < 0 ? lf : null);
      return {
        title: t.name, artist, plays: +t.playcount || 0, url: t.url, art,
        preview: it.preview || null,
        spotify: sp || "https://open.spotify.com/search/" + encodeURIComponent(t.name + " " + artist),
      };
    }));
    res.end(JSON.stringify({ period, tracks }));
  } catch (e) {
    res.end(JSON.stringify({ tracks: [] }));
  }
};
