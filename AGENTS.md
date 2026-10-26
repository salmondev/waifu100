# Agent notes — waifu100

**Shipping to production?** Follow `docs/RELEASE_GATE.md` step by step and append to `docs/DEPLOY_LOG.md`.
Quick gate: `npm run verify` (or `bun run verify`), post-deploy: `npm run smoke:prod`.
Dev and prod share Redis/Blob/Gemini/Serper — tests must stay mocked (`tests/e2e/fixtures.ts`), never open `.env*`.
