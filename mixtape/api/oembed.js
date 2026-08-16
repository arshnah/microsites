// Resolves a pasted YouTube link to {title, artist, art, url} via YouTube's
// public oEmbed endpoint (no API key needed). Powers "paste a YouTube link"
// as the second way to add a song, alongside Spotify search.

const YT_ID = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([a-zA-Z0-9_-]{11})/;

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");

  const q = new URL(req.url, "http://x").searchParams;
  const raw = (q.get("url") || "").trim();
  const m = raw.match(YT_ID);
  if (!m) { res.statusCode = 400; return res.end(JSON.stringify({ error: "not a youtube link" })); }
  const id = m[1];
  const watchUrl = "https://www.youtube.com/watch?v=" + id;

  try {
    const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(watchUrl));
    if (!r.ok) throw new Error("oembed failed");
    const j = await r.json();
    return res.end(JSON.stringify({
      title: j.title || "untitled",
      artist: j.author_name || "youtube",
      art: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg",
      url: watchUrl,
    }));
  } catch (e) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: "couldn't find that video" }));
  }
};
