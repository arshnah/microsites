// Reorder a Spotify playlist in place. Reads every track the playlist currently
// holds (including hand-added ones), reorders them, and writes the SAME set
// back in the new order. It never adds and never removes a track: the output is
// always a permutation of the input, guarded by an integrity check before any
// write, so no song is ever lost.
//
// Ordering (mode=smart, the default) is an artist-spread shuffle: tracks are
// grouped by artist and the members of each artist are spaced evenly across the
// run, so a heavy artist never clumps and you rarely hear the same artist twice
// in a row. This reads as "curated" rather than the clustered feel of a plain
// random shuffle.
//
// If ?ref=<playlistId> is given AND Spotify still exposes audio-features for
// this app, the target playlist is instead sequenced to follow the reference
// playlist's energy arc (its rise/fall shape), while still avoiding same-artist
// adjacency. If audio-features are unavailable it degrades cleanly to the
// artist-spread shuffle.
//
// Auth accepts EITHER the long SHUFFLE_KEY or the short, memorable SHUFFLE_PW,
// passed as ?key= / ?pw= or as an `Authorization: Bearer <secret>` header. The
// /shuffle button page uses the header form with SHUFFLE_PW so the secret never
// lands in a URL, browser history, or an access log.
//
//   ?key=<SHUFFLE_KEY> | ?pw=<SHUFFLE_PW> | Authorization: Bearer <either>
//   ?pl=<id>                  playlist to reorder (default SAME_TASTE_PLAYLIST_ID)
//   ?ref=<id[,id]>            reference playlist(s)
//   ?mode=smart|like|best|top|random   default smart
//     smart  = artist-spread shuffle
//     like   = borrows a reference playlist's running order (?ref=<id[,id]>)
//     best    = self-built popularity wave (?vibe=chill for a flatter mood version)
//     top     = best songs at the top, popularity descending (light de-clump only)
//     punjabi = tiered Punjabi-scene artists + recency, underrated tracks interleaved
//     chill   = actual mood via a hand-researched artist classification, not
//               popularity or any API tag (both are dead/empty) — see chillOrder
//     random  = plain shuffle

async function userToken() {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET, refresh = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(refresh),
  });
  return (await r.json()).access_token || null;
}

// Every track: uri, id (for audio-features), and primary artist (for spacing).
async function allTracks(token, pid) {
  const out = [];
  let url = "https://api.spotify.com/v1/playlists/" + pid + "/tracks?fields=items(track(id,uri,name,popularity,album(id,release_date),artists(name))),next&limit=100";
  while (url) {
    const r = await (await fetch(url, { headers: { Authorization: "Bearer " + token } })).json();
    for (const it of (r.items || [])) {
      const t = it && it.track;
      if (t && t.uri) {
        const names = (t.artists || []).map((a) => ((a && a.name) || "").toLowerCase()).filter(Boolean);
        const year = parseInt(((t.album && t.album.release_date) || "").slice(0, 4), 10);
        out.push({
          id: t.id || null, uri: t.uri, name: t.name || "",
          artist: names[0] || "", artistsAll: names,
          pop: typeof t.popularity === "number" ? t.popularity : null,
          album: (t.album && t.album.id) || null,
          year: Number.isFinite(year) ? year : null,
          decade: Number.isFinite(year) ? Math.floor(year / 10) : null,
        });
      }
    }
    url = r.next;
  }
  return out;
}

// energy per track id, or null if Spotify no longer serves audio-features to
// this app (so callers can fall back). Batched by 100.
async function audioEnergies(token, ids) {
  const clean = ids.filter(Boolean);
  if (!clean.length) return null;
  const map = new Map();
  for (let i = 0; i < clean.length; i += 100) {
    const batch = clean.slice(i, i + 100);
    const r = await fetch("https://api.spotify.com/v1/audio-features?ids=" + batch.join(","), { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return null;
    const j = await r.json();
    for (const f of (j.audio_features || [])) if (f && f.id && typeof f.energy === "number") map.set(f.id, f.energy);
  }
  return map.size ? map : null;
}

function fisherYates(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const tmp = x[i]; x[i] = x[j]; x[j] = tmp; }
  return x;
}

// After ordering, nudge any leftover same-artist neighbours apart by swapping
// the offender forward to the nearest slot with a different artist on both sides.
function deClump(arr) {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i].artist && arr[i].artist === arr[i - 1].artist) {
      for (let j = i + 1; j < arr.length; j++) {
        const okHere = arr[j].artist !== arr[i - 1].artist;
        const okThere = arr[j - 1] && arr[j - 1].artist !== arr[i].artist && (!arr[j + 1] || arr[j + 1].artist !== arr[i].artist);
        if (okHere && okThere) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; break; }
      }
    }
  }
  return arr;
}

