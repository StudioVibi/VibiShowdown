# Networking History

Current policy: official-only.

- Client endpoint is hard-locked to `wss://net.studiovibi.com` in `src/config.ts`.
- Local game server script (`npm run server`) is intentionally disabled in `package.json`.
- `npm run dev` now only serves the static `vibishowdown/` bundle via `scripts/serve-static.mjs` (no local WS backend).
- The client networking runtime is vendored in `src/vibinet/*` to avoid `../VibiNet` path dependency.
- Match progression is now client-deterministic in `vibishowdown/index.ts`:
  - clients consume room posts in order,
  - derive slots/ready state/participants locally,
  - resolve turns locally with `src/engine.ts`.

How it worked before this lock:

- `src/config.ts` allowed endpoint override via:
  - query param `?ws=...`
  - global `window.__VIBI_WS_URL__`
- This made it possible to point clients to a self-hosted/local WebSocket server.

If you need to restore self-host support in the future, use git history and reintroduce endpoint override logic in `src/config.ts`.
