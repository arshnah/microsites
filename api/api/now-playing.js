// What arshnah is listening to, merged across the Last.fm accounts in
// LASTFM_USERNAMES (priority order; first wins "now playing" ties). Excluded
// artists (see _lastfm) are skipped, so a devotional track that auto-runs never
// shows as the status; the last real song shows as "last played" instead.

const { usernames, isExcluded, artistOf, lfm } = require("./_lastfm");

async function trackFor(user, priority) {
  const r = await lfm("method=user.getrecenttracks&user=" + encodeURIComponent(user) + "&limit=5");
  const arr = (r && r.recenttracks && r.recenttracks.track) || [];
  const t = arr.find((x) => x && x.name && !isExcluded(artistOf(x.artist)));
  if (!t) return null;
  const img = Array.isArray(t.image) && t.image.length ? t.image[t.image.length - 1]["#text"] : "";
  return {
    priority,
    isPlaying: !!(t["@attr"] && t["@attr"].nowplaying === "true"),
    uts: t.date && t.date.uts ? Number(t.date.uts) : 0,
    title: t.name || "",
    artist: artistOf(t.artist),
    url: t.url || "",
    albumArt: img || null,
  };
}

async function nowPlaying() {
  const list = usernames();
  if (!process.env.LASTFM_API_KEY || !list.length) return { isPlaying: false };
  const results = (await Promise.all(list.map((u, i) => trackFor(u, i)))).filter(Boolean);
  if (!results.length) return { isPlaying: false };
  const playing = results.filter((r) => r.isPlaying);
  const pick = playing.length
    ? playing.sort((a, b) => a.priority - b.priority)[0] // playing now; first-listed account wins
    : results.sort((a, b) => b.uts - a.uts)[0]; // else most recent scrobble across accounts
  return { isPlaying: pick.isPlaying, title: pick.title, artist: pick.artist, url: pick.url, albumArt: pick.albumArt };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=30, stale-while-revalidate=120");
  res.statusCode = 200;
  res.end(JSON.stringify(await nowPlaying()));
};
