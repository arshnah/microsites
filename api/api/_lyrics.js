// Synced (LRC-timed) lyrics lookup, from lrclib.net — a free, keyless,
// community-sourced lyrics API built for exactly this (music players
// wanting karaoke-style sync). Not a route (leading "_") — folded into
// spotify-live.js's response instead of its own endpoint, since this
// project is at its Hobby-plan cap of 12 Serverless Functions and every
// new route here has to come out of that same budget.

const LRCLIB = "https://lrclib.net/api";

function parseLRC(text) {
  if (!text) return null;
  const lines = [];
  const re = /^\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/;
  for (const raw of text.split("\n")) {
    const m = re.exec(raw.trim());
    if (!m) continue;
    const min = Number(m[1]), sec = Number(m[2]), frac = m[3] ? Number("0." + m[3]) : 0;
    const t = min * 60 + sec + frac;
    lines.push({ t, text: (m[4] || "").trim() });
  }
  return lines.length ? lines : null;
}

async function fetchLyrics(track, artist, album, durationSec) {
  if (!track || !artist) return { found: false };
  try {
    const params = new URLSearchParams({ track_name: track, artist_name: artist });
    if (album) params.set("album_name", album);
    if (durationSec) params.set("duration", String(Math.round(durationSec)));

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

    if (!d) return { found: false };

    const synced = parseLRC(d.syncedLyrics);
    return {
      found: true,
      synced: !!synced,
      lines: synced,
      plain: d.plainLyrics || null,
      instrumental: !!d.instrumental,
    };
  } catch (e) {
    return { found: false };
  }
}

module.exports = { fetchLyrics };
