import { expect, it, vi } from "vitest";
import worker from "./worker";
it.each(["/", "/mapping/edit", "/assets/app.js"])(
  "adds security headers to %s",
  async (path) => {
    const fetch = vi.fn(
      async () =>
        new Response("asset", {
          headers: {
            "Content-Type": path.endsWith(".js")
              ? "application/javascript"
              : "text/html",
          },
        }),
    );
    const response = await worker.fetch(
      new Request(`https://example.com${path}`),
      { ASSETS: { fetch } },
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(response.headers.get("Permissions-Policy")).toBe("bluetooth=(self)");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("Content-Security-Policy")).not.toContain(
      "unsafe-eval",
    );
    expect(await response.text()).toBe("asset");
  },
);
it("health does not include request data", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/health?private=value"),
    { ASSETS: { fetch: vi.fn() } },
  );
  expect(await response.json()).toEqual({ ok: true });
});
it("allows the inline development refresh preamble only in development", async () => {
  const response = await worker.fetch(new Request("http://localhost/"), {
    ASSETS: { fetch: async () => new Response("dev") },
  });
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "script-src 'self' 'unsafe-inline'",
  );
});
