// Per-celebration guestbook, keyed by ?slug=. Separate table from portfolio's
// own guestbook (which is currently disabled there — a missing anon INSERT
// grant) so this doesn't inherit that bug; see README for the one-time SQL.
//
//   GET  /api/wish-guestbook?slug=<slug>            -> { entries: [...] }
//   POST /api/wish-guestbook?slug=<slug>  {name,message} -> { ok, entry }

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const WRITE = process.env.SUPABASE_SERVICE_ROLE_KEY || ANON;
const READ_H = { apikey: ANON || "", Authorization: "Bearer " + (ANON || ""), "Content-Type": "application/json" };
const WRITE_H = { apikey: WRITE || "", Authorization: "Bearer " + (WRITE || ""), "Content-Type": "application/json" };

function spammy(name, message) {
  const s = name + " " + message;
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(xyz|top|ru|tk|club|online|site|shop|live|link|click)\b/i.test(s)) return true;
  if (/pg_terminate|pg_sleep|;\s*(select|insert|update|delete|create|drop|alter)/i.test(s)) return true;
  return false;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!URL || !ANON) { res.statusCode = 500; return res.end(JSON.stringify({ error: "guestbook not configured — see README" })); }

  const slug = new URL(req.url, "http://x").searchParams.get("slug");
  if (!slug) { res.statusCode = 400; return res.end(JSON.stringify({ error: "slug required" })); }

  if (req.method === "GET") {
    try {
      const r = await fetch(URL + "/rest/v1/wish_guestbook?slug=eq." + encodeURIComponent(slug) + "&select=id,name,message,created_at&order=created_at.desc&limit=100", { headers: READ_H, cache: "no-store" });
      const data = await r.json();
      res.statusCode = 200; return res.end(JSON.stringify({ entries: Array.isArray(data) ? data : [] }));
    } catch (e) { res.statusCode = 200; return res.end(JSON.stringify({ entries: [] })); }
  }

  if (req.method === "POST") {
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const name = String(body.name || "").trim().slice(0, 40);
      const message = String(body.message || "").trim().slice(0, 280);
      if (!name || !message) { res.statusCode = 400; return res.end(JSON.stringify({ error: "name and message required" })); }
      if (spammy(name, message)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "that looks like spam" })); }
      const r = await fetch(URL + "/rest/v1/wish_guestbook", {
        method: "POST", headers: Object.assign({}, WRITE_H, { Prefer: "return=representation" }),
        body: JSON.stringify({ slug, name, message }),
      });
      if (!r.ok) { res.statusCode = 500; return res.end(JSON.stringify({ error: await r.text() })); }
      const d = await r.json();
      res.statusCode = 200; return res.end(JSON.stringify({ ok: true, entry: Array.isArray(d) ? d[0] : d }));
    } catch (e) { res.statusCode = 500; return res.end(JSON.stringify({ error: String(e) })); }
  }

  res.statusCode = 405; res.end(JSON.stringify({ error: "method not allowed" }));
};
