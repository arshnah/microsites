// A shared couple's space keyed by slug: names, the day it started, a hub of
// linked mixtapes, and a memory timeline. No login — the slug in the link is
// the shared secret, same trust model as mixtape and scratch. Anyone with
// the link can read and add to it.

const { kvGet, kvSet, kvDelete, configured } = require("./_kv");

const MIXTAPE_LIMIT = 50;
const MEMORY_LIMIT = 200;
const EVENT_LIMIT = 100;
const NOTE_LIMIT = 100;
const DAILY_HISTORY_LIMIT = 120;
const ALARM_LIMIT = 20;
const PING_HISTORY_LIMIT = 120;
const MOOD_HISTORY_LIMIT = 120;
const VIBE_LIMIT = 40;
const CHAT_LIMIT = 300;
const ALBUM_LIMIT = 150;
const ALBUM_COMMENT_LIMIT = 60;
const FAVORITE_KEYS = ["snacks", "comfortFood", "song", "movie", "place", "color", "season", "drink", "hobby", "smell"];
const MOODS = ["🥰", "😊", "😌", "😐", "😴", "😔", "😢", "😤", "🤒", "🥳", "😰", "🥱"];
const NOTE_COLORS = ["#f6e58d", "#ffb8b8", "#b8e0d2", "#d0b8ff", "#b8d4ff", "#ffd8a8"];
const VIBE_TYPES = ["hug", "missing"];
const WYR_PROMPTS = [
  ["always be 10 minutes late", "always be 10 minutes early"],
  ["lose the ability to text", "lose the ability to call"],
  ["have a movie night every week", "have a game night every week"],
  ["only eat sweet food", "only eat savory food"],
  ["get one long trip a year", "get one long weekend a month"],
  ["always know what I'm thinking", "always know what I need"],
  ["fight over the thermostat", "fight over the playlist"],
  ["have a shared journal", "have a shared photo album"],
  ["cook together badly", "order in every time"],
  ["get surprise flowers", "get a surprise voice note"],
  ["live 5 min apart", "live in the same building"],
  ["have matching pajamas", "have matching mugs"],
  ["binge a show together", "binge a show separately then talk about it"],
  ["wake up early together", "stay up late together"],
  ["never forget an anniversary", "never forget a small promise"],
  ["always split the bill", "always take turns paying"],
  ["get a pet together", "get a plant together"],
  ["slow dance in the kitchen", "have a pillow fight"],
  ["send good morning texts daily", "send good night texts daily"],
  ["plan every trip in detail", "wing every trip"],
];
const slugOk = (s) => /^[a-z0-9-]{3,40}$/.test(s || "");
const dateOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const timeOk = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || "");
const urlOk = (s) => typeof s === "string" && s.length < 600 && /^https?:\/\//.test(s);

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
        moods: {},
        watchParty: null,
        birthdayA: dateOk(body.birthdayA) ? body.birthdayA : null,
        birthdayB: dateOk(body.birthdayB) ? body.birthdayB : null,
        favorites: { A: {}, B: {} },
        vibes: [],
        chat: { messages: [], typingA: null, typingB: null, readA: null, readB: null },
        wyr: { round: 0, prompt: null, answers: {} },
        album: [],
        factsDate: null,
      };
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (!couple) { res.statusCode = 404; return res.end(JSON.stringify({ error: "no space at that link" })); }
    if (!("tzA" in couple)) { couple.tzA = null; couple.tzB = null; couple.lastPing = null; }
    if (!couple.events) couple.events = [];
    if (!couple.notes) couple.notes = [];
    if (!couple.dailyAnswers) couple.dailyAnswers = {};
    if (!couple.moods) couple.moods = {};
    if (couple.watchParty === undefined) couple.watchParty = null;
    if (!couple.alarms) couple.alarms = [];
    if (!couple.pingLog) couple.pingLog = {};
    if (couple.birthdayA === undefined) couple.birthdayA = null;
    if (couple.birthdayB === undefined) couple.birthdayB = null;
    if (!couple.favorites) couple.favorites = { A: {}, B: {} };
    if (!couple.vibes) couple.vibes = [];
    if (!couple.chat) couple.chat = { messages: [], typingA: null, typingB: null, readA: null, readB: null };
    if (!couple.wyr) couple.wyr = { round: 0, prompt: null, answers: {} };
    if (!couple.album) couple.album = [];

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
      const color = NOTE_COLORS.includes(body.color) ? body.color : NOTE_COLORS[0];
      couple.notes.unshift({
        id: Math.random().toString(36).slice(2, 10),
        from, text, color,
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

    if (action === "setMood") {
      const mood = String(body.mood || "");
      if (!MOODS.includes(mood)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "not a valid mood" })); }
      const who = body.who === "B" ? "B" : "A";
      const date = dateOk(body.date) ? body.date : new Date().toISOString().slice(0, 10);
      const entry = couple.moods[date] || {};
      entry[who] = { mood, at: new Date().toISOString() };
      couple.moods[date] = entry;
      const days = Object.keys(couple.moods).sort();
      if (days.length > MOOD_HISTORY_LIMIT) {
        for (const d of days.slice(0, days.length - MOOD_HISTORY_LIMIT)) delete couple.moods[d];
      }
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "setWatchParty") {
      const title = String(body.title || "").trim().slice(0, 100);
      if (!title) { res.statusCode = 400; return res.end(JSON.stringify({ error: "give it a title" })); }
      const when = String(body.when || "").trim().slice(0, 30);
      couple.watchParty = {
        title, when: when || null,
        note: body.note ? String(body.note).trim().slice(0, 200) : "",
        readyA: false, readyB: false,
        createdAt: new Date().toISOString(),
      };
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "toggleWatchReady") {
      if (!couple.watchParty) { res.statusCode = 400; return res.end(JSON.stringify({ error: "no watch party set" })); }
      const who = body.who === "B" ? "B" : "A";
      const key = who === "B" ? "readyB" : "readyA";
      couple.watchParty[key] = !couple.watchParty[key];
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "clearWatchParty") {
      couple.watchParty = null;
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "updateSettings") {
      const nameA = String(body.nameA || "").trim().slice(0, 30);
      const nameB = String(body.nameB || "").trim().slice(0, 30);
      if (!nameA || !nameB) { res.statusCode = 400; return res.end(JSON.stringify({ error: "both names please" })); }
      if (!dateOk(body.startDate)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad start date" })); }
      couple.nameA = nameA;
      couple.nameB = nameB;
      couple.startDate = body.startDate;
      couple.birthdayA = body.birthdayA ? (dateOk(body.birthdayA) ? body.birthdayA : couple.birthdayA) : null;
      couple.birthdayB = body.birthdayB ? (dateOk(body.birthdayB) ? body.birthdayB : couple.birthdayB) : null;
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "deleteSpace") {
      await kvDelete("couple:" + s);
      return res.end(JSON.stringify({ ok: true }));
    }

    if (action === "setFavorite") {
      const who = body.who === "B" ? "B" : "A";
      const key = String(body.key || "");
      if (!FAVORITE_KEYS.includes(key)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "not a valid category" })); }
      const value = String(body.value || "").trim().slice(0, 60);
      if (!couple.favorites[who]) couple.favorites[who] = {};
      if (value) couple.favorites[who][key] = value; else delete couple.favorites[who][key];
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "sendVibe") {
      const from = body.from === "B" ? "B" : "A";
      const type = String(body.type || "");
      if (!VIBE_TYPES.includes(type)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "not a valid vibe" })); }
      couple.vibes.push({ id: Math.random().toString(36).slice(2, 10), from, type, at: new Date().toISOString() });
      if (couple.vibes.length > VIBE_LIMIT) couple.vibes = couple.vibes.slice(-VIBE_LIMIT);
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "sendMessage") {
      const from = body.from === "B" ? "B" : "A";
      const text = String(body.text || "").trim().slice(0, 500);
      const imageUrl = body.imageUrl ? String(body.imageUrl).slice(0, 600) : null;
      const voiceUrl = body.voiceUrl ? String(body.voiceUrl).slice(0, 600) : null;
      if (!text && !imageUrl && !voiceUrl) { res.statusCode = 400; return res.end(JSON.stringify({ error: "write something first" })); }
      couple.chat.messages.push({
        id: Math.random().toString(36).slice(2, 10),
        from, text, imageUrl, voiceUrl,
        reactions: {},
        at: new Date().toISOString(),
      });
      if (couple.chat.messages.length > CHAT_LIMIT) couple.chat.messages = couple.chat.messages.slice(-CHAT_LIMIT);
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "addReaction") {
      const msg = couple.chat.messages.find((x) => x.id === String(body.messageId || ""));
      if (!msg) { res.statusCode = 404; return res.end(JSON.stringify({ error: "message not found" })); }
      const emoji = String(body.emoji || "").slice(0, 8);
      const who = body.who === "B" ? "B" : "A";
      if (!emoji) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad reaction" })); }
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      const idx = msg.reactions[emoji].indexOf(who);
      if (idx === -1) msg.reactions[emoji].push(who); else msg.reactions[emoji].splice(idx, 1);
      if (!msg.reactions[emoji].length) delete msg.reactions[emoji];
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "setTyping") {
      const who = body.who === "B" ? "B" : "A";
      couple.chat[who === "B" ? "typingB" : "typingA"] = body.typing ? new Date().toISOString() : null;
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "markChatRead") {
      const who = body.who === "B" ? "B" : "A";
      couple.chat[who === "B" ? "readB" : "readA"] = new Date().toISOString();
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "wyrNewRound") {
      let idx = Math.floor(Math.random() * WYR_PROMPTS.length);
      if (couple.wyr.prompt && WYR_PROMPTS.length > 1) {
        while (WYR_PROMPTS[idx].join("|") === couple.wyr.prompt.join("|")) idx = Math.floor(Math.random() * WYR_PROMPTS.length);
      }
      couple.wyr = { round: (couple.wyr.round || 0) + 1, prompt: WYR_PROMPTS[idx], answers: {} };
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "wyrAnswer") {
      if (!couple.wyr.prompt) { res.statusCode = 400; return res.end(JSON.stringify({ error: "no round in progress" })); }
      const who = body.who === "B" ? "B" : "A";
      const choice = body.choice === 1 ? 1 : 0;
      couple.wyr.answers[who] = { choice, at: new Date().toISOString() };
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "addAlbumPhoto") {
      if (couple.album.length >= ALBUM_LIMIT) { res.statusCode = 400; return res.end(JSON.stringify({ error: "album is full" })); }
      if (!urlOk(body.url)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad image" })); }
      couple.album.unshift({
        id: Math.random().toString(36).slice(2, 10),
        url: body.url,
        caption: String(body.caption || "").trim().slice(0, 200),
        addedBy: String(body.addedBy || "").trim().slice(0, 24) || "someone",
        addedAt: new Date().toISOString(),
        comments: [],
      });
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "removeAlbumPhoto") {
      couple.album = couple.album.filter((x) => x.id !== String(body.photoId || ""));
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "addAlbumComment") {
      const photo = couple.album.find((x) => x.id === String(body.photoId || ""));
      if (!photo) { res.statusCode = 404; return res.end(JSON.stringify({ error: "photo not found" })); }
      const text = String(body.text || "").trim().slice(0, 200);
      if (!text) { res.statusCode = 400; return res.end(JSON.stringify({ error: "write something first" })); }
      if (!photo.comments) photo.comments = [];
      if (photo.comments.length >= ALBUM_COMMENT_LIMIT) { res.statusCode = 400; return res.end(JSON.stringify({ error: "too many comments" })); }
      photo.comments.push({ id: Math.random().toString(36).slice(2, 10), text, by: String(body.by || "").trim().slice(0, 24) || "someone", at: new Date().toISOString() });
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "removeAlbumComment") {
      const photo = couple.album.find((x) => x.id === String(body.photoId || ""));
      if (photo && photo.comments) photo.comments = photo.comments.filter((x) => x.id !== String(body.commentId || ""));
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "setWatchUrl") {
      const yt = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/.exec(String(body.url || ""));
      const isDrive = /drive\.google\.com\//.test(String(body.url || ""));
      if (!yt && !isDrive) { res.statusCode = 400; return res.end(JSON.stringify({ error: "paste a YouTube or Google Drive link" })); }
      couple.watchParty = couple.watchParty || { title: "", when: null, note: "", readyA: false, readyB: false, createdAt: new Date().toISOString() };
      couple.watchParty.videoKind = yt ? "youtube" : "drive";
      couple.watchParty.videoId = yt ? yt[1] : null;
      couple.watchParty.videoUrl = String(body.url || "").slice(0, 600);
      couple.watchParty.playing = false;
      couple.watchParty.position = 0;
      couple.watchParty.updatedAt = new Date().toISOString();
      await kvSet("couple:" + s, couple);
      return res.end(JSON.stringify({ ok: true, couple }));
    }

    if (action === "watchControl") {
      if (!couple.watchParty || (!couple.watchParty.videoId && couple.watchParty.videoKind !== "drive")) {
        res.statusCode = 400; return res.end(JSON.stringify({ error: "no video set" }));
      }
      const type = String(body.type || "");
      if (type === "play") couple.watchParty.playing = true;
      else if (type === "pause") couple.watchParty.playing = false;
      else if (type === "seek") { /* position updates below */ }
      else { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad control" })); }
      if (typeof body.position === "number" && isFinite(body.position)) couple.watchParty.position = Math.max(0, body.position);
      couple.watchParty.updatedAt = new Date().toISOString();
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
