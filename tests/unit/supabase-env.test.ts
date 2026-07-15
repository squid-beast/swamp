import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression — the most dangerous line the audit found:
//
//   export async function requireAuth() {
//     if (!isSupabaseConfigured) return null;   // null = ALLOWED
//     ...
//   }
//
// A missing environment variable didn't fail. It silently disabled every guard
// in the app and fell back to a local file store. Boot production with one typo
// in an env var name and every API route was wide open.
//
// There is no unauthenticated mode any more. Missing config throws at import.

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
const LEGACY_KEY_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

async function importEnv() {
  vi.resetModules();
  return import("@/shared/supabase/env");
}

describe("shared/supabase/env", () => {
  beforeEach(() => {
    vi.stubEnv(URL_VAR, "");
    vi.stubEnv(KEY_VAR, "");
    vi.stubEnv(LEGACY_KEY_VAR, "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws when the Supabase URL is missing — it must not degrade to open access", async () => {
    vi.stubEnv(KEY_VAR, "test-key");
    await expect(importEnv()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws when the Supabase key is missing", async () => {
    vi.stubEnv(URL_VAR, "http://localhost:54321");
    await expect(importEnv()).rejects.toThrow(/KEY/);
  });

  it("throws when both are missing", async () => {
    await expect(importEnv()).rejects.toThrow();
  });

  it("resolves when both are present", async () => {
    vi.stubEnv(URL_VAR, "http://localhost:54321");
    vi.stubEnv(KEY_VAR, "test-key");

    const env = await importEnv();

    expect(env.SUPABASE_URL).toBe("http://localhost:54321");
    expect(env.SUPABASE_KEY).toBe("test-key");
  });

  it("accepts the legacy anon key name as a fallback", async () => {
    vi.stubEnv(URL_VAR, "http://localhost:54321");
    vi.stubEnv(LEGACY_KEY_VAR, "legacy-anon-key");

    const env = await importEnv();

    expect(env.SUPABASE_KEY).toBe("legacy-anon-key");
  });
});
