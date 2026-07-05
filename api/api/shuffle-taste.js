// Shuffle the "same taste" Spotify playlist in place. Reads every track it
// currently holds (including any added by hand), randomizes the order, and
// writes the same set back. Unlike sync-taste it does NOT change which tracks
// are in the playlist. Trigger with ?key=<SHUFFLE_KEY> (or a Bearer of it).

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

async function allUris(token, pid) {
  const uris = [];
  let url = "https://api.spotify.com/v1/playlists/" + pid + "/tracks?fields=items(track(uri)),next&limit=100";
  while (url) {
    const r = await (await fetch(url, { headers: { Authorization: "Bearer " + token } })).json();
    for (const it of (r.items || [])) if (it && it.track && it.track.uri) uris.push(it.track.uri);
    url = r.next;
  }
  return uris;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const x = a[i]; a[i] = a[j]; a[j] = x;
  }
  return a;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const key = process.env.SHUFFLE_KEY;
  const given = new URL(req.url, "http://x").searchParams.get("key");
  if (key && given !== key && req.headers.authorization !== "Bearer " + key) {
    res.statusCode = 401; return res.end(JSON.stringify({ error: "unauthorized" }));
  }

  const pid = process.env.SAME_TASTE_PLAYLIST_ID;
  const token = await userToken();
  if (!token || !pid) { res.statusCode = 500; return res.end(JSON.stringify({ error: "not configured" })); }

  try {
    const uris = shuffle(await allUris(token, pid));
    if (!uris.length) { res.statusCode = 500; return res.end(JSON.stringify({ error: "playlist empty" })); }

    // Replace with the first 100 in the new order, then append the rest in
    // batches of 100 so every track is preserved.
    const put = await fetch("https://api.spotify.com/v1/playlists/" + pid + "/tracks", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ uris: uris.slice(0, 100) }),
    });
    let wrote = Math.min(100, uris.length);
    for (let i = 100; i < uris.length; i += 100) {
      const batch = uris.slice(i, i + 100);
      const r = await fetch("https://api.spotify.com/v1/playlists/" + pid + "/tracks", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: batch }),
      });
      if (!r.ok) { res.statusCode = 500; return res.end(JSON.stringify({ error: "add batch failed", status: r.status, total: uris.length, wrote })); }
      wrote += batch.length;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: put.ok, total: uris.length, shuffled: wrote }));
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ error: String(e) }));
  }
};
