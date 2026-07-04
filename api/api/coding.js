// Today's coding TIME ONLY from WakaTime. Deliberately does not expose the
// language, editor/IDE, projects, or machines that WakaTime also tracks — just
// the total duration. Needs WAKATIME_API_KEY; without it returns { ok:false }.

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
    res.end(JSON.stringify({ ok: true, text }));
  } catch (e) {
    res.end(JSON.stringify({ ok: false }));
  }
};
