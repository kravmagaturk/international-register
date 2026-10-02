const ADMIN_SOURCE = "https://raw.githubusercontent.com/kravmagaturk/international-register/ce3ddd33e3b6e0411408b674a9af33377a665d0f/kmt-secure-8f3c2d-admin.html";

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/kmt-admin" && url.pathname !== "/kmt-admin/") {
      return withSecurityHeaders(new Response("Not found", { status: 404 }));
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return withSecurityHeaders(new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" }
      }));
    }
    const source = await fetch(ADMIN_SOURCE, { headers: { "Cache-Control": "no-store" } });
    if (!source.ok) return withSecurityHeaders(new Response("Admin source unavailable", { status: 502 }));
    let html = await source.text();
    html = html.replace("<head>", "<head>\n<base href=\"https://kravmagaturk.github.io/international-register/\">");
    return withSecurityHeaders(new Response(request.method === "HEAD" ? null : html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    }));
  }
};
