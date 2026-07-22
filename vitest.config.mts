import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Playwright lives in tests/e2e and is run by its own runner.
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": root,
      // `server-only` is a Next build-time guard with no runtime; alias it to an
      // empty module so the pure exports of server-only files can be unit-tested.
      "server-only": path.join(root, "tests/stubs/server-only.ts"),
    },
  },
});
