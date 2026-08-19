// JSON feed of arshnah's most recent public commit, fetched server-side so the
// browser never hits GitHub directly (unauthenticated browser calls get rate
// limited). Uses the repos-sorted-by-pushed + commits endpoints rather than
// /events/public — the events feed can lag by 30+ minutes or drop rapid
// consecutive pushes entirely, while this reflects the true latest push.

const GH_USER = "arshnah";

function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

async function getCommit() {
  const headers = { "User-Agent": "now.arshnah.in", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;

  const repos = await (await fetch("https://api.github.com/users/" + GH_USER + "/repos?sort=pushed&per_page=1", { headers })).json();
  const repo = Array.isArray(repos) ? repos[0] : null;
  if (!repo) return { ok: false };

  const commits = await (await fetch("https://api.github.com/repos/" + repo.full_name + "/commits?per_page=1", { headers })).json();
  const commit = Array.isArray(commits) ? commits[0] : null;
  if (!commit) return { ok: false };

  const message = commit.commit && commit.commit.message ? commit.commit.message.split("\n")[0].toLowerCase() : "pushed";
  const when = (commit.commit && commit.commit.committer && commit.commit.committer.date) || repo.pushed_at;

  return {
    ok: true,
    message,
    repo: repo.full_name,
    ago: ago(when),
    url: "https://github.com/" + repo.full_name + "/commit/" + commit.sha,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=120, s-maxage=120, stale-while-revalidate=600");
  try {
    res.statusCode = 200;
    res.end(JSON.stringify(await getCommit()));
  } catch (e) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false }));
  }
};
