// What arshnah is listening to, merged across one or more Last.fm accounts.
// Set LASTFM_USERNAMES to a comma-separated list (priority order); the first
// name wins ties for "now playing". Falls back to the single LASTFM_USERNAME.
// A track that is playing right now always beats a past scrobble; otherwise the
// most recently scrobbled track across the accounts shows as "last played".

function users() {
  return (process.env.LASTFM_USERNAMES || process.env.LASTFM_USERNAME || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function trackFor(user, key, priority) {
  try {
    const r = await fetch(
      "https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=" +
        encodeURIComponent(user) + "&api_key=" + encodeURIComponent(key) + "&format=json&limit=1",
      { cache: "no-store" }
    ).then((r) => r.json());
    const t = r && r.recenttracks && r.recenttracks.track && r.recenttracks.track[0];
    if (!t) return null;
    const img = Array.isArray(t.image) && t.image.length ? t.image[t.image.length - 1]["#text"] : "";
    return {
      priority,
      isPlaying: !!(t["@attr"] && t["@attr"].nowplaying === "true"),
      uts: t.date && t.date.uts ? Number(t.date.uts) : 0,
      title: t.name || "",
      artist: (t.artist && t.artist["#text"]) || "",
      url: t.url || "",
      albumArt: img || null,
    };
  } catch (e) {
    return null;
  }
}

async function lastfm() {
  const key = process.env.LASTFM_API_KEY;
  const list = users();
  if (!key || !list.length) return { isPlaying: false };

  const results = (await Promise.all(list.map((u, i) => trackFor(u, key, i)))).filter(Boolean);
  if (!results.length) return { isPlaying: false };

  const playing = results.filter((r) => r.isPlaying);
  const pick = playing.length
    ? playing.sort((a, b) => a.priority - b.priority)[0] // playing now; first-listed account wins
    : results.sort((a, b) => b.uts - a.uts)[0]; // else the most recent scrobble

  return { isPlaying: pick.isPlaying, title: pick.title, artist: pick.artist, url: pick.url, albumArt: pick.albumArt };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=30, stale-while-revalidate=120");
  res.statusCode = 200;
  res.end(JSON.stringify(await lastfm()));
};
