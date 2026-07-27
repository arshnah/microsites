// Coding time + top language from WakaTime. Deliberately does NOT expose the
// editor/IDE, AI category, projects, or machines that WakaTime also tracks —
// only duration and language. Needs WAKATIME_API_KEY; else { ok:false }.
//
// Reports today when there is time on the clock, otherwise falls back to the
// trailing week, so the row doesn't vanish every morning before the first
// commit. `range` says which one you got.

const human = (secs) => {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (!h && !m) return null;
  const hrs = h ? h + " hr" + (h === 1 ? "" : "s") : "";
  const min = m ? m + " min" + (m === 1 ? "" : "s") : "";
  return [hrs, min].filter(Boolean).join(" ");
};

const topLanguage = (langs) => {
  let best = null;
  for (const [name, secs] of Object.entries(langs)) {
    if (!best || secs > best[1]) best = [name, secs];
  }
  return best ? best[0] : null;
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600, stale-while-revalidate=1800");
  res.statusCode = 200;
  const key = process.env.WAKATIME_API_KEY;
  if (!key) return res.end(JSON.stringify({ ok: false }));
  try {
    const auth = Buffer.from(key).toString("base64");
    const r = await (await fetch("https://wakatime.com/api/v1/users/current/summaries?range=Last%207%20Days", {
      headers: { Authorization: "Basic " + auth },
    })).json();

    const days = (r && r.data) || [];
    if (!days.length) return res.end(JSON.stringify({ ok: false }));

    // summaries come back oldest first, so today is the tail
    const today = days[days.length - 1];
    const todaySecs = (today && today.grand_total && today.grand_total.total_seconds) || 0;

    if (todaySecs > 0) {
      const language = (today.languages && today.languages[0] && today.languages[0].name) || null;
      return res.end(JSON.stringify({ ok: true, text: human(todaySecs), language, range: "today" }));
    }

    const weekSecs = days.reduce((sum, d) => sum + ((d.grand_total && d.grand_total.total_seconds) || 0), 0);
    if (weekSecs <= 0) return res.end(JSON.stringify({ ok: false }));

    const langs = {};
    for (const d of days) {
      for (const l of d.languages || []) langs[l.name] = (langs[l.name] || 0) + l.total_seconds;
    }
    res.end(JSON.stringify({ ok: true, text: human(weekSecs), language: topLanguage(langs), range: "week" }));
  } catch (e) {
    res.end(JSON.stringify({ ok: false }));
  }
};
