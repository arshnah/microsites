const { getFocus, mdToHtml } = require("./_focus");
const { W, PAD, MONO, header, frame, pick } = require("./_theme");

function svg(focus, t) {
  const p1 = mdToHtml(focus.p1 || "");
  const p2 = focus.p2 ? mdToHtml(focus.p2) : "";

  // rough wrap estimate at 14px mono across the content width, so the box grows
  // with the text instead of clipping it
  const cols = Math.floor((W - PAD * 2) / 8.4);
  const lines = (s) => Math.max(1, Math.ceil(s.replace(/<[^>]*>/g, "").length / cols));
  const bodyH = lines(p1) * 24 + (p2 ? lines(p2) * 24 + 10 : 0);
  const top = 74;
  const H = top + bodyH + 22;

  const second = p2
    ? `<p style="margin:10px 0 0;color:${t.mut};">${p2}</p>`
    : "";

  return frame(H, t,
    header("arshnah@focus", "now.arshnah.in", 46, t) +
    `<foreignObject x="${PAD}" y="${top - 22}" width="${W - PAD * 2}" height="${bodyH + 12}">
  <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:${MONO};font-size:14px;line-height:1.65;color:${t.ink};">
    <p style="margin:0;">${p1}</p>
    ${second}
  </div>
</foreignObject>`);
}

module.exports = async (req, res) => {
  const t = pick(req);
  const focus = await getFocus();
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=10");
  res.end(svg(focus, t));
};
