interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const source =
      new URL(request.url).pathname === "/api/health"
        ? Response.json({ ok: true })
        : await env.ASSETS.fetch(request);
    const response = new Response(source.body, source);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Permissions-Policy", "bluetooth=(self)");
    // Vite injects its refresh preamble and styles only during local development.
    const sourcePolicy = import.meta.env.DEV
      ? "'self' 'unsafe-inline'"
      : "'self'";
    response.headers.set(
      "Content-Security-Policy",
      `default-src 'self'; script-src ${sourcePolicy}; style-src ${sourcePolicy}; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
    );
    return response;
  },
};
