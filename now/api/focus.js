const { getFocus, mdToHtml } = require("./_focus");

// palettes — ?theme=light serves the light card (via <picture> in the readme)
const THEMES = {
  dark:  { bg: "#14171c", stroke: "#232830", accent: "#8fb6ff", ink: "#e8ebf0", mut: "#8b93a1", faint: "#5a626e" },
  light: { bg: "#ffffff", stroke: "#d0d7de", accent: "#4f7fd1", ink: "#1f2328", mut: "#57606a", faint: "#8c959f" },
};

function svg(focus, t) {
  const W = 480, P = 22;
  const p1 = mdToHtml(focus.p1 || "");
  const p2 = focus.p2 ? `<p style="margin:0;color:${t.mut};font-size:12.5px;">${mdToHtml(focus.p2)}</p>` : "";

  const focusHeight = focus.p2 ? 104 : 65;
  const H = 18 + focusHeight + 20;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">
<style>
  .card { fill: ${t.bg}; stroke: ${t.stroke}; stroke-width: 1.5; }
</style>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" class="card"/>
<rect x="1" y="1" width="${W - 2}" height="5" rx="2.5" fill="${t.accent}" opacity="0.9"/>
<foreignObject x="${P}" y="18" width="${W - 2 * P}" height="${focusHeight}">
  <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:${t.mut};font-size:14px;line-height:1.5;">
    <div style="color:${t.faint};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px;">WHAT I'M FOCUSED ON</div>
    <p style="margin:0 0 5px;color:${t.ink};">${p1}</p>
    ${p2}
  </div>
</foreignObject>
</svg>`;
}

module.exports = async (req, res) => {
  const theme = new URL(req.url, "http://x").searchParams.get("theme") === "light" ? "light" : "dark";
  const focus = await getFocus();
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5, stale-while-revalidate=10");
  res.end(svg(focus, THEMES[theme]));
};