// Artist-spread shuffle: place each artist's tracks at evenly spaced fractional
// positions in [0,1) with a random phase, then sort. Big artists end up spread
// across the whole run instead of clustering.
function spreadShuffle(tracks) {
  const groups = new Map();
  for (const t of tracks) { const k = t.artist || t.uri; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const placed = [];
  for (const arr of groups.values()) {
    const shuffled = fisherYates(arr);
    const k = shuffled.length;
    const phase = Math.random();
    for (let i = 0; i < k; i++) placed.push({ t: shuffled[i], pos: ((i + phase + Math.random() * 0.4) / k) % 1 });
  }
  placed.sort((a, b) => a.pos - b.pos);
  return deClump(placed.map((p) => p.t));
}

// Borrow the RUNNING ORDER of one or more reference playlists. Spotify killed
// audio-features for this app, so we can't copy a reference's energy curve —
// but the reference's own sequencing already encodes the curator's flow, and
// that we can read. A track the reference also has lands near where the
// reference puts it; an artist the reference features lands near that artist's
// average spot; anything the references don't know is scattered uniformly so it
// never piles up at the end. Returns null if no reference resolved.
// Build a good running order from scratch, no reference playlist involved.
//
// The shape a long playlist wants is not "all the hits first" (it front-loads
// and then dies) and not flat-random (it feels aimless). It wants a wave: open
// on something big, ride down into deeper cuts, come back up to a peak, repeat.
// Popularity is the only proxy for "banger" left to us since audio-features is
// dead, and it works well enough — it is rank-normalised to a percentile first
// so a playlist of uniformly obscure tracks still gets a full-range wave.
//
// On top of the wave, three separation rules keep it from feeling repetitive:
// the same artist, the same album, and the same decade all get pushed apart.
// `vibe=chill` flattens the wave and drops the big opener: a chill playlist
// wants a steady mood with gentle swells, not a hits playlist's peaks-and-
// valleys. Same separation rules either way.
function bestOrder(tracks, vibe) {
  const N = tracks.length;
  const chill = vibe === "chill";
  const AMP = chill ? 0.16 : 0.35;
  const strongOpen = !chill;

  // percentile-rank popularity → 0..1, robust to skew and to missing values
  const scale = tracks.map((t) => (typeof t.pop === "number" ? t.pop : 0)).sort((a, b) => a - b);
  const pct = (p) => {
    if (scale.length < 2) return 0.5;
    let lo = 0, hi = scale.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (scale[mid] < p) lo = mid + 1; else hi = mid; }
    return lo / (scale.length - 1);
  };

  const pool = tracks.map((t) => Object.assign({}, t, { pn: pct(typeof t.pop === "number" ? t.pop : 0) }));
  // a peak every ~12-16 tracks: long enough to breathe, short enough to notice.
  // chill stretches that out so the swells are slower and less obvious.
  const PERIOD = chill
    ? Math.max(18, Math.min(28, Math.round(N / 14) || 20))
    : Math.max(10, Math.min(16, Math.round(N / 26) || 12));

  const out = [], recentArtists = [];
  for (let i = 0; i < N; i++) {
    // open on the two biggest tracks, then settle into the wave
    const target = (strongOpen && i < 2) ? 1 : 0.5 + AMP * Math.cos((2 * Math.PI * i) / PERIOD);
    const prev = out[out.length - 1];
    let best = -1, bestScore = Infinity;
    for (let j = 0; j < pool.length; j++) {
      const c = pool[j];
      let s = Math.abs(c.pn - target);
      if (prev) {
        if (c.artist && c.artist === prev.artist) s += 0.60;          // never twice in a row
        if (c.album && c.album === prev.album) s += 0.30;             // not the same record back to back
        if (c.decade !== null && c.decade === prev.decade) s += 0.08; // nudge eras to alternate
      }
      if (c.artist && recentArtists.indexOf(c.artist) !== -1) s += 0.25; // and not again too soon
      if (s < bestScore) { bestScore = s; best = j; }
    }
    const chosen = pool.splice(best, 1)[0];
    out.push(chosen);
    if (chosen.artist) { recentArtists.push(chosen.artist); if (recentArtists.length > 4) recentArtists.shift(); }
  }
  return deClump(out);
}

