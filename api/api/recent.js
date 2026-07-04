// Last.fm top artists over the last 7 days — the "on repeat this week" strip.

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600");
  res.statusCode = 200;
  const key = process.env.LASTFM_API_KEY, user = process.env.LASTFM_USERNAME;
  if (!key || !user) return res.end(JSON.stringify({ artists: [] }));
  try {
    const r = await (await fetch(
      "https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=" +
        encodeURIComponent(user) + "&period=7day&limit=5&api_key=" + encodeURIComponent(key) + "&format=json"
    )).json();
    const arr = (r && r.topartists && r.topartists.artist) || [];
    res.end(JSON.stringify({ artists: arr.map((a) => a.name).filter(Boolean).slice(0, 5) }));
  } catch (e) {
    res.end(JSON.stringify({ artists: [] }));
  }
};
