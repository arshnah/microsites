// Shared "what I'm focused on" store (leading _ so Vercel ignores it as a route).
// Text lives in Vercel KV (Upstash REST) so it can be edited from /edit without a
// redeploy. If KV isn't configured yet, everything falls back to DEFAULT, so the
// card and page keep working out of the box.

const DEFAULT = {
  p1: "Building **Wisp**, an end-to-end encrypted chat where even files and gifs never hit a server in the clear, running **a webring** ([larpring](https://ring.arshnah.in)), and shipping small dumb websites like the one you're on.",
  p2: "Open for work. If it needs to go from an empty folder to live on the internet, that's the job.",
};

const KEY = "arsh:focus";
const url = () => process.env.KV_REST_API_URL;
const tok = () => process.env.KV_REST_API_TOKEN;
const configured = () => Boolean(url() && tok());

async function getFocus() {
  if (!configured()) return { ...DEFAULT };
  try {
    const r = await fetch(`${url()}/get/${KEY}`, { headers: { Authorization: `Bearer ${tok()}` }, cache: "no-store" });
    const j = await r.json();
    if (j && j.result) {
      const o = JSON.parse(j.result);
      return { p1: o.p1 || DEFAULT.p1, p2: o.p2 == null ? DEFAULT.p2 : o.p2 };
    }
  } catch (e) { /* fall through to default */ }
  return { ...DEFAULT };
}

async function setFocus(p1, p2) {
  if (!configured()) throw new Error("KV not configured");
  const r = await fetch(`${url()}/set/${KEY}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok()}`, "Content-Type": "text/plain" },
    body: JSON.stringify({ p1, p2 }),
  });
  if (!r.ok) throw new Error("KV write failed");
}

// Tiny, XML-safe markdown: escape, then **bold** and [text](url). Owner-only input
// (edits are key-gated), and escaping first keeps the SVG foreignObject well-formed.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function mdToHtml(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

module.exports = { DEFAULT, getFocus, setFocus, mdToHtml, esc, configured };
