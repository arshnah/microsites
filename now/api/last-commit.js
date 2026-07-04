// JSON feed of arshnah's most recent public push, fetched server-side so the
// browser never hits GitHub directly (unauthenticated browser calls get rate
// limited and the user-events feed omits the commits list — only the head sha
// is present). Authenticated with GITHUB_TOKEN and resolved via the head sha.

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

  const ev = await (await fetch("https://api.github.com/users/" + GH_USER + "/events/public?per_page=30", { headers })).json();
  const push = Array.isArray(ev) ? ev.find((e) => e.type === "PushEvent" && e.payload && e.payload.head && e.repo) : null;
  if (!push) return { ok: false };

  let message = "pushed";
  try {
    const cj = await (await fetch("https://api.github.com/repos/" + push.repo.name + "/commits/" + push.payload.head, { headers })).json();
    if (cj && cj.commit && cj.commit.message) message = cj.commit.message.split("\n")[0].toLowerCase();
  } catch (e) {}

  return {
    ok: true,
    message,
    repo: push.repo.name,
    ago: ago(push.created_at),
    url: "https://github.com/" + push.repo.name + "/commit/" + push.payload.head,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=120, s-maxage=120, stale-while-revalidate=600");
  try {
    res.statusCode = 200;
    res.end(JSON.stringify(await getCommit()));
  } catch (e) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false }));
  }
};
