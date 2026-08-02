export const config = { matcher: '/' }

const INFO = `
  orbit · orbit.arshnah.in

  a live directory of everything arshnah runs. distance from center is
  time since last commit — close is fresh, drifting out is stale.

  browser  https://orbit.arshnah.in
  home     https://arshnah.in
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
