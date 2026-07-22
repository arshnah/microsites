// Shared logic for the link-embed proxy. Pure functions only, so the whole
// thing is testable without a network or a Vercel request.
//
// The idea, in one line: serve rich Open Graph tags to crawlers and send
// humans straight to the original site. Nothing is mirrored — og:video points
// at Twitter's own CDN, so no media passes through this deployment.

// Crawlers that render link previews. Everything else is treated as a person.
//
// Deliberately a whitelist, not a "does it look like a browser" guess: getting
// it backwards would show a scraped page to a reader instead of redirecting
// them, which is the one behaviour that turns this from a metadata proxy into
// a mirror of someone else's site.
const CRAWLERS =
  /(discordbot|twitterbot|slackbot|slack-imgproxy|telegrambot|whatsapp|facebookexternalhit|facebot|linkedinbot|redditbot|embedly|quora link preview|pinterest|vkshare|skypeuripreview|bitlybot|nuzzel|bufferbot|google-structured-data|iframely|mastodon|misskey|revolt|matrix|signal|ogp|opengraph|metainspector)/i;

function isCrawler(userAgent) {
  return CRAWLERS.test(String(userAgent || ''));
}

/**
 * The token Twitter's syndication endpoint wants.
 *
 * Undocumented and derived from the tweet id. This is the single most fragile
 * thing here: it is not a public API, and when Twitter changes it every embed
 * stops working at once. That is a maintenance commitment, not a one-off.
 */
function syndicationToken(id) {
  return ((Number(id) / 1e6) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, '');
}

function syndicationUrl(id) {
  return `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(id)}&token=${syndicationToken(id)}&lang=en`;
}

/**
 * Best MP4 from the variant list.
 *
 * The list also carries an `application/x-mpegURL` HLS playlist, which Discord
 * cannot play — handing it one produces a preview that looks broken rather
 * than one that is missing. MP4 only, largest frame first, since the URLs
 * carry their own dimensions (.../vid/avc1/720x1280/...).
 */
function pickVideo(video) {
  const variants = (video?.variants ?? []).filter((v) => v.type === 'video/mp4' && v.src);
  if (!variants.length) return null;

  const sized = variants.map((v) => {
    const m = /\/(\d+)x(\d+)\//.exec(v.src);
    return { src: v.src, width: m ? Number(m[1]) : 0, height: m ? Number(m[2]) : 0 };
  });
  sized.sort((a, b) => b.width * b.height - a.width * a.height);

  const best = sized[0];
  if (best.width && best.height) return best;

  // No dimensions in the URL: fall back to the aspect ratio, which is a pair
  // of relative numbers rather than pixels, so it needs a scale to be useful.
  const [aw, ah] = video?.aspectRatio ?? [];
  if (aw && ah) {
    const scale = 720 / Math.max(aw, ah);
    return { src: best.src, width: Math.round(aw * scale), height: Math.round(ah * scale) };
  }
  return { src: best.src, width: 720, height: 720 };
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape for an HTML attribute.
 *
 * Every value below comes from Twitter, which means it is attacker-controlled
 * in the only sense that matters: anyone can put anything in a tweet. A raw
 * quote in a display name would otherwise close the content attribute and let
 * the rest of the name become markup.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Only ever emit URLs on hosts Twitter actually serves media from. */
const MEDIA_HOSTS = /^(pbs\.twimg\.com|video\.twimg\.com|abs\.twimg\.com)$/i;

function safeMediaUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && MEDIA_HOSTS.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Normalise the syndication payload into just what the tags need. */
function summarise(tweet, { user, id }) {
  const author = tweet?.user ?? {};
  const name = author.name || user || 'X';
  const handle = author.screen_name || user || '';
  const video = pickVideo(tweet?.video);
  const videoSrc = video && safeMediaUrl(video.src);
  const photo = (tweet?.photos ?? [])[0];
  const photoSrc = photo && safeMediaUrl(photo.url ?? photo.src);
  const poster = tweet?.video?.poster && safeMediaUrl(tweet.video.poster);

  return {
    id,
    name,
    handle,
    text: tweet?.text ?? '',
    likes: Number(tweet?.favorite_count) || 0,
    replies: Number(tweet?.conversation_count) || 0,
    canonical: `https://x.com/${handle || user}/status/${id}`,
    video: videoSrc ? { ...video, src: videoSrc } : null,
    image: photoSrc || poster || null,
  };
}

/**
 * The document a crawler gets.
 *
 * Kept to meta tags and a link. There is no page here for a person to read,
 * because a person is never served this — they are redirected before it is
 * built.
 *
 * og:video needs an explicit type AND width AND height or Discord silently
 * downgrades to a still image, which is the single most common reason one of
 * these proxies "doesn't work".
 */
function buildHtml(s) {
  const title = s.handle ? `${s.name} (@${s.handle})` : s.name;
  const footer = [
    s.likes ? `${s.likes.toLocaleString('en-IN')} likes` : null,
    s.replies ? `${s.replies.toLocaleString('en-IN')} replies` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const description = [s.text, footer].filter(Boolean).join('\n\n');

  const tags = [
    `<meta charset="utf-8">`,
    `<title>${esc(title)}</title>`,
    `<meta property="og:site_name" content="arshnah.in · x">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(s.canonical)}">`,
    `<meta name="theme-color" content="#000000">`,
  ];

  if (s.video) {
    tags.push(
      `<meta name="twitter:card" content="player">`,
      `<meta property="og:type" content="video.other">`,
      `<meta property="og:video" content="${esc(s.video.src)}">`,
      `<meta property="og:video:secure_url" content="${esc(s.video.src)}">`,
      `<meta property="og:video:type" content="video/mp4">`,
      `<meta property="og:video:width" content="${s.video.width}">`,
      `<meta property="og:video:height" content="${s.video.height}">`,
    );
    if (s.image) tags.push(`<meta property="og:image" content="${esc(s.image)}">`);
  } else if (s.image) {
    tags.push(
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta property="og:type" content="article">`,
      `<meta property="og:image" content="${esc(s.image)}">`,
    );
  } else {
    tags.push(`<meta name="twitter:card" content="summary">`, `<meta property="og:type" content="article">`);
  }

  return `<!doctype html><html lang="en"><head>${tags.join('')}</head><body><a href="${esc(s.canonical)}">${esc(s.canonical)}</a></body></html>`;
}

module.exports = {
  isCrawler,
  syndicationToken,
  syndicationUrl,
  pickVideo,
  esc,
  safeMediaUrl,
  summarise,
  buildHtml,
};
