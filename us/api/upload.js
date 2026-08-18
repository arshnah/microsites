// Media uploads for "us" — photos (chat, album, memories) and voice notes —
// stored in the public `us-media` Supabase Storage bucket. Anon insert/read
// RLS policies already exist on that bucket (same open-link trust model as
// couple_kv), so this is a plain REST call, no service key needed.

const SUPA_URL = process.env.SUPABASE_URL || "https://nazcvlhfmsxuyfmbkfvs.supabase.co";
const SUPA_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5hemN2bGhmbXN4dXlmbWJrZnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTQyMzIsImV4cCI6MjEwMTQ5MDIzMn0.Nx3MieHHaooA-OaYCGNSQpGugbMZkw0nBt0fCMMaW-A";

const MAX_BYTES = 6 * 1024 * 1024; // 6MB, under the 8MB bucket cap
const MIME_EXT = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav",
};
const slugOk = (s) => /^[a-z0-9-]{3,40}$/.test(s || "");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BYTES * 1.4) { req.destroy(); reject(new Error("too big")); return; }
      chunks.push(c);
    });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") { res.statusCode = 405; return res.end(JSON.stringify({ error: "POST only" })); }

  let body;
  try { body = await readBody(req); } catch { res.statusCode = 413; return res.end(JSON.stringify({ error: "file too big" })); }

  const slug = String(body.slug || "").trim().toLowerCase();
  if (!slugOk(slug)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad slug" })); }
  const mime = String(body.mime || "");
  const ext = MIME_EXT[mime];
  if (!ext) { res.statusCode = 400; return res.end(JSON.stringify({ error: "unsupported file type" })); }

  const dataUrl = String(body.data || "");
  const m = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);
  if (!m) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad data" })); }
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > MAX_BYTES) { res.statusCode = 400; return res.end(JSON.stringify({ error: "file too big — 6MB max" })); }

  const path = slug + "/" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
  try {
    const r = await fetch(SUPA_URL + "/storage/v1/object/us-media/" + path, {
      method: "POST",
      headers: { apikey: SUPA_ANON_KEY, Authorization: "Bearer " + SUPA_ANON_KEY, "Content-Type": mime },
      body: buf,
    });
    if (!r.ok) { res.statusCode = 502; return res.end(JSON.stringify({ error: "upload failed: " + (await r.text()) })); }
    const url = SUPA_URL + "/storage/v1/object/public/us-media/" + path;
    res.end(JSON.stringify({ ok: true, url }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "upload failed" }));
  }
};