// `mode=top`: straight best-songs-at-the-top, popularity descending, no wave.
// Same percentile-rank as bestOrder so it is robust to skew. A light de-clump
// pass runs afterward so the very top isn't three tracks from one artist in a
// row, but it never moves anything far enough to change the overall ranking.
function topOrder(tracks) {
  const scale = tracks.map((t) => (typeof t.pop === "number" ? t.pop : 0)).sort((a, b) => a - b);
  const pct = (p) => {
    if (scale.length < 2) return 0.5;
    let lo = 0, hi = scale.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (scale[mid] < p) lo = mid + 1; else hi = mid; }
    return lo / (scale.length - 1);
  };
  const pool = tracks.map((t) => Object.assign({}, t, { pn: pct(typeof t.pop === "number" ? t.pop : 0) }));
  pool.sort((a, b) => b.pn - a.pn || Math.random() - 0.5);
  return deClump(pool);
}

// percentile-rank helper shared by punjabiOrder and any future score-based mode
function percentileRank(values, missing) {
  const scale = values.map((v) => (typeof v === "number" ? v : missing)).sort((a, b) => a - b);
  return (v) => {
    const x = typeof v === "number" ? v : missing;
    if (scale.length < 2) return 0.5;
    let lo = 0, hi = scale.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (scale[mid] < x) lo = mid + 1; else hi = mid; }
    return lo / (scale.length - 1);
  };
}

// `mode=punjabi`: tiered by current Punjabi-scene standing (web-checked mid
// 2026 — Diljit Dosanjh/Karan Aujla/AP Dhillon/Shubh/Sidhu Moose Wala/Guru
// Randhawa lead; Arjan Dhillon/Ammy Virk/Kaka/Honey Singh etc. are the next
// tier; Navaan Sandhu/Jordan Sandhu/Cheema Y/Gurnam Bhullar are the current
// rising names), blended with release recency and Spotify popularity. Unlisted
// artists score 0 on tier, not penalised, just not boosted.
//
// The bottom third by popularity is treated as the "underrated" pool and
// interleaved back in every few tracks (still tier/recency-ranked among
// themselves) rather than left to sink to the very end, so deep cuts actually
// get heard instead of becoming a boring tail nobody reaches.
const PUNJABI_TIERS = {
  "diljit dosanjh": 1, "karan aujla": 1, "ap dhillon": 1, "sidhu moose wala": 1,
  "shubh": 1, "guru randhawa": 1,
  "arjan dhillon": 0.8, "ammy virk": 0.8, "karan randhawa": 0.8, "jassie gill": 0.8,
  "amrit maan": 0.8, "garry sandhu": 0.8, "gippy grewal": 0.8, "babbu maan": 0.8,
  "sharry mann": 0.8, "mankirt aulakh": 0.8, "kaka": 0.8, "yo yo honey singh": 0.8,
  "honey singh": 0.8, "ranjit bawa": 0.8, "diljit": 0.8,
  "navaan sandhu": 0.65, "jordan sandhu": 0.65, "cheema y": 0.65, "gurnam bhullar": 0.65,
  "preet harpal": 0.65, "roshan prince": 0.65, "ar paisley": 0.65, "parmish verma": 0.65, "guri": 0.65,
};
function punjabiTier(names) {
  let best = 0;
  for (const n of names) { const t = PUNJABI_TIERS[n]; if (t && t > best) best = t; }
  return best;
}
function punjabiOrder(tracks) {
  const popPct = percentileRank(tracks.map((t) => t.pop), 0);
  const yearPct = percentileRank(tracks.map((t) => t.year), null);

  const scored = tracks.map((t) => {
    const names = t.artistsAll && t.artistsAll.length ? t.artistsAll : [t.artist];
    const pp = popPct(t.pop), yp = t.year == null ? 0.5 : yearPct(t.year);
    const tier = punjabiTier(names);
    return Object.assign({}, t, { _score: 0.45 * tier + 0.35 * yp + 0.20 * pp, _popP: pp, _tier: tier });
  });

  const UNDERRATED_CUTOFF = 0.35, GAP = 7;
  const main = scored.filter((t) => t._popP >= UNDERRATED_CUTOFF).sort((a, b) => b._score - a._score);
  const underrated = scored.filter((t) => t._popP < UNDERRATED_CUTOFF).sort((a, b) => b._score - a._score);

  const out = [];
  let u = 0;
  for (let i = 0; i < main.length; i++) {
    out.push(main[i]);
    if ((i + 1) % GAP === 0 && u < underrated.length) out.push(underrated[u++]);
  }
  while (u < underrated.length) out.push(underrated[u++]); // any leftover still makes it in, never dropped
  return { ordered: deClump(out), tiered: scored.filter((t) => t._tier > 0).length, underrated: underrated.length };
}

