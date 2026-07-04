// Discord presence via Lanyard. Lanyard only tracks accounts that joined
// discord.gg/lanyard, so we query every id and surface the best presence
// (the primary id 1352… is not in the server; 300137175238836225 is).

const IDS = (process.env.DISCORD_IDS || "1352866897900732446,300137175238836225")
  .split(",").map((s) => s.trim()).filter(Boolean);

const rank = (s) => (s === "online" ? 4 : s === "idle" ? 3 : s === "dnd" ? 2 : 1);

// Turn a Lanyard asset hash into a real image url. See discord's activity-image
// docs: external images are proxied, spotify has its own cdn, everything else is
// an app asset keyed by application id.
function assetUrl(appId, hash) {
  if (!hash) return null;
  if (hash.indexOf("mp:") === 0) return "https://media.discordapp.net/" + hash.slice(3);
  if (hash.indexOf("spotify:") === 0) return "https://i.scdn.co/image/" + hash.slice(8);
  return "https://cdn.discordapp.com/app-assets/" + appId + "/" + hash + ".png";
}

async function best() {
  const results = await Promise.all(
    IDS.map((id) => fetch("https://api.lanyard.rest/v1/users/" + id).then((r) => r.json()).catch(() => null))
  );
  const presences = results.filter((r) => r && r.success && r.data).map((r) => r.data);
  if (!presences.length) return { status: "offline", custom: null, activity: null };

  const b = presences.sort((x, y) => rank(y.discord_status) - rank(x.discord_status))[0];
  const acts = b.activities || [];
  const custom = acts.find((a) => a.type === 4);
  const act = acts.find((a) => a.type !== 4 && a.type !== 2); // skip custom status + spotify

  let activity = null;
  if (act) {
    const as = act.assets || {};
    // rich-presence art first, then the small image, then the app's own icon
    const image =
      assetUrl(act.application_id, as.large_image) ||
      assetUrl(act.application_id, as.small_image) ||
      (act.application_id ? "https://dcdn.dstn.to/app-icons/" + act.application_id : null);
    activity = {
      name: act.name || null,
      details: act.details || null,
      state: act.state || null,
      image,
      start: (act.timestamps && act.timestamps.start) || null,
    };
  }

  return {
    status: b.discord_status || "offline",
    custom: (custom && custom.state) || null,
    activity,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=15, s-maxage=15, stale-while-revalidate=60");
  res.statusCode = 200;
  try {
    res.end(JSON.stringify(await best()));
  } catch (e) {
    res.end(JSON.stringify({ status: "offline", custom: null, activity: null }));
  }
};
