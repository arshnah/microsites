// GET  -> current { p1, p2 } (raw markdown), consumed by the /now page and /edit.
// POST -> { key, p1, p2 } saves it. Gated by FOCUS_KEY so only the owner can write.

const { getFocus, setFocus } = require("./_focus");

function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 4000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "POST") {
    const body = await readBody(req);
    const key = process.env.FOCUS_KEY;
    if (!key || body.key !== key) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: "wrong key" }));
    }
    const p1 = String(body.p1 || "").trim().slice(0, 400);
    const p2 = String(body.p2 || "").trim().slice(0, 400);
    if (!p1) { res.statusCode = 400; return res.end(JSON.stringify({ error: "the first line can't be empty" })); }
    try {
      await setFocus(p1, p2);
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: "couldn't save — is Vercel KV connected to this project?" }));
    }
    return res.end(JSON.stringify({ ok: true, p1, p2 }));
  }

  res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=10");
  res.end(JSON.stringify(await getFocus()));
};
