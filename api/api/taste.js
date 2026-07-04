// A hand-curated "same taste" list to match the bollywood-romantic / sufi vibe
// (KK, Rahat, Arijit, Atif, Pritam, Mohit Chauhan). Each seed is resolved to a
// real spotify link, album art, and a 30s preview so the page can play them.

const SEEDS = [
  ["Agar Tum Saath Ho", "Arijit Singh"],
  ["Tum Se Hi", "Mohit Chauhan"],
  ["Kabira", "Arijit Singh"],
  ["Iktara", "Kavita Seth"],
  ["Raabta", "Arijit Singh"],
  ["Janam Janam", "Arijit Singh"],
  ["Ae Dil Hai Mushkil", "Arijit Singh"],
  ["Bulleya", "Amit Mishra"],
  ["Phir Le Aya Dil", "Arijit Singh"],
  ["Muskurane", "Arijit Singh"],
  ["Khairiyat", "Arijit Singh"],
  ["Teri Ore", "Rahat Fateh Ali Khan"],
  ["Zaroori Tha", "Rahat Fateh Ali Khan"],
  ["Tere Sang Yaara", "Atif Aslam"],
  ["Tera Hone Laga Hoon", "Atif Aslam"],
  ["Pehli Nazar Mein", "Atif Aslam"],
  ["Tu Jaane Na", "Atif Aslam"],
  ["Tera Ban Jaunga", "Akhil Sachdeva"],
  ["Hawayein", "Arijit Singh"],
  ["Enna Sona", "Arijit Singh"],
];

async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    return (await r.json()).access_token || null;
  } catch (e) { return null; }
}

async function spotifyTrack(token, title, artist) {
  if (!token) return {};
  try {
    const r = await (await fetch("https://api.spotify.com/v1/search?type=track&limit=1&q=" + encodeURIComponent(title + " " + artist), { headers: { Authorization: "Bearer " + token } })).json();
    const t = r && r.tracks && r.tracks.items && r.tracks.items[0];
    if (!t) return {};
    return { url: t.external_urls && t.external_urls.spotify, art: (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || null, name: t.name, artist: t.artists && t.artists[0] && t.artists[0].name };
  } catch (e) { return {}; }
}

async function itunesPreview(title, artist) {
  try {
    const r = await (await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(artist + " " + title) + "&entity=song&limit=1")).json();
    const x = r && r.results && r.results[0];
    return (x && x.previewUrl) || null;
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=172800");
  res.statusCode = 200;

  const token = await spotifyToken();
  const tracks = await Promise.all(SEEDS.map(async ([title, artist]) => {
    const [sp, preview] = await Promise.all([spotifyTrack(token, title, artist), itunesPreview(title, artist)]);
    return {
      title: sp.name || title,
      artist: sp.artist || artist,
      art: sp.art || null,
      preview,
      spotify: sp.url || "https://open.spotify.com/search/" + encodeURIComponent(title + " " + artist),
    };
  }));

  res.end(JSON.stringify({ tracks }));
};
