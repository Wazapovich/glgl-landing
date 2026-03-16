// Proxy Firebase Auth handler requests to firebaseapp.com
// This allows authDomain=glgl.app to work on Cloudflare Pages
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const firebaseUrl = `https://mindstack-c5a42.firebaseapp.com${url.pathname}${url.search}`;

  const headers = new Headers(context.request.headers);
  headers.delete('host');

  const response = await fetch(firebaseUrl, {
    method: context.request.method,
    headers,
    body: context.request.method !== 'GET' ? context.request.body : undefined,
    redirect: 'manual',
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('x-frame-options');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
