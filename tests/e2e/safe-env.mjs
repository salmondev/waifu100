// Dummy server-side env for e2e/verify builds. Every value points at nothing,
// so even if a server component or route runs, it cannot reach the shared
// prod/dev Redis, Blob, Gemini, Serper or Vertex. Non-empty on purpose:
// Next's .env loader does not override variables that are already set.
export const SAFE_ENV = {
  REDIS_URL: "redis://127.0.0.1:1",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_e2e_dummy_token",
  GEMINI_API_KEY: "e2e-dummy-gemini",
  SERPER_API_KEY: "e2e-dummy-serper",
  SERPER_DAILY_CAP: "0",
  VERTEX_PROJECT_ID: "e2e-dummy-project",
  VERTEX_APP_ID: "e2e-dummy-app",
  GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/e2e-dummy.json",
  TOGETHER_ADMIN_HTTP: "http://127.0.0.1:9",
  TOGETHER_ADMIN_TOKEN: "e2e-dummy",
  NEXT_PUBLIC_TOGETHER_HTTP: "http://127.0.0.1:9",
  NEXT_PUBLIC_TOGETHER_WS: "ws://127.0.0.1:9",
  MODERATION_DEV_BYPASS: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};
