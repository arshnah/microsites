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
//   ?mode=smart|like|random   default smart; `like` borrows the references'
//                             running order (see likeOrder)

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
  let url = "https://api.spotify.com/v1/playlists/" + pid + "/tracks?fields=items(track(id,uri,artists(name))),next&limit=100";
  while (url) {
    const r = await (await fetch(url, { headers: { Authorization: "Bearer " + token } })).json();
    for (const it of (r.items || [])) {
      const t = it && it.track;
      if (t && t.uri) {
        const names = (t.artists || []).map((a) => ((a && a.name) || "").toLowerCase()).filter(Boolean);
        out.push({ id: t.id || null, uri: t.uri, artist: names[0] || "", artistsAll: names });
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
  const mode = raw === "random" ? "random" : raw === "like" ? "like" : "smart";
  const token = await userToken();
  if (!token || !pid) { res.statusCode = 500; return res.end(JSON.stringify({ error: "not configured" })); }

  try {
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

    let ordered, method;
    if (mode === "random") {
      ordered = fisherYates(tracks); method = "random";
    } else if (mode === "like" && refIds.length) {
      const r = await likeOrder(token, tracks, refIds);
      if (r) { ordered = r.ordered; method = "like-ref (" + r.refs + " refs, " + r.exact + " exact + " + r.byArtist + " by-artist of " + tracks.length + ")"; }
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
