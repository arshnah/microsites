// Storage for "us", backed by the same Supabase `couple_kv` table that
// games-hub's four couple games already use (room_code, game, key -> jsonb
// value, primary key on the triple). We store one row per couple under
// game="us", key="state" — everything (names, start date, mixtapes,
// memories) lives in that one JSON blob. Public anon read/insert/update
// RLS policies already exist on the table, so this is a plain REST call,
// no service key needed.

const SUPA_URL = process.env.SUPABASE_URL || "https://nazcvlhfmsxuyfmbkfvs.supabase.co";
const SUPA_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5hemN2bGhmbXN4dXlmbWJrZnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTQyMzIsImV4cCI6MjEwMTQ5MDIzMn0.Nx3MieHHaooA-OaYCGNSQpGugbMZkw0nBt0fCMMaW-A";

const configured = () => Boolean(SUPA_URL && SUPA_ANON_KEY);
const headers = () => ({
  apikey: SUPA_ANON_KEY,
  Authorization: "Bearer " + SUPA_ANON_KEY,
  "Content-Type": "application/json",
});

// key format: "<game>:<roomCode>" — e.g. "couple:golden-us-42"
function parseKey(fullKey) {
  const i = fullKey.indexOf(":");
  if (i === -1) return null;
  return { game: fullKey.slice(0, i), roomCode: fullKey.slice(i + 1) };
}

async function kvGet(fullKey) {
  if (!configured()) return null;
  const parsed = parseKey(fullKey);
  if (!parsed) return null;
  try {
    const url = SUPA_URL + "/rest/v1/couple_kv?room_code=eq." + encodeURIComponent(parsed.roomCode)
      + "&game=eq." + encodeURIComponent(parsed.game) + "&key=eq.state&select=value";
    const r = await fetch(url, { headers: headers(), cache: "no-store" });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows && rows[0] ? rows[0].value : null;
  } catch (e) { return null; }
}

async function kvSet(fullKey, value) {
  if (!configured()) throw new Error("storage not configured");
  const parsed = parseKey(fullKey);
  if (!parsed) throw new Error("bad key");
  const row = { room_code: parsed.roomCode, game: parsed.game, key: "state", value, updated_at: new Date().toISOString() };
  const r = await fetch(SUPA_URL + "/rest/v1/couple_kv?on_conflict=room_code,game,key", {
    method: "POST",
    headers: { ...headers(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error("storage write failed: " + (await r.text()));
}

async function kvDelete(fullKey) {
  if (!configured()) throw new Error("storage not configured");
  const parsed = parseKey(fullKey);
  if (!parsed) throw new Error("bad key");
  const url = SUPA_URL + "/rest/v1/couple_kv?room_code=eq." + encodeURIComponent(parsed.roomCode)
    + "&game=eq." + encodeURIComponent(parsed.game) + "&key=eq.state";
  const r = await fetch(url, { method: "DELETE", headers: headers() });
  if (!r.ok) throw new Error("storage delete failed: " + (await r.text()));
}

module.exports = { kvGet, kvSet, kvDelete, configured };
