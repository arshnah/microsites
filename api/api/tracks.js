// Top tracks from Last.fm for the playlist page. ?period=7day|1month|3month|
// 6month|12month|overall (default 1month), ?limit=N (default 24). Returns title,
// artist, play count, url, and album art.

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
    const tracks = arr.map((t) => {
      const img = Array.isArray(t.image) && t.image.length ? t.image[t.image.length - 1]["#text"] : "";
      return { title: t.name, artist: (t.artist && (t.artist.name || t.artist["#text"])) || "", plays: +t.playcount || 0, url: t.url, art: img || null };
    });
    res.end(JSON.stringify({ period, tracks }));
  } catch (e) {
    res.end(JSON.stringify({ tracks: [] }));
  }
};
