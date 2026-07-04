// Today's coding time + top language from WakaTime. Deliberately does NOT
// expose the editor/IDE, AI category, projects, or machines that WakaTime also
// tracks — only duration and language. Needs WAKATIME_API_KEY; else { ok:false }.

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600, stale-while-revalidate=1800");
  res.statusCode = 200;
  const key = process.env.WAKATIME_API_KEY;
  if (!key) return res.end(JSON.stringify({ ok: false }));
  try {
    const auth = Buffer.from(key).toString("base64");
    const r = await (await fetch("https://wakatime.com/api/v1/users/current/summaries?range=Today", {
      headers: { Authorization: "Basic " + auth },
    })).json();
    const d = r && r.data && r.data[0];
    const text = d && d.grand_total && d.grand_total.text;
    if (!text || text === "0 secs") return res.end(JSON.stringify({ ok: false }));
    const language = (d.languages && d.languages[0] && d.languages[0].name) || null;
    res.end(JSON.stringify({ ok: true, text, language }));
  } catch (e) {
    res.end(JSON.stringify({ ok: false }));
  }
};
