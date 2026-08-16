// A shared couple's space keyed by slug: names, the day it started, a hub of
// linked mixtapes, and a memory timeline. No login — the slug in the link is
// the shared secret, same trust model as mixtape and scratch. Anyone with
// the link can read and add to it.

const { kvGet, kvSet, configured } = require("./_kv");

const MIXTAPE_LIMIT = 50;
const MEMORY_LIMIT = 200;
const EVENT_LIMIT = 100;
const NOTE_LIMIT = 100;
const DAILY_HISTORY_LIMIT = 120;
const ALARM_LIMIT = 20;
const PING_HISTORY_LIMIT = 120;
const slugOk = (s) => /^[a-z0-9-]{3,40}$/.test(s || "");
const dateOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const timeOk = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || "");

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
        tzA: body.tzA ? String(body.tzA).slice(0, 60) : null,
        tzB: body.tzB ? String(body.tzB).slice(0, 60) : null,
        lastPing: null,
        pingLog: {},
        createdAt: new Date().toISOString(),
        mixtapes: [],
        memories: [],
        events: [],
        notes: [],
        dailyAnswers: {},
        alarms: [],
      };
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (!couple) { res.statusCode = 404; return res.end(JSON.stringify({ error: "no space at that link" })); }
    if (!("tzA" in couple)) { couple.tzA = null; couple.tzB = null; couple.lastPing = null; }
    if (!couple.events) couple.events = [];
    if (!couple.notes) couple.notes = [];
    if (!couple.dailyAnswers) couple.dailyAnswers = {};
    if (!couple.alarms) couple.alarms = [];
    if (!couple.pingLog) couple.pingLog = {};

    if (action === "setTimezones") {
      const tzOk = (tz) => !tz || (typeof tz === "string" && tz.length < 60);
      if (!tzOk(body.tzA) || !tzOk(body.tzB)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad timezone" })); }
      if (body.tzA !== undefined) couple.tzA = body.tzA || null;
      if (body.tzB !== undefined) couple.tzB = body.tzB || null;
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "sendPing") {
      const who = body.who === "B" ? "B" : "A";
      const today = new Date().toISOString().slice(0, 10);
      couple.lastPing = { who, at: new Date().toISOString() };
      if (!couple.pingLog) couple.pingLog = {};
      const day = couple.pingLog[today] || { A: 0, B: 0 };
      day[who] = (day[who] || 0) + 1;
      couple.pingLog[today] = day;
      const days = Object.keys(couple.pingLog).sort();
      if (days.length > PING_HISTORY_LIMIT) {
        for (const d of days.slice(0, days.length - PING_HISTORY_LIMIT)) delete couple.pingLog[d];
      }
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

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
      const rawImages = Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []);
      const images = rawImages.map((u) => String(u || "").trim().slice(0, 400)).filter(Boolean).slice(0, 6);
      const memory = {
        id: Math.random().toString(36).slice(2, 10),
        date, text,
        images,
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

    if (action === "addEvent") {
      if (couple.events.length >= EVENT_LIMIT) { res.statusCode = 400; return res.end(JSON.stringify({ error: "calendar is full" })); }
      const title = String(body.title || "").trim().slice(0, 100);
      if (!title) { res.statusCode = 400; return res.end(JSON.stringify({ error: "give it a title" })); }
      if (!dateOk(body.date)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad date" })); }
      couple.events.push({
        id: Math.random().toString(36).slice(2, 10),
        title, date: body.date,
        addedBy: String(body.addedBy || "").trim().slice(0, 24) || "someone",
        addedAt: new Date().toISOString(),
      });
      couple.events.sort((a, b) => (a.date > b.date ? 1 : -1));
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "removeEvent") {
      couple.events = couple.events.filter((x) => x.id !== String(body.eventId || ""));
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "addNote") {
      if (couple.notes.length >= NOTE_LIMIT) { res.statusCode = 400; return res.end(JSON.stringify({ error: "inbox is full" })); }
      const text = String(body.text || "").trim().slice(0, 300);
      if (!text) { res.statusCode = 400; return res.end(JSON.stringify({ error: "write something first" })); }
      const from = body.from === "B" ? "B" : "A";
      couple.notes.unshift({
        id: Math.random().toString(36).slice(2, 10),
        from, text,
        readAt: null,
        createdAt: new Date().toISOString(),
      });
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "readNote") {
      const note = couple.notes.find((x) => x.id === String(body.noteId || ""));
      if (note && !note.readAt) note.readAt = new Date().toISOString();
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "removeNote") {
      couple.notes = couple.notes.filter((x) => x.id !== String(body.noteId || ""));
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "submitDailyAnswer") {
      const date = dateOk(body.date) ? body.date : new Date().toISOString().slice(0, 10);
      const text = String(body.text || "").trim().slice(0, 400);
      if (!text) { res.statusCode = 400; return res.end(JSON.stringify({ error: "write something first" })); }
      const who = body.who === "B" ? "B" : "A";
      const entry = couple.dailyAnswers[date] || {};
      entry[who] = { text, at: new Date().toISOString() };
      couple.dailyAnswers[date] = entry;
      const keys = Object.keys(couple.dailyAnswers).sort();
      if (keys.length > DAILY_HISTORY_LIMIT) {
        for (const k of keys.slice(0, keys.length - DAILY_HISTORY_LIMIT)) delete couple.dailyAnswers[k];
      }
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "addAlarm") {
      if (couple.alarms.length >= ALARM_LIMIT) { res.statusCode = 400; return res.end(JSON.stringify({ error: "too many reminders" })); }
      if (!timeOk(body.time)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad time" })); }
      const tzWho = body.tzWho === "B" ? "B" : "A";
      const notifyWho = body.notifyWho === "B" ? "B" : "A";
      const label = String(body.label || "").trim().slice(0, 60) || "reminder";
      couple.alarms.push({
        id: Math.random().toString(36).slice(2, 10),
        tzWho, notifyWho, time: body.time, label,
        createdBy: String(body.createdBy || "").trim().slice(0, 24) || "someone",
        createdAt: new Date().toISOString(),
      });
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "removeAlarm") {
      couple.alarms = couple.alarms.filter((x) => x.id !== String(body.alarmId || ""));
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
