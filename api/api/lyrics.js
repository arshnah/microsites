// Synced (LRC-timed) lyrics for the currently-playing track, from lrclib.net
// — a free, keyless, community-sourced lyrics API built for exactly this
// (music players wanting karaoke-style sync). Proxied server-side so the
// lookup can be cached hard (lyrics for a given track never change) and so
// now.arshnah.in doesn't depend on lrclib's CORS policy staying put.

const LRCLIB = "https://lrclib.net/api";

function parseLRC(text) {
  if (!text) return null;
  const lines = [];
  const re = /^\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/;
  for (const raw of text.split("\n")) {
    const m = re.exec(raw.trim());
    if (!m) continue;
    const min = Number(m[1]), sec = Number(m[2]), frac = m[3] ? Number(("0." + m[3])) : 0;
    const t = min * 60 + sec + frac;
    lines.push({ t, text: (m[4] || "").trim() });
  }
  return lines.length ? lines : null;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400");

  const q = new URL(req.url, "http://x").searchParams;
  const track = (q.get("track") || "").trim();
  const artist = (q.get("artist") || "").trim();
  const album = (q.get("album") || "").trim();
  const duration = (q.get("duration") || "").trim();

  if (!track || !artist) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "track and artist required" }));
  }

  try {
    const params = new URLSearchParams({ track_name: track, artist_name: artist });
    if (album) params.set("album_name", album);
    if (duration) params.set("duration", duration);

    let r = await fetch(LRCLIB + "/get?" + params.toString(), {
      headers: { "User-Agent": "arshnah-now (https://now.arshnah.in)" },
    });
    let d = r.ok ? await r.json() : null;

    // exact /get lookup missed (wrong album/duration guess) — fall back to
    // fuzzy /search and take the first hit with synced lyrics.
    if (!d || (!d.syncedLyrics && !d.plainLyrics)) {
      const sp = new URLSearchParams({ track_name: track, artist_name: artist });
      const sr = await fetch(LRCLIB + "/search?" + sp.toString(), {
        headers: { "User-Agent": "arshnah-now (https://now.arshnah.in)" },
      });
      const list = sr.ok ? await sr.json() : [];
      d = (Array.isArray(list) && (list.find((x) => x.syncedLyrics) || list[0])) || null;
    }

    if (!d) return res.end(JSON.stringify({ found: false }));

    const synced = parseLRC(d.syncedLyrics);
    res.end(JSON.stringify({
      found: true,
      synced: !!synced,
      lines: synced,
      plain: d.plainLyrics || null,
      instrumental: !!d.instrumental,
    }));
  } catch (e) {
    res.end(JSON.stringify({ found: false }));
  }
};
