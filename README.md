# VibiShowdown

Estrutura oficial do projeto:

- `src/game_server.ts`: servidor local legado (nao usado no modo oficial-only).
- `src/engine.ts`: regras do combate (motor).
- `src/shared.ts`: tipos compartilhados entre cliente e servidor.
- `src/client.ts` / `src/config.ts`: camada de conexao do cliente.
- `src/vibinet/*`: runtime de rede embutido (copiado do VibiNet) para build sem depender de pasta externa.
- `vibishowdown/index.ts`: frontend (fonte principal da UI).
- `vibishowdown/index.html`: pagina do app.
- `vibishowdown/icons/`: assets da UI.
- `vibishowdown/dist/index.js`: bundle gerado para browser.

Fonte de verdade da UI:

- editar `vibishowdown/index.ts`.
- `vibishowdown/dist/index.js` e gerado a partir do source.

Comandos:

- `npm run dev`: serve estatico do app em `http://localhost:8080` (sem depender de `npx serve`).
- `npm run check`: type-check.
- `npm run build:web`: atualiza bundle web.

Networking:

- endpoint travado em `wss://net.studiovibi.com`.
- modo atual: cliente-deterministico. Cada jogador envia `join/ready/intent/forced_switch/surrender` e todos recomputam o estado localmente com `src/engine.ts`.
- identificacao de jogador por `player_id` persistido no browser (`localStorage`).
- historico do modo antigo (override/local): `docs/networking-history.md`.
