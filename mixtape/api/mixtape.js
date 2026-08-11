// A shared, collaborative tracklist keyed by slug. GET reads it, POST either
// creates a tape (just {slug, name}) or appends a track to an existing one.
// No login — the slug in the link is the shared secret, same trust model as
// scratch's url-is-the-doc pattern. Anyone with the link can add a song.

const { kvGet, kvSet, configured } = require("./_kv");

function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 8000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

async function itunesPreview(title, artist) {
  try {
    const r = await (await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(artist + " " + title) + "&entity=song&limit=1")).json();
    const x = r && r.results && r.results[0];
    return x ? x.previewUrl || null : null;
  } catch (e) { return null; }
}

const slugOk = (s) => /^[a-z0-9-]{3,40}$/.test(s || "");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "POST") {
    const body = await readBody(req);
    const s = String(body.slug || "").trim().toLowerCase();
    if (!slugOk(s)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad slug" })); }
    if (!configured()) { res.statusCode = 500; return res.end(JSON.stringify({ error: "mixtape storage isn't connected yet" })); }

    const mix = (await kvGet("mixtape:" + s)) || { name: String(body.name || s).trim().slice(0, 60) || s, createdAt: new Date().toISOString(), tracks: [] };
    if (!mix.tracks) mix.tracks = [];

    // no title in the body means "just create the tape" (landing-page flow)
    if (!body.title) {
      await kvSet("mixtape:" + s, mix);
      return res.end(JSON.stringify({ ok: true, mix }));
    }

    if (mix.tracks.length >= 60) { res.statusCode = 400; return res.end(JSON.stringify({ error: "this tape is full — 60 tracks max" })); }

    const title = String(body.title).slice(0, 120);
    const artist = String(body.artist || "").slice(0, 120);
    const addedBy = String(body.addedBy || "").trim().slice(0, 24) || "someone";
    const preview = await itunesPreview(title, artist);

    mix.tracks.push({
      title, artist,
      art: body.art ? String(body.art).slice(0, 300) : null,
      spotifyUrl: body.spotifyUrl ? String(body.spotifyUrl).slice(0, 300) : null,
      preview,
      addedBy,
      addedAt: new Date().toISOString(),
    });

    await kvSet("mixtape:" + s, mix);
    return res.end(JSON.stringify({ ok: true, mix }));
  }

  const q = new URL(req.url, "http://x").searchParams;
  const slug = String(q.get("slug") || "").trim().toLowerCase();
  if (!slugOk(slug)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad slug" })); }
  res.setHeader("Cache-Control", "no-store");
  const mix = await kvGet("mixtape:" + slug);
  res.end(JSON.stringify({ ok: true, mix: mix || null }));
};
