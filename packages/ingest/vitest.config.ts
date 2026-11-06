import { defineConfig } from "vitest/config";

// Migration tests boot an in-memory Postgres, which is slower than unit tests.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000 } });
