export const config = { matcher: '/' }

const INFO = `
  wrapped · wrapped.arshnah.in

  my year wrapped. the music i played and the code i shipped, together.

  browser  https://wrapped.arshnah.in
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
