// GitHub contribution counts (same source the portfolio heatmap uses). Returns
// a yearly total plus the full year of daily counts; consumers trim as needed
// (the now page shows the last ~17 weeks, portfolio shows the whole year).

const GH_USER = process.env.NEXT_PUBLIC_GITHUB_USER || "arshnah";

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=7200");
  res.statusCode = 200;
  try {
    const d = await (await fetch("https://github-contributions-api.jogruber.de/v4/" + GH_USER + "?y=last")).json();
    if (!Array.isArray(d.contributions)) return res.end(JSON.stringify({ ok: false }));
    const total =
      (d.total && (d.total.lastYear != null ? d.total.lastYear : Object.values(d.total)[0])) ||
      d.contributions.reduce((s, x) => s + x.count, 0);
    const days = d.contributions.map((x) => ({ date: x.date, count: x.count }));
    res.end(JSON.stringify({ ok: true, total, days }));
  } catch (e) {
    res.end(JSON.stringify({ ok: false }));
  }
};
