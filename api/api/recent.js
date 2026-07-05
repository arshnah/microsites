// Last.fm top artists over the last 7 days, the "on repeat this week" strip.
// Merged across all accounts (LASTFM_USERNAMES) with excluded artists removed.

const { topArtists } = require("./_lastfm");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600");
  res.statusCode = 200;
  if (!process.env.LASTFM_API_KEY) return res.end(JSON.stringify({ artists: [] }));
  const arts = await topArtists("7day", 15);
  res.end(JSON.stringify({ artists: arts.slice(0, 5).map((a) => a.name) }));
};
