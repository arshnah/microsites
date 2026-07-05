const fs = require("fs");
const path = require("path");

const cleanXml = (s) => s
  .replace(/&rsquo;/g, "’")
  .replace(/&ldquo;/g, "“")
  .replace(/&rdquo;/g, "”")
  .replace(/&middot;/g, "·")
  .replace(/&nbsp;/g, " ");

function getFocusText() {
  try {
    const htmlPath = path.join(__dirname, "../index.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    const focusMatch = html.match(/<div class="focus">([\s\S]*?)<div class="sect">/);
    if (!focusMatch) return null;
    const pMatches = [...focusMatch[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
    return pMatches.map(m => cleanXml(m[1]).trim());
  } catch (e) {
    return null;
  }
}

function svg(paragraphs) {
  const W = 480, P = 22;
  const p1 = (paragraphs && paragraphs[0]) || "";
  const p2 = (paragraphs && paragraphs[1]) ? `<p style="margin:0;color:#8b93a1;font-size:12.5px;">${paragraphs[1]}</p>` : "";
  
  const focusHeight = (paragraphs && paragraphs.length > 1) ? 104 : 65;
  const H = 18 + focusHeight + 20;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">
<style>
  .card { fill: #14171c; stroke: #232830; stroke-width: 1.5; }
</style>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" class="card"/>
<rect x="1" y="1" width="${W - 2}" height="5" rx="2.5" fill="#8fb6ff" opacity="0.9"/>
<foreignObject x="${P}" y="18" width="${W - 2 * P}" height="${focusHeight}">
  <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#8b93a1;font-size:14px;line-height:1.5;">
    <div style="color:#5a626e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px;">WHAT I'M FOCUSED ON</div>
    <p style="margin:0 0 5px;color:#e8ebf0;">${p1}</p>
    ${p2}
  </div>
</foreignObject>
</svg>`;
}

module.exports = async (req, res) => {
  const paragraphs = getFocusText();
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=10");
  res.end(svg(paragraphs));
};
