// Last-commit timestamp per arshnah.in microsite, read from this repo's own
// path history. Same GITHUB_TOKEN pattern as last-commit.js — unauthenticated
// calls hit GitHub's 60/hr limit fast across 13 paths in one request.

const REPO = "arshnah/microsites";
const PROJECTS = [
  "api", "buttons", "card", "chud", "now", "playlist",
  "scratch", "shame", "slop", "status", "uses", "wish", "wrapped",
];

async function lastCommitDate(path, headers) {
  const url = "https://api.github.com/repos/" + REPO + "/commits?path=" + path + "&per_page=1";
  try {
    const arr = await (await fetch(url, { headers })).json();
    const c = Array.isArray(arr) && arr[0];
    if (!c || !c.commit) return null;
    return c.commit.committer.date || c.commit.author.date;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=21600");

  const headers = { "User-Agent": "orbit.arshnah.in", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;

  try {
    const nodes = await Promise.all(
      PROJECTS.map(async (name) => ({
        name,
        url: "https://" + name + ".arshnah.in",
        lastCommitAt: await lastCommitDate(name, headers),
      }))
    );
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, nodes }));
  } catch (e) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, nodes: [] }));
  }
};
