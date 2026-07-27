const { getFocus, mdToHtml } = require('./_focus');
const { W, PAD, VALX, CW, MONO, header, frame, pick } = require('./_theme');

// The other cards in the stack are all `. label:  value`. Focus is prose rather
// than a lookup, but it lines up on the same two columns so it reads as another
// row of the same table instead of a paragraph that wandered in.
function svg(focus, t) {
  const p1 = mdToHtml(focus.p1 || '');
  const p2 = focus.p2 ? mdToHtml(focus.p2) : '';

  const textW = W - VALX - PAD;
  const cols = Math.floor(textW / (CW * 1.02));
  const lines = (s) => Math.max(1, Math.ceil(s.replace(/<[^>]*>/g, '').length / cols));

  const y0 = 84;
  const h1 = lines(p1) * 23;
  const y2 = y0 + h1 + 14;
  const h2 = p2 ? lines(p2) * 23 : 0;
  const H = (p2 ? y2 + h2 : y0 + h1) + 22;

  const block = (html, y, h, cls) => `<foreignObject x="${VALX}" y="${y - 15}" width="${textW}" height="${h + 8}">
  <div xmlns="http://www.w3.org/1999/xhtml" style="font:400 14px ${MONO};line-height:23px;color:${cls};">${html}</div>
</foreignObject>`;

  const rows =
    `<text x="${PAD}" y="${y0}" class="bul">.</text>` +
    `<text x="${PAD + CW * 1.6}" y="${y0}" class="k">now:</text>` +
    block(p1, y0, h1, t.ink) +
    (p2
      ? `<text x="${PAD}" y="${y2}" class="bul">.</text>` +
        `<text x="${PAD + CW * 1.6}" y="${y2}" class="k">open:</text>` +
        block(p2, y2, h2, t.mut)
      : '');

  return frame(H, t, header('arshnah@focus', 'now.arshnah.in', 46, t) + '\n' + rows);
}

module.exports = async (req, res) => {
  const t = pick(req);
  const focus = await getFocus();
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5, stale-while-revalidate=10');
  res.end(svg(focus, t));
};
