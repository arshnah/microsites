// A shared, collaborative mixtape keyed by slug. GET reads it, POST either
// creates a tape ({slug, name, pattern, stickers, note}) or appends a track
// to an existing one. No login — the slug in the link is the shared secret,
// same trust model as scratch's url-is-the-doc pattern. Anyone with the link
// can add a song. Tracks just link out to Spotify/YouTube, no playback here.

const { kvGet, kvSet, configured } = require("./_kv");

const PATTERNS = ["clover", "gingham", "grid", "stars"];
const STICKERS = ["sprig", "daisies", "bow"];
const TRACK_LIMIT = 50;

function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 8000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
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

    const mix = (await kvGet("mixtape:" + s)) || {
      name: String(body.name || s).trim().slice(0, 60) || s,
      pattern: PATTERNS.includes(body.pattern) ? body.pattern : PATTERNS[0],
      stickers: Array.isArray(body.stickers) ? body.stickers.filter((x) => STICKERS.includes(x)).slice(0, 6) : [],
      note: body.note ? String(body.note).slice(0, 280) : "",
      createdAt: new Date().toISOString(),
      tracks: [],
    };
    if (!mix.tracks) mix.tracks = [];

    // no title in the body means "just create the tape" (wizard's last step)
    if (!body.title) {
      await kvSet("mixtape:" + s, mix);
      return res.end(JSON.stringify({ ok: true, mix }));
    }

    if (mix.tracks.length >= TRACK_LIMIT) { res.statusCode = 400; return res.end(JSON.stringify({ error: "this tape is full — " + TRACK_LIMIT + " tracks max" })); }

    const title = String(body.title).slice(0, 120);
    const artist = String(body.artist || "").slice(0, 120);
    const addedBy = String(body.addedBy || "").trim().slice(0, 24) || "someone";
    const source = body.source === "youtube" ? "youtube" : "spotify";
    const url = body.url ? String(body.url).slice(0, 300) : null;
    if (!url) { res.statusCode = 400; return res.end(JSON.stringify({ error: "missing track url" })); }

    mix.tracks.push({
      title, artist,
      art: body.art ? String(body.art).slice(0, 300) : null,
      source, url,
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
