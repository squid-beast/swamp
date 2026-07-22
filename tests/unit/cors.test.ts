import { afterEach, describe, expect, it, vi } from "vitest";

// cors.ts is `server-only`; the vitest config aliases that import to an empty
// stub so this file's pure exports can be exercised in the unit environment.

async function load() {
  vi.resetModules();
  return import("@/features/tables/cors");
}

afterEach(() => {
  delete process.env.SWAMP_CORS_ORIGINS;
});

describe("CORS headers", () => {
  it("default to a wildcard when no allow-list is set", async () => {
    const { corsHeaders } = await load();
    const h = corsHeaders("https://anything.example");
    expect(h["Access-Control-Allow-Origin"]).toBe("*");
    expect(h["Access-Control-Allow-Headers"]).toMatch(/authorization/i);
    expect(h.Vary).toBeUndefined();
  });

  it("echo an allowed origin and vary on it", async () => {
    process.env.SWAMP_CORS_ORIGINS = "https://my-vps.example, https://other.example";
    const { corsHeaders } = await load();

    const h = corsHeaders("https://my-vps.example");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://my-vps.example");
    expect(h.Vary).toBe("Origin");
  });

  it("refuse an origin that is not on the allow-list", async () => {
    process.env.SWAMP_CORS_ORIGINS = "https://my-vps.example";
    const { corsHeaders } = await load();

    const h = corsHeaders("https://evil.example");
    // Falls back to the first allowed origin — never the attacker's.
    expect(h["Access-Control-Allow-Origin"]).toBe("https://my-vps.example");
  });
});
