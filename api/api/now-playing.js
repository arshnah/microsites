// What arshnah is listening to, from Last.fm (server-side so the api key stays
// off the client). Mirrors the portfolio's now-playing feed. Returns the most
// recent scrobble and whether it is playing right now.

async function lastfm() {
  const key = process.env.LASTFM_API_KEY;
  const user = process.env.LASTFM_USERNAME;
  if (!key || !user) return { isPlaying: false };
  try {
    const r = await fetch(
      "https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=" +
        encodeURIComponent(user) + "&api_key=" + encodeURIComponent(key) + "&format=json&limit=1",
      { cache: "no-store" }
    ).then((r) => r.json());
    const t = r && r.recenttracks && r.recenttracks.track && r.recenttracks.track[0];
    if (!t) return { isPlaying: false };
    const img = Array.isArray(t.image) && t.image.length ? t.image[t.image.length - 1]["#text"] : "";
    return {
      isPlaying: t["@attr"] && t["@attr"].nowplaying === "true",
      title: t.name || "",
      artist: (t.artist && t.artist["#text"]) || "",
      url: t.url || "",
      albumArt: img || null,
    };
  } catch (e) {
    return { isPlaying: false };
  }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=30, stale-while-revalidate=120");
  res.statusCode = 200;
  res.end(JSON.stringify(await lastfm()));
};