// `mode=chill`: actual mood, not popularity — popularity measures "how many
// people streamed it," which has nothing to do with how calm a track feels.
// There is no surviving API signal for this: Spotify audio-features is 403,
// and even /v1/artists genres now come back an empty array for this app (the
// same late-2024 cutback that killed audio-features). So this is a hand
// classification from actually knowing each artist's catalogue, not a proxy —
// scale -2 (builds hard / outright dance-energy, a real "spike") to +2
// (quietest, most minimal). Unlisted artists default to 0 (neutral), never
// penalised, so a name outside this specific playlist's roster still plays.
const MOOD_SCORE = {
  "agnes obel": 2, "alexi murdoch": 2, "andy shauf": 2, "damien rice": 2,
  "fionn regan": 2, "foxwarren": 2, "gregory alan isakov": 2, "iron & wine": 2,
  "keaton henson": 2, "khalid khan qawal": 2, "mon rovîa": 2, "novo amor": 2,
  "ray lamontagne": 2, "regina spektor": 2, "sufjan stevens": 2, "the paper kites": 2,
  "ingrid michaelson": 2, "olivia vedder": 2, "hollow coves": 2, "passenger": 2,

  "bear's den": 1, "bon iver": 1, "city and colour": 1, "dermot kennedy": 1,
  "glen hansard": 1, "jack johnson": 1, "kings of convenience": 1, "lake street dive": 1,
  "ricky montgomery": 1, "tom odell": 1, "vance joy": 1, "zach bryan": 1,
  "birdy": 1, "colbie caillat": 1, "corinne bailey rae": 1, "faye webster": 1,
  "jorja smith": 1, "michael kiwanuka": 1, "sade": 1, "sabrina claudio": 1,
  "snoh aalegra": 1, "daniel caesar": 1, "frank ocean": 1, "h.e.r.": 1,
  "khalid": 1, "leon bridges": 1, "steve lacy": 1, "khruangbin": 1,
  "mac demarco": 1, "rex orange county": 1, "still woozy": 1, "the marías": 1,
  "cavetown": 1, "girl in red": 1, "gracie abrams": 1, "holly humberstone": 1,
  "maggie rogers": 1, "maisie peters": 1, "noah cyrus": 1, "noah kahan": 1,
  "laufey": 1, "hozier": 1, "lauv": 1, "jason mraz": 1, "kacey musgraves": 1,
  "lainey wilson": 1, "beabadoobee": 1, "bombay bicycle club": 1,
  "father john misty": 1, "lord huron": 1, "alec benjamin": 1, "the lumineers": 1,

  // still fine for a chill playlist, but their catalogue leans more toward big
  // dynamic swells/choruses (a literal "spike" in structure) or more complex
  // arrangements, so they sit in the middle rather than the calm end
  "alt-j": 0, "fleetwood mac": 0, "jacob collier": 0, "john mayer": 0,
  "the strokes": 0, "mumford & sons": 0, "the head and the heart": 0,

  "kendrick lamar": -1, // hip hop, faster pace than the rest of this playlist
  "meduza": -2,          // house/EDM outlier, the clearest "spike" in the set
};
function moodScore(names) {
  for (const n of names) if (Object.prototype.hasOwnProperty.call(MOOD_SCORE, n)) return MOOD_SCORE[n];
  return 0;
}
function chillOrder(tracks) {
  const scored = tracks.map((t) => {
    const names = t.artistsAll && t.artistsAll.length ? t.artistsAll : [t.artist];
    let mood = 0, matched = false;
    for (const n of names) { if (Object.prototype.hasOwnProperty.call(MOOD_SCORE, n)) { mood = MOOD_SCORE[n]; matched = true; break; } }
    return Object.assign({}, t, { _mood: mood, _matched: matched });
  });
  scored.sort((a, b) => b._mood - a._mood || Math.random() - 0.5);
  const matched = scored.filter((t) => t._matched).length;
  return { ordered: deClump(scored), artists: new Set(tracks.map((t) => t.artist)).size, matched };
}

