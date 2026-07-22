// Checks the embed proxy's logic. Pure functions, no server needed.
//
//     node test-embed.mjs          offline checks only
//     node test-embed.mjs --live   also hits cdn.syndication.twimg.com once
import { createRequire } from 'node:module';
const E = createRequire(import.meta.url)('./api/_embed.js');

let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
};

console.log('--- who gets the tags ---');
for (const ua of [
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'Twitterbot/1.0',
  'WhatsApp/2.23',
  'TelegramBot (like TwitterBot)',
  'facebookexternalhit/1.1',
  'Slackbot-LinkExpanding 1.0',
]) {
  check(`crawler: ${ua.slice(0, 28)}`, E.isCrawler(ua));
}
for (const ua of [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari',
  '',
]) {
  check(`human: ${(ua || '(empty)').slice(0, 28)}`, !E.isCrawler(ua));
}

console.log('\n--- picking the video ---');
const variants = {
  aspectRatio: [9, 16],
  variants: [
    { type: 'application/x-mpegURL', src: 'https://video.twimg.com/a/pl/x.m3u8' },
    { type: 'video/mp4', src: 'https://video.twimg.com/amplify_video/1/vid/avc1/320x568/a.mp4' },
    { type: 'video/mp4', src: 'https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/b.mp4' },
  ],
};
const picked = E.pickVideo(variants);
check('HLS is never chosen', !picked.src.endsWith('.m3u8'), picked.src);
check('largest mp4 wins', picked.width === 720 && picked.height === 1280, `${picked.width}x${picked.height}`);
check('no variants means no video', E.pickVideo({ variants: [] }) === null);
check('undefined is survivable', E.pickVideo(undefined) === null);

const noDims = E.pickVideo({ aspectRatio: [1, 2], variants: [{ type: 'video/mp4', src: 'https://video.twimg.com/x.mp4' }] });
check('falls back to aspect ratio', noDims.width === 360 && noDims.height === 720, `${noDims.width}x${noDims.height}`);

console.log('\n--- media urls are pinned to twitter hosts ---');
check('twimg allowed', E.safeMediaUrl('https://video.twimg.com/a.mp4') !== null);
check('pbs allowed', E.safeMediaUrl('https://pbs.twimg.com/a.jpg') !== null);
check('other host refused', E.safeMediaUrl('https://evil.tld/a.mp4') === null);
check('lookalike refused', E.safeMediaUrl('https://video.twimg.com.evil.tld/a.mp4') === null);
check('http refused', E.safeMediaUrl('http://video.twimg.com/a.mp4') === null);
check('garbage refused', E.safeMediaUrl('not a url') === null);

console.log('\n--- a tweet cannot inject markup ---');
// Anyone can put anything in a display name, so every value is hostile input.
const nasty = E.summarise(
  {
    text: '"><script>alert(1)</script>',
    user: { name: 'evil" onload="x', screen_name: 'someone' },
    favorite_count: 5,
  },
  { user: 'someone', id: '1' },
);
const html = E.buildHtml(nasty);
check('no raw <script>', !html.includes('<script>'));
check('no attribute break-out', !html.includes('onload="x'));
check('quotes are escaped', html.includes('&quot;'));
check('the text still made it', html.includes('alert(1)'));

console.log('\n--- the tags discord needs ---');
const withVideo = E.buildHtml(
  E.summarise(
    {
      text: 'hi',
      user: { name: 'A', screen_name: 'a' },
      video: variants,
    },
    { user: 'a', id: '9' },
  ),
);
for (const tag of ['og:video"', 'og:video:type', 'og:video:width', 'og:video:height', 'twitter:card" content="player']) {
  check(`emits ${tag}`, withVideo.includes(tag));
}
const withImage = E.buildHtml(
  E.summarise({ text: 'hi', user: { name: 'A', screen_name: 'a' }, photos: [{ url: 'https://pbs.twimg.com/p.jpg' }] }, { user: 'a', id: '9' }),
);
check('image posts use summary_large_image', withImage.includes('summary_large_image'));
check('image posts emit no og:video', !withImage.includes('og:video'));
check('canonical points at x.com, not here', withImage.includes('https://x.com/a/status/9'));

if (process.argv.includes('--live')) {
  console.log('\n--- live: cdn.syndication.twimg.com ---');
  // Jack's first tweet. Old, public, and about as permanent as X gets.
  try {
    const r = await fetch(E.syndicationUrl('20'), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const body = await r.text();
    check('upstream answers 200', r.status === 200, String(r.status));
    check('and answers JSON, not an error page', body.trimStart().startsWith('{'));
    const s = E.summarise(JSON.parse(body), { user: 'jack', id: '20' });
    check('parses the author', s.handle === 'jack', s.handle);
    check('parses the text', s.text.includes('twttr'), s.text);
  } catch (e) {
    check('live fetch', false, e.message);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall embed cases pass');
process.exit(failures ? 1 : 0);
