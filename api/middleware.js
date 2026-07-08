export const config = { matcher: '/' }

const INFO = `
  api · api.arshnah.in

  the little serverless api behind arshnah.in.

    GET /api/discord-status   discord presence
    GET /api/now-playing      last.fm now playing
    GET /api/taste            music taste
    GET /api/contributions    github contributions
    GET /api/last-commit      latest commit
    GET /api/wrapped          year in music + code

  home  https://arshnah.in
`

export default function middleware(request) {
  const ua = request.headers.get('user-agent') || ''
  if (!/curl|wget|httpie|libcurl|lwp-request/i.test(ua)) return
  const m = ua.match(/curl\/([\d.]+)/i)
  const tail = m ? `  you're on curl/${m[1]}, i see you 😉\n` : ''
  return new Response(INFO + tail, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}
