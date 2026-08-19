const GH_USER = process.env.NEXT_PUBLIC_GITHUB_USER || "arshnah";

const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

async function fromGraphQL() {
  if (!process.env.GITHUB_TOKEN) return null;
  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  from.setUTCDate(from.getUTCDate() + 1);

  const query = `query($login:String!,$from:DateTime!,$to:DateTime!){
    user(login:$login){
      contributionsCollection(from:$from, to:$to){
        contributionCalendar{
          totalContributions
          weeks{ contributionDays{ date contributionCount contributionLevel } }
        }
      }
    }
  }`;

  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.GITHUB_TOKEN,
      "Content-Type": "application/json",
      "User-Agent": GH_USER + "-contributions",
    },
    body: JSON.stringify({ query, variables: { login: GH_USER, from: from.toISOString(), to: to.toISOString() } }),
  });
  const j = await r.json();
  const cal = j && j.data && j.data.user && j.data.user.contributionsCollection && j.data.user.contributionsCollection.contributionCalendar;
  if (!cal) return null;

  const days = cal.weeks.flatMap((w) =>
    w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount, level: LEVEL[d.contributionLevel] ?? 0 }))
  );
  return { total: cal.totalContributions, days };
}

async function fromScraper() {
  const d = await (await fetch("https://github-contributions-api.jogruber.de/v4/" + GH_USER + "?y=last")).json();
  if (!Array.isArray(d.contributions)) return null;
  const total =
    (d.total && (d.total.lastYear != null ? d.total.lastYear : Object.values(d.total)[0])) ||
    d.contributions.reduce((s, x) => s + x.count, 0);
  const days = d.contributions.map((x) => ({ date: x.date, count: x.count, level: x.level }));
  return { total, days };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=1800");
  res.statusCode = 200;
  try {
    const result = (await fromGraphQL().catch(() => null)) || (await fromScraper().catch(() => null));
    if (!result) return res.end(JSON.stringify({ ok: false }));
    res.end(JSON.stringify({ ok: true, total: result.total, days: result.days }));
  } catch (e) {
    res.end(JSON.stringify({ ok: false }));
  }
};
