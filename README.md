# VibiShowdown

Estrutura oficial do projeto:

- `src/game_server.ts`: servidor local legado (nao usado no modo oficial-only).
- `src/engine.ts`: regras do combate (motor).
- `src/shared.ts`: tipos compartilhados entre cliente e servidor.
- `src/client.ts` / `src/config.ts`: camada de conexao do cliente.
- `vibishowdown/index.ts`: frontend (fonte principal da UI).
- `vibishowdown/index.html`: pagina do app.
- `vibishowdown/icons/`: assets da UI.
- `vibishowdown/dist/index.js`: bundle gerado para browser.

Fonte de verdade da UI:

- editar `vibishowdown/index.ts`.
- `vibishowdown/dist/index.js` e gerado a partir do source.

Comandos:

- `npm run dev`: bloqueado (este projeto usa apenas o servidor oficial VibiNet).
- `npm run check`: type-check.
- `bun build vibishowdown/index.ts --outdir vibishowdown/dist --target=browser --format=esm`: atualiza bundle web.

Networking:

- endpoint travado em `wss://net.studiovibi.com`.
- historico do modo antigo (override/local): `docs/networking-history.md`.
