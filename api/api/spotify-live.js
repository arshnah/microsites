// Real-time Spotify playback via Discord's Rich Presence (through Lanyard),
// not Last.fm — Last.fm scrobbles are polled/delayed and carry no exact
// timestamp, so they can't drive synced lyrics. Discord's Spotify activity
// carries `timestamps.start`/`end` in real epoch ms, which is exactly what a
// karaoke-style lyrics view needs. Same id/host fallback as discord-status.js.
//
// Lyrics lookup lives in this same route (behind ?lyrics=1) rather than its
// own endpoint — this project is at its Hobby-plan cap of 12 Serverless
// Functions, so a second route isn't free here.

const { fetchLyrics } = require("./_lyrics");

const IDS = (process.env.DISCORD_IDS || "1352866897900732446,300137175238836225")
  .split(",").map((s) => s.trim()).filter(Boolean);

const LANYARD_HOSTS = ["https://larpyard.arshnah.in", "https://api.lanyard.rest"];

async function fetchPresence(id) {
  for (const host of LANYARD_HOSTS) {
    const r = await fetch(host + "/v1/users/" + id).then((r) => r.json()).catch(() => null);
    if (r && r.success && r.data) return r.data;
  }
  return null;
}

async function spotifyNow() {
  const results = await Promise.all(IDS.map(fetchPresence));
  // first id with an active Spotify session wins — there's only ever one
  // real listener across the accounts this tracks.
  const withSpotify = results.find((d) => d && d.listening_to_spotify && d.spotify);
  if (!withSpotify) return { playing: false };

  const sp = withSpotify.spotify;
  const start = sp.timestamps && sp.timestamps.start;
  const end = sp.timestamps && sp.timestamps.end;
  if (!sp.song || !start) return { playing: false };

  return {
    playing: true,
    title: sp.song,
    artist: sp.artist || "",
    album: sp.album || "",
    trackId: sp.track_id || null,
    albumArt: sp.album_art_url || null,
    startMs: start,
    endMs: end || null,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const q = new URL(req.url, "http://x").searchParams;

  if (q.get("lyrics") === "1") {
    // lyrics for a given track never change — cache this shape hard. The
    // query string (track+artist+album+duration) is the cache key, so every
    // future caller for the same track hits the edge cache, not lrclib.
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400");
    const track = (q.get("track") || "").trim();
    const artist = (q.get("artist") || "").trim();
    const album = (q.get("album") || "").trim();
    const duration = Number(q.get("duration") || "") || null;
    try {
      return res.end(JSON.stringify(await fetchLyrics(track, artist, album, duration)));
    } catch (e) {
      return res.end(JSON.stringify({ found: false }));
    }
  }

  // short cache — this is what drives a live-updating UI
  res.setHeader("Cache-Control", "public, max-age=3, s-maxage=3, stale-while-revalidate=8");
  res.statusCode = 200;
  try {
    res.end(JSON.stringify(await spotifyNow()));
  } catch (e) {
    res.end(JSON.stringify({ playing: false }));
  }
};
