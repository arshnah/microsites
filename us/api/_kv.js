// Generic Vercel KV (Upstash REST) get/set — one JSON blob per key. Used to
// store each couple's { names, startDate, mixtapes, memories } under
// "couple:<slug>". Same store & env vars as mixtape's KV, different key.

const url = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const tok = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const configured = () => Boolean(url() && tok());

async function kvGet(key) {
  if (!configured()) return null;
  try {
    const r = await fetch(url() + "/get/" + encodeURIComponent(key), { headers: { Authorization: "Bearer " + tok() }, cache: "no-store" });
    const j = await r.json();
    return j && j.result ? JSON.parse(j.result) : null;
  } catch (e) { return null; }
}

async function kvSet(key, value) {
  if (!configured()) throw new Error("KV not configured");
  const r = await fetch(url() + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + tok(), "Content-Type": "text/plain" },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error("KV write failed");
}

module.exports = { kvGet, kvSet, configured };