// Read a reference playlist's running order. The Web API is tried first (works
// for playlists this account owns or can see), but Spotify 404s its own
// editorial playlists (37i9dQZF1DW*) for Web API apps. Their public embed page
// still ships the full ordered tracklist in __NEXT_DATA__, so fall back to that.
async function readRefTracks(token, id) {
  const viaApi = await allTracks(token, id);
  if (viaApi.length) return viaApi;
  try {
    const r = await fetch("https://open.spotify.com/embed/playlist/" + id, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (!r.ok) return [];
    const html = await r.text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return [];
    const data = JSON.parse(m[1]);
    const list = (data && data.props && data.props.pageProps && data.props.pageProps.state
      && data.props.pageProps.state.data && data.props.pageProps.state.data.entity
      && data.props.pageProps.state.data.entity.trackList) || [];
    return list
      .filter((t) => t && typeof t.uri === "string" && t.uri.indexOf("spotify:track:") === 0)
      .map((t) => {
        const names = String(t.subtitle || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        return { uri: t.uri, id: t.uri.split(":").pop(), artist: names[0] || "", artistsAll: names };
      });
  } catch (e) { return []; }
}

async function likeOrder(token, tracks, refIds) {
  const trackRank = new Map(), artistAcc = new Map();
  let used = 0, refTotal = 0;
  for (const rid of refIds) {
    const ref = await readRefTracks(token, rid);
    if (!ref.length) continue;
    used++; refTotal += ref.length;
    const last = ref.length - 1 || 1;
    ref.forEach((t, i) => {
      const r = i / last; // 0 = top of the reference, 1 = bottom
      if (t.uri && !trackRank.has(t.uri)) trackRank.set(t.uri, r);
      // credit every named artist, not just the first: Bollywood lists the
      // composer first, so primary-only matching would miss most singers.
      for (const name of (t.artistsAll && t.artistsAll.length ? t.artistsAll : [t.artist])) {
        if (!name) continue;
        const a = artistAcc.get(name) || { sum: 0, n: 0 };
        a.sum += r; a.n++; artistAcc.set(name, a);
      }
    });
  }
  if (!used) return null;

  const artistRank = new Map();
  for (const [a, v] of artistAcc) artistRank.set(a, v.sum / v.n);

  let exact = 0, byArtist = 0, unknown = 0;
  const scored = tracks.map((t) => {
    let r;
    if (trackRank.has(t.uri)) { r = trackRank.get(t.uri); exact++; }
    else {
      const hits = (t.artistsAll && t.artistsAll.length ? t.artistsAll : [t.artist])
        .map((n) => artistRank.get(n)).filter((x) => typeof x === "number");
      if (hits.length) { r = hits.reduce((s, x) => s + x, 0) / hits.length + (Math.random() - 0.5) * 0.08; byArtist++; }
      else { r = Math.random(); unknown++; }
    }
    return { t, r: Math.min(1, Math.max(0, r)) };
  });
  scored.sort((a, b) => a.r - b.r);
  return { ordered: deClump(scored.map((s) => s.t)), exact, byArtist, unknown, refs: used, refTotal };
}

// Moving-average smooth of an energy series (the reference's arc shape).
function smoothArc(energies) {
  if (!energies.length) return null;
  const w = 5, out = [];
  for (let i = 0; i < energies.length; i++) {
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(energies.length - 1, i + w); j++) { sum += energies[j]; c++; }
    out.push(sum / c);
  }
  return out;
}

// Sequence tracks so their energy follows the target arc, greedily picking the
// closest-energy track to each slot while penalising same-artist adjacency.
function arcOrder(tracks, energyOf, arc) {
  const N = tracks.length, pool = tracks.slice(), out = [];
  let prev = null;
  for (let pos = 0; pos < N; pos++) {
    const target = arc[Math.min(arc.length - 1, Math.floor((pos / N) * arc.length))];
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const e = energyOf(pool[i]); const eu = (typeof e === "number") ? e : 0.5;
      let score = Math.abs(eu - target);
      if (pool[i].artist && pool[i].artist === prev) score += 0.5;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    const chosen = pool.splice(best, 1)[0];
    out.push(chosen); prev = chosen.artist;
  }
  return out;
}

const sortedKey = (uris) => uris.slice().sort().join("\n");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const params = new URL(req.url, "http://x").searchParams;
  // Either the long key or the short password unlocks it, by query param or
  // Bearer header. If neither secret is configured the endpoint stays open.
  const accepted = [process.env.SHUFFLE_KEY, process.env.SHUFFLE_PW].filter(Boolean);
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const given = params.get("key") || params.get("pw") || bearer;
  if (accepted.length && !accepted.includes(given)) {
    res.statusCode = 401; return res.end(JSON.stringify({ error: "unauthorized" }));
  }

  const pid = params.get("pl") || process.env.SAME_TASTE_PLAYLIST_ID;
  const refIds = (params.get("ref") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const refId = refIds[0] || null;
  const raw = params.get("mode");
  const mode = raw === "random" ? "random" : raw === "like" ? "like" : raw === "best" ? "best"
    : raw === "top" ? "top" : raw === "punjabi" ? "punjabi" : raw === "chill" ? "chill" : "smart";

  // Env/config diagnostics, presence and status codes only, never a secret
  // value: for tracking down "not configured" without ever printing a token.
  if (params.get("diag")) {
    const present = (k) => !!(process.env[k] && process.env[k].length);
    const out = {
      SPOTIFY_CLIENT_ID: present("SPOTIFY_CLIENT_ID"),
      SPOTIFY_CLIENT_SECRET: present("SPOTIFY_CLIENT_SECRET"),
      SPOTIFY_REFRESH_TOKEN: present("SPOTIFY_REFRESH_TOKEN"),
      SAME_TASTE_PLAYLIST_ID: present("SAME_TASTE_PLAYLIST_ID"),
      pidResolved: !!pid,
    };
    if (out.SPOTIFY_CLIENT_ID && out.SPOTIFY_CLIENT_SECRET && out.SPOTIFY_REFRESH_TOKEN) {
      try {
        const r = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: { Authorization: "Basic " + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ":" + process.env.SPOTIFY_CLIENT_SECRET).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(process.env.SPOTIFY_REFRESH_TOKEN),
        });
        const j = await r.json();
        out.tokenExchangeStatus = r.status;
        out.tokenExchangeOk = !!j.access_token;
        out.tokenExchangeError = j.error || null;
      } catch (e) { out.tokenExchangeThrew = String(e); }
    }
    res.statusCode = 200; return res.end(JSON.stringify(out, null, 2));
  }

  const token = await userToken();
  if (!token || !pid) { res.statusCode = 500; return res.end(JSON.stringify({ error: "not configured" })); }

  try {
    // Read-only: dump artist + track name pairs, no scoring/ordering. For manual
    // research (e.g. building a hand-curated mood classification) when no API
    // signal is available. Writes nothing.
    if (params.get("list")) {
      const tr = await allTracks(token, pid);
      const uniqueArtists = [...new Set(tr.map((t) => t.artist).filter(Boolean))].sort();
      res.statusCode = 200;
      return res.end(JSON.stringify({
        pid, total: tr.length, uniqueArtistCount: uniqueArtists.length,
        uniqueArtists,
        tracks: tr.map((t) => t.artist + " - " + t.name),
      }, null, 2));
    }

    // Read-only diagnostics: what does Spotify actually hand back? Writes nothing.
    if (params.get("probe")) {
      const out = { pid, refs: {} };
      const metaR = await fetch("https://api.spotify.com/v1/playlists/" + pid + "?fields=name,tracks(total)", { headers: { Authorization: "Bearer " + token } });
      const meta = metaR.ok ? await metaR.json() : null;
      out.name = meta && meta.name;
      out.reportedTotal = meta && meta.tracks && meta.tracks.total;

      // count every item, including ones with a null/local track we cannot rewrite
      let readable = 0, nullTrack = 0, local = 0, noUri = 0, items = 0;
      let url = "https://api.spotify.com/v1/playlists/" + pid + "/tracks?fields=items(is_local,track(uri,is_local,name)),next&limit=100";
      while (url) {
        const j = await (await fetch(url, { headers: { Authorization: "Bearer " + token } })).json();
        for (const it of (j.items || [])) {
          items++;
          if (!it || !it.track) { nullTrack++; continue; }
          if (it.is_local || it.track.is_local) { local++; continue; }
          if (!it.track.uri) { noUri++; continue; }
          readable++;
        }
        url = j.next;
      }
      out.items = items; out.readable = readable; out.nullTrack = nullTrack; out.local = local; out.noUri = noUri;
      out.wouldDrop = items - readable;

      for (const rid of refIds) {
        const r = await fetch("https://api.spotify.com/v1/playlists/" + rid + "?fields=name,tracks(total)", { headers: { Authorization: "Bearer " + token } });
        const body = r.ok ? await r.json() : (await r.text()).slice(0, 200);
        const tr = await fetch("https://api.spotify.com/v1/playlists/" + rid + "/tracks?fields=items(track(uri)),next&limit=100", { headers: { Authorization: "Bearer " + token } });
        const trj = tr.ok ? await tr.json() : null;
        out.refs[rid] = { metaStatus: r.status, meta: body, tracksStatus: tr.status, firstPageItems: trj && trj.items ? trj.items.length : 0 };
      }
      res.statusCode = 200; return res.end(JSON.stringify(out, null, 2));
    }

    const tracks = await allTracks(token, pid);
    if (!tracks.length) { res.statusCode = 500; return res.end(JSON.stringify({ error: "playlist empty", pid })); }

    let ordered, method, stats = null;
    if (mode === "random") {
      ordered = fisherYates(tracks); method = "random";
    } else if (mode === "top") {
      ordered = topOrder(tracks);
      const withPop = tracks.filter((t) => typeof t.pop === "number").length;
      stats = { popularityKnown: withPop, of: tracks.length };
      method = "top (popularity descending, " + withPop + "/" + tracks.length + " with popularity)";
    } else if (mode === "punjabi") {
      const r = punjabiOrder(tracks);
      ordered = r.ordered; stats = { tiered: r.tiered, underrated: r.underrated, of: tracks.length };
      method = "punjabi (" + r.tiered + "/" + tracks.length + " tiered artists, " + r.underrated + " underrated interleaved)";
    } else if (mode === "chill") {
      const r = chillOrder(tracks);
      ordered = r.ordered; stats = { artists: r.artists, matched: r.matched };
      method = "chill (hand-researched mood, " + r.matched + "/" + tracks.length + " tracks matched a classified artist)";
    } else if (mode === "best") {
      const vibe = params.get("vibe") === "chill" ? "chill" : null;
      ordered = bestOrder(tracks, vibe);
      const withPop = tracks.filter((t) => typeof t.pop === "number").length;
      stats = { popularityKnown: withPop, of: tracks.length, vibe: vibe || "default" };
      method = "best (" + (vibe || "default") + " wave, " + withPop + "/" + tracks.length + " with popularity)";
    } else if (mode === "like" && refIds.length) {
      const r = await likeOrder(token, tracks, refIds);
      if (r) {
        ordered = r.ordered; stats = { exact: r.exact, byArtist: r.byArtist, unknown: r.unknown, refs: r.refs, refTotal: r.refTotal };
        stats.matchedPct = Math.round(((r.exact + r.byArtist) / tracks.length) * 100);
        method = "like-ref (" + r.refs + " refs, " + r.exact + " exact + " + r.byArtist + " by-artist of " + tracks.length + ")";
      }
      else { ordered = spreadShuffle(tracks); method = "spread (refs unreadable)"; }
    } else if (refId) {
      const refTracks = await allTracks(token, refId);
      const refE = await audioEnergies(token, refTracks.map((t) => t.id));
      const plE = refE ? await audioEnergies(token, tracks.map((t) => t.id)) : null;
      const arc = refE ? smoothArc(refTracks.map((t) => refE.get(t.id)).filter((x) => typeof x === "number")) : null;
      if (arc && plE) { ordered = arcOrder(tracks, (t) => plE.get(t.id), arc); method = "arc+ref"; }
      else { ordered = spreadShuffle(tracks); method = "spread (audio-features unavailable)"; }
    } else {
      ordered = spreadShuffle(tracks); method = "spread";
    }

    // Integrity guard: output MUST be a permutation of the input. If not, abort
    // WITHOUT writing so we can never drop or duplicate a track.
    const inUris = tracks.map((t) => t.uri);
    const outUris = ordered.map((t) => t.uri);
    if (outUris.length !== inUris.length || sortedKey(inUris) !== sortedKey(outUris)) {
      res.statusCode = 500; return res.end(JSON.stringify({ error: "integrity check failed, nothing written", pid, in: inUris.length, out: outUris.length }));
    }

    // Dry run: report how well the ordering fits and preview the opening, but
    // write nothing. Lets a reference be evaluated before it touches a playlist.
    if (params.get("dry")) {
      res.statusCode = 200;
      return res.end(JSON.stringify({
        ok: true, dry: true, pid, method, total: outUris.length, stats,
        opening: ordered.slice(0, 12).map((t, i) => (i + 1) + ". " + (t.artist || "?") + " - " + (t.name || "?")),
      }, null, 2));
    }

    // Replace with the first 100 in the new order, then append the rest in
    // batches of 100 (with a light retry) so every track is preserved.
    const put = await fetch("https://api.spotify.com/v1/playlists/" + pid + "/tracks", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ uris: outUris.slice(0, 100) }),
    });
    if (!put.ok) { res.statusCode = 500; return res.end(JSON.stringify({ error: "replace failed", status: put.status, pid })); }
    let wrote = Math.min(100, outUris.length);
    for (let i = 100; i < outUris.length; i += 100) {
      const batch = outUris.slice(i, i + 100);
      let ok = false, status = 0;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const r = await fetch("https://api.spotify.com/v1/playlists/" + pid + "/tracks", {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ uris: batch }),
        });
        ok = r.ok; status = r.status;
        if (!ok) await new Promise((s) => setTimeout(s, 500 * (attempt + 1)));
      }
      if (!ok) { res.statusCode = 500; return res.end(JSON.stringify({ error: "append batch failed", status, pid, total: outUris.length, wrote })); }
      wrote += batch.length;
    }

    // Post-write check: re-read the playlist and confirm Spotify actually kept
    // every track. A rewrite round-trips each uri, and Spotify can silently
    // refuse to re-add one that has gone unavailable, so verify rather than trust.
    let verified = null, lost = null;
    try {
      const vr = await fetch("https://api.spotify.com/v1/playlists/" + pid + "?fields=tracks(total)", { headers: { Authorization: "Bearer " + token } });
      if (vr.ok) { const vj = await vr.json(); verified = vj && vj.tracks && vj.tracks.total; if (typeof verified === "number") lost = outUris.length - verified; }
    } catch (e) { /* verification is best-effort */ }

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, pid, method, total: outUris.length, reordered: wrote, verifiedTotal: verified, lost }));
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ error: String(e), pid }));
  }
};
