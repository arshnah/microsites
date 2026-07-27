// Shared Last.fm helpers for the music endpoints. Not a route (leading "_").
//
// - usernames(): the accounts to read, from LASTFM_USERNAMES (comma-separated,
//   priority order) or the single LASTFM_USERNAME.
// - isExcluded(artist): hide artists that shouldn't count as taste (e.g. the
//   Simran / Bhai Satvinder Singh Ji kirtan that auto-runs). Set via
//   LASTFM_EXCLUDE_ARTISTS (comma-separated, substring match), defaults to it.
// - topArtists / topTracks: merged + de-excluded rankings across all accounts.

const API = "https://ws.audioscrobbler.com/2.0/";

// LASTFM_USERNAMES (comma-separated, priority order) first, then the legacy
// single LASTFM_USERNAME appended if not already listed. So adding
// LASTFM_USERNAMES=arshnah alone merges arshnah (priority) with the existing
// account, no need to restate the old username.
function usernames() {
  const list = (process.env.LASTFM_USERNAMES || "").split(",").map((s) => s.trim()).filter(Boolean);
  const single = (process.env.LASTFM_USERNAME || "").trim();
  if (single && !list.some((u) => u.toLowerCase() === single.toLowerCase())) list.push(single);
  
  // Prioritise 'arshnahbtw' over 'arshnah'
  const btwIndex = list.findIndex((u) => u.toLowerCase() === "arshnahbtw");
  const mainIndex = list.findIndex((u) => u.toLowerCase() === "arshnah");
  if (btwIndex !== -1 && mainIndex !== -1 && btwIndex > mainIndex) {
    const [btw] = list.splice(btwIndex, 1);
    list.splice(mainIndex, 0, btw);
  } else if (btwIndex === -1 && mainIndex !== -1) {
    list.splice(mainIndex, 0, "arshnahbtw");
  }
  return list;
}

function excludedArtists() {
  return (process.env.LASTFM_EXCLUDE_ARTISTS || "Bhai Satvinder Singh Ji")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function isExcluded(artist) {
  const a = (artist || "").toLowerCase();
  return excludedArtists().some((x) => x && a.includes(x));
}

const artistOf = (x) => (x && (x.name || x["#text"])) || "";

async function lfm(params) {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return null;
  try {
    return await (await fetch(API + "?api_key=" + encodeURIComponent(key) + "&format=json&" + params, { cache: "no-store" })).json();
  } catch (e) {
    return null;
  }
}

// Merged top artists across all accounts (playcounts summed), excluded removed.
async function topArtists(period, limit) {
  const per = await Promise.all(usernames().map((u) =>
    lfm("method=user.gettopartists&user=" + encodeURIComponent(u) + "&period=" + period + "&limit=" + (limit || 50))
  ));
  const totals = new Map();
  for (const r of per) {
    for (const a of (r && r.topartists && r.topartists.artist) || []) {
      if (!a || !a.name || isExcluded(a.name)) continue;
      totals.set(a.name, (totals.get(a.name) || 0) + (Number(a.playcount) || 0));
    }
  }
  return [...totals.entries()].sort((x, y) => y[1] - x[1]).map(([name, plays]) => ({ name, plays }));
}

// Merged top tracks across all accounts (playcounts summed), excluded removed.
async function topTracks(period, limit) {
  const per = await Promise.all(usernames().map((u) =>
    lfm("method=user.gettoptracks&user=" + encodeURIComponent(u) + "&period=" + period + "&limit=" + (limit || 100))
  ));
  const totals = new Map();
  for (const r of per) {
    for (const t of (r && r.toptracks && r.toptracks.track) || []) {
      const artist = artistOf(t.artist);
      if (!t || !t.name || isExcluded(artist)) continue;
      const key = (t.name + "|" + artist).toLowerCase();
      const prev = totals.get(key);
      totals.set(key, { title: t.name, artist, plays: (Number(t.playcount) || 0) + (prev ? prev.plays : 0), url: t.url });
    }
  }
  return [...totals.values()].sort((a, b) => b.plays - a.plays);
}

module.exports = { usernames, isExcluded, artistOf, lfm, topArtists, topTracks };
