// Aggregated year-in-review: last-12-months music (last.fm), this year's github
// contributions + most-active repo, and coding time if wakatime has it. One
// fetch for the wrapped page. Everything is best-effort; missing bits come back
// null so the page can skip them.

const GH_USER = "arshnah";

async function lastfm(method, extra) {
  const key = process.env.LASTFM_API_KEY, user = process.env.LASTFM_USERNAME;
  if (!key || !user) return null;
  const url =
    "https://ws.audioscrobbler.com/2.0/?method=" + method + "&user=" + encodeURIComponent(user) +
    "&api_key=" + encodeURIComponent(key) + "&format=json" + (extra || "");
  try { return await (await fetch(url)).json(); } catch (e) { return null; }
}

function artName(a) { return a && a.name; }
function trackObj(t) {
  const img = Array.isArray(t.image) && t.image.length ? t.image[t.image.length - 1]["#text"] : "";
  return { title: t.name, artist: (t.artist && (t.artist.name || t.artist["#text"])) || "", plays: +t.playcount || 0, url: t.url, art: img || null };
}

async function github() {
  const headers = { "User-Agent": "wrapped.arshnah.in", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
  let contributions = null, topRepo = null;
  try {
    const d = await (await fetch("https://github-contributions-api.jogruber.de/v4/" + GH_USER + "?y=last")).json();
    if (d && d.total) contributions = d.total.lastYear != null ? d.total.lastYear : Object.values(d.total)[0];
  } catch (e) {}
  try {
    const ev = await (await fetch("https://api.github.com/users/" + GH_USER + "/events/public?per_page=100", { headers })).json();
    if (Array.isArray(ev)) {
      const tally = {};
      for (const e of ev) if (e.type === "PushEvent" && e.repo) tally[e.repo.name] = (tally[e.repo.name] || 0) + ((e.payload && e.payload.size) || 1);
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      if (top) topRepo = { name: top[0], pushes: top[1] };
    }
  } catch (e) {}
  return { contributions, topRepo };
}

async function coding() {
  const key = process.env.WAKATIME_API_KEY;
  if (!key) return null;
  try {
    const auth = Buffer.from(key).toString("base64");
    const r = await (await fetch("https://wakatime.com/api/v1/users/current/stats/last_year", { headers: { Authorization: "Basic " + auth } })).json();
    const t = r && r.data && r.data.human_readable_total;
    return t && t !== "0 secs" ? t : null;
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400");
  res.statusCode = 200;

  const [artistsR, tracksR, infoR, gh, hours] = await Promise.all([
    lastfm("user.gettopartists", "&period=12month&limit=5"),
    lastfm("user.gettoptracks", "&period=12month&limit=5"),
    lastfm("user.getinfo"),
    github(),
    coding(),
  ]);

  const topArtists = (artistsR && artistsR.topartists && artistsR.topartists.artist || []).map(artName).filter(Boolean).slice(0, 5);
  const topTracks = (tracksR && tracksR.toptracks && tracksR.toptracks.track || []).map(trackObj).slice(0, 5);
  const scrobbles = infoR && infoR.user && +infoR.user.playcount || null;

  res.end(JSON.stringify({
    music: { topArtists, topTracks, scrobbles },
    code: { contributions: gh.contributions, topRepo: gh.topRepo, hours },
  }));
};
