# VibiShowdown

Estrutura oficial do projeto:

- `src/engine.ts`: regras do combate (motor).
- `src/shared.ts`: tipos compartilhados entre cliente e servidor.
- `src/client.ts`: camada de conexao usando o pacote oficial `vibinet`.
- `src/game_default/*`: catalogo de defaults do jogo (pokemons, moves, passivas) + checks de integridade.
- `vibishowdown/index.ts`: frontend (fonte principal da UI).
- `vibishowdown/index.html`: pagina do app.
- `vibishowdown/icons/`: assets da UI.
- `vibishowdown/dist/index.js`: bundle gerado para browser.

Fonte de verdade da UI:

- editar `vibishowdown/index.ts`.
- `vibishowdown/dist/index.js` e gerado a partir do source.

Comandos:

- `npm run setup`: instala dependencias + checks + build na ordem certa.
- `npm run setup:run`: executa `setup` e sobe host local.
- `npm run dev`: serve estatico do app em `http://localhost:8080` (sem depender de `npx serve`).
- `npm run check`: type-check.
- `npm run check:integrity`: valida integridade dos defaults em `src/game_default/*`.
- `npm run build:web`: atualiza bundle web.

Networking:

- endpoint travado em `wss://net.studiovibi.com`.
- modo atual: cliente-deterministico. Cada jogador envia `join/ready/intent/forced_switch/surrender` e todos recomputam o estado localmente com `src/engine.ts`.
- stack de rede: apenas `vibinet@0.1.1` oficial (sem protocolo custom em `src/vibinet/*`).
- identificacao de jogador por `player_id` estavel derivado do nome (mesmo nome => mesmo id).
- `room` e `name` ficam cacheados em `localStorage` e servem como default no prompt.
- a cada carregamento da pagina o app pergunta novamente `room` e `name` (com os defaults salvos).
- documento de ordem atual (rede + turnos): `docs/ordem_atual_sistema.txt`.
- padrao numerico deterministico (anti-float no engine): `docs/padrao_determinismo_numerico.txt`.
- self-host removido deste repositorio (sem backend de jogo local).
