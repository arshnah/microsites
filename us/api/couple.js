// A shared couple's space keyed by slug: names, the day it started, a hub of
// linked mixtapes, and a memory timeline. No login — the slug in the link is
// the shared secret, same trust model as mixtape and scratch. Anyone with
// the link can read and add to it.

const { kvGet, kvSet, configured } = require("./_kv");

const MIXTAPE_LIMIT = 50;
const MEMORY_LIMIT = 200;
const slugOk = (s) => /^[a-z0-9-]{3,40}$/.test(s || "");
const dateOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 8000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

// mixtape.arshnah.in's API sets Access-Control-Allow-Origin: *, so we can
// pull a tape's display name straight from its own store server-side too.
async function fetchMixtapeName(mixtapeSlug) {
  try {
    const r = await (await fetch("https://mixtape.arshnah.in/api/mixtape?slug=" + encodeURIComponent(mixtapeSlug))).json();
    return r && r.mix ? r.mix.name : null;
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "POST") {
    const body = await readBody(req);
    const s = String(body.slug || "").trim().toLowerCase();
    if (!slugOk(s)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad slug" })); }
    if (!configured()) { res.statusCode = 500; return res.end(JSON.stringify({ error: "storage isn't connected yet" })); }

    const action = String(body.action || "create");
    let couple = await kvGet("couple:" + s);

    if (action === "create") {
      if (couple) { res.statusCode = 400; return res.end(JSON.stringify({ error: "that link is already taken" })); }
      if (!dateOk(body.startDate)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad start date" })); }
      couple = {
        nameA: String(body.nameA || "").trim().slice(0, 30) || "you",
        nameB: String(body.nameB || "").trim().slice(0, 30) || "them",
        startDate: body.startDate,
        createdAt: new Date().toISOString(),
        mixtapes: [],
        memories: [],
      };
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (!couple) { res.statusCode = 404; return res.end(JSON.stringify({ error: "no space at that link" })); }

    if (action === "addMixtape") {
      if (couple.mixtapes.length >= MIXTAPE_LIMIT) { res.statusCode = 400; return res.end(JSON.stringify({ error: "hub is full" })); }
      const m = /mixtape\.arshnah\.in\/\?m=([a-z0-9-]{3,40})/i.exec(String(body.url || ""));
      if (!m) { res.statusCode = 400; return res.end(JSON.stringify({ error: "paste a mixtape.arshnah.in link" })); }
      const mixtapeSlug = m[1].toLowerCase();
      if (couple.mixtapes.some((x) => x.slug === mixtapeSlug)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "already added" })); }
      const name = (await fetchMixtapeName(mixtapeSlug)) || mixtapeSlug;
      couple.mixtapes.unshift({ slug: mixtapeSlug, name, url: "https://mixtape.arshnah.in/?m=" + mixtapeSlug, addedAt: new Date().toISOString() });
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "removeMixtape") {
      couple.mixtapes = couple.mixtapes.filter((x) => x.slug !== String(body.mixtapeSlug || ""));
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "addMemory") {
      if (couple.memories.length >= MEMORY_LIMIT) { res.statusCode = 400; return res.end(JSON.stringify({ error: "timeline is full" })); }
      const text = String(body.text || "").trim().slice(0, 300);
      if (!text) { res.statusCode = 400; return res.end(JSON.stringify({ error: "write something first" })); }
      const date = dateOk(body.date) ? body.date : new Date().toISOString().slice(0, 10);
      const memory = {
        id: Math.random().toString(36).slice(2, 10),
        date, text,
        image: body.image ? String(body.image).slice(0, 400) : null,
        addedBy: String(body.addedBy || "").trim().slice(0, 24) || "someone",
        addedAt: new Date().toISOString(),
      };
      couple.memories.push(memory);
      couple.memories.sort((a, b) => (a.date < b.date ? 1 : -1));
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "removeMemory") {
      couple.memories = couple.memories.filter((x) => x.id !== String(body.memoryId || ""));
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "unknown action" }));
  }

  const q = new URL(req.url, "http://x").searchParams;
  const slug = String(q.get("slug") || "").trim().toLowerCase();
  if (!slugOk(slug)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad slug" })); }
  res.setHeader("Cache-Control", "no-store");
  const couple = await kvGet("couple:" + slug);
  res.end(JSON.stringify({ ok: true, couple: couple || null }));
};
