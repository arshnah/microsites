// Last-commit timestamp for every project on arshnah.in — the ones that live
// as paths inside this repo, plus the standalone repos deployed elsewhere.
// Same GITHUB_TOKEN pattern as last-commit.js — unauthenticated calls hit
// GitHub's 60/hr limit fast across 20 lookups in one request.

const REPO = "arshnah/microsites";
const PROJECTS = [
  "api", "buttons", "card", "chud", "now", "orbit", "playlist",
  "scratch", "shame", "slop", "status", "uses", "wrapped",
];

// standalone repos, not paths inside microsites — name/url come from the
// project itself, not a folder convention, since there's no shared pattern
const EXTRA = [
  { name: "portfolio", repo: "arshnah/portfolio-next", url: "https://www.arshnah.in" },
  { name: "lastly", repo: "arshnah/lastly", url: "https://lastly.arshnah.in" },
  { name: "lanyard", repo: "arshnah/lanyard-profile-readme", url: "https://lanyard.arshnah.in" },
  { name: "wisp", repo: "arshnah/wisp", url: "https://chat.arshnah.in" },
  { name: "larp", repo: "arshnah/larp", url: "https://larp.arshnah.in" },
  { name: "banner", repo: "arshnah/random-banner", url: "https://banner.arshnah.in" },
  { name: "larpring", repo: "larpring/larpring.github.io", url: "https://ring.arshnah.in" },
];

async function lastCommitDate(repo, path, headers) {
  const url = "https://api.github.com/repos/" + repo + "/commits?per_page=1" + (path ? "&path=" + path : "");
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
    const microsites = PROJECTS.map(async (name) => ({
      name,
      url: "https://" + name + ".arshnah.in",
      lastCommitAt: await lastCommitDate(REPO, name, headers),
    }));
    const extra = EXTRA.map(async (e) => ({
      name: e.name,
      url: e.url,
      lastCommitAt: await lastCommitDate(e.repo, null, headers),
    }));
    const nodes = await Promise.all([...microsites, ...extra]);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, nodes }));
  } catch (e) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, nodes: [] }));
  }
};
