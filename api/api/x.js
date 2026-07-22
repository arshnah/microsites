// Link-embed proxy for X/Twitter posts.
//
//   https://api.arshnah.in/x/DevSonpal/status/2079913673573929015
//
// A crawler gets Open Graph tags with the video; a person gets a 302 to x.com
// and never sees a page from here at all. That split is the whole design — it
// keeps this a metadata proxy rather than a mirror, and means no media, no
// bandwidth and no storage ever touch this deployment. og:video points at
// video.twimg.com, so Discord fetches from Twitter exactly as it would have.
//
// Fragile by nature: cdn.syndication.twimg.com is not a public API and the
// token is derived, not issued. When Twitter changes either, every embed here
// stops at once. This is a thing to maintain, not a thing to ship and forget.

const { isCrawler, syndicationUrl, summarise, buildHtml } = require('./_embed');

// Tweet ids are snowflakes: digits, and nowhere near 30 of them. Bounding the
// length stops a silly-long path becoming a silly-long upstream request.
const ID = /^\d{1,25}$/;
const HANDLE = /^[A-Za-z0-9_]{1,20}$/;

module.exports = async (req, res) => {
  const url = new URL(req.url, 'https://api.arshnah.in');
  const id = url.searchParams.get('id') || '';
  const user = url.searchParams.get('user') || '';

  if (!ID.test(id) || (user && !HANDLE.test(user))) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('usage: /x/<handle>/status/<id>\n');
  }

  const canonical = `https://x.com/${user || 'i'}/status/${id}`;

  // Humans leave before anything is fetched. Doing this first also means a
  // Twitter outage cannot break the ordinary case of someone clicking a link.
  if (!isCrawler(req.headers['user-agent'])) {
    res.statusCode = 302;
    res.setHeader('Location', canonical);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end();
  }

  try {
    const upstream = await fetch(syndicationUrl(id), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; arshnah-embed/1.0; +https://arshnah.in)' },
    });

    // A deleted, private or age-gated tweet answers with an HTML error page
    // rather than JSON. Sending the crawler onward is better than serving it
    // tags built from nothing.
    const body = await upstream.text();
    if (!upstream.ok || !body.trimStart().startsWith('{')) throw new Error(`upstream ${upstream.status}`);

    const summary = summarise(JSON.parse(body), { user, id });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // A tweet's media does not change, so this is cacheable for a long time.
    // The cache is also the main thing keeping this deployment off Twitter's
    // rate limits: one fetch serves every Discord client that sees the link.
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    return res.end(buildHtml(summary));
  } catch {
    // Never a 500. A crawler that gets an error renders nothing at all, while
    // a redirect at least lets it try the real site.
    res.statusCode = 302;
    res.setHeader('Location', canonical);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.end();
  }
};
