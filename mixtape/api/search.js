// Spotify track search, client-credentials (no user login needed). Powers the
// "add a song" box: search as you type, pick a result, it gets added to the
// tape. Same token pattern as wrapped/playlist's music endpoints.

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

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");

  const q = new URL(req.url, "http://x").searchParams;
  const query = (q.get("q") || "").trim();
  if (!query) return res.end(JSON.stringify({ results: [] }));

  const token = await spotifyToken();
  if (!token) return res.end(JSON.stringify({ results: [] }));

  try {
    const r = await (await fetch("https://api.spotify.com/v1/search?type=track&limit=8&q=" + encodeURIComponent(query), {
      headers: { Authorization: "Bearer " + token },
    })).json();
    const items = (r && r.tracks && r.tracks.items) || [];
    const results = items.map((t) => {
      const imgs = (t.album && t.album.images) || [];
      const art = imgs.length ? (imgs[1] || imgs[0]).url : null;
      return {
        title: t.name,
        artist: (t.artists || []).map((a) => a.name).join(", "),
        art,
        spotifyUrl: (t.external_urls && t.external_urls.spotify) || null,
      };
    });
    res.end(JSON.stringify({ results }));
  } catch (e) {
    res.end(JSON.stringify({ results: [] }));
  }
};
