# Networking History

Current policy: official-only.

- Client endpoint is hard-locked to `wss://net.studiovibi.com` in `src/config.ts`.
- Local server scripts (`npm run dev` / `npm run server`) are intentionally disabled in `package.json`.

How it worked before this lock:

- `src/config.ts` allowed endpoint override via:
  - query param `?ws=...`
  - global `window.__VIBI_WS_URL__`
- This made it possible to point clients to a self-hosted/local WebSocket server.

If you need to restore self-host support in the future, use git history and reintroduce endpoint override logic in `src/config.ts`.
