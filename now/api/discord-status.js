// Discord presence via Lanyard. Lanyard only tracks accounts that joined
// discord.gg/lanyard, so we query every id and surface the best presence
// (the primary id 1352… is not in the server; 300137175238836225 is).

const IDS = (process.env.DISCORD_IDS || "1352866897900732446,300137175238836225")
  .split(",").map((s) => s.trim()).filter(Boolean);

const rank = (s) => (s === "online" ? 4 : s === "idle" ? 3 : s === "dnd" ? 2 : 1);

async function best() {
  const results = await Promise.all(
    IDS.map((id) => fetch("https://api.lanyard.rest/v1/users/" + id).then((r) => r.json()).catch(() => null))
  );
  const presences = results.filter((r) => r && r.success && r.data).map((r) => r.data);
  if (!presences.length) return { status: "offline", activity: null };
  const b = presences.sort((x, y) => rank(y.discord_status) - rank(x.discord_status))[0];
  // skip custom status (type 4) and spotify (type 2) — those are shown elsewhere
  const act = (b.activities || []).find((a) => a.type !== 4 && a.type !== 2);
  return {
    status: b.discord_status || "offline",
    activity: act ? { name: act.name, details: act.details || null } : null,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=15, s-maxage=15, stale-while-revalidate=60");
  res.statusCode = 200;
  try {
    res.end(JSON.stringify(await best()));
  } catch (e) {
    res.end(JSON.stringify({ status: "offline", activity: null }));
  }
};
