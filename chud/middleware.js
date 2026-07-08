export const config = { matcher: '/' }

const INFO = `
  chud · chud.arshnah.in

  chudGPT. ask it anything. it only ever replies "chud". state of the art.

  browser  https://chud.arshnah.in
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
