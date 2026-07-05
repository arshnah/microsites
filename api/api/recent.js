// Last.fm top artists over the last 7 days, the "on repeat this week" strip.
// Merged across one or more accounts (LASTFM_USERNAMES, comma-separated; falls
// back to LASTFM_USERNAME): playcounts are summed per artist, then the top 5.

function users() {
  return (process.env.LASTFM_USERNAMES || process.env.LASTFM_USERNAME || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600");
  res.statusCode = 200;

  const key = process.env.LASTFM_API_KEY, list = users();
  if (!key || !list.length) return res.end(JSON.stringify({ artists: [] }));

  try {
    const per = await Promise.all(
      list.map(async (user) => {
        const r = await (await fetch(
          "https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=" +
            encodeURIComponent(user) + "&period=7day&limit=10&api_key=" + encodeURIComponent(key) + "&format=json"
        )).json();
        return (r && r.topartists && r.topartists.artist) || [];
      })
    );

    const totals = new Map();
    for (const a of per.flat()) {
      const name = a && a.name;
      if (!name) continue;
      totals.set(name, (totals.get(name) || 0) + (Number(a.playcount) || 0));
    }

    const artists = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 5);
    res.end(JSON.stringify({ artists }));
  } catch (e) {
    res.end(JSON.stringify({ artists: [] }));
  }
};
