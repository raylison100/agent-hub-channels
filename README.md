# agent-hub-channels

Clientes do Agent Hub que vivem em plataformas de mensagem. Uma mensagem no
chat cria ou continua uma sessao no seu
[daemon](https://github.com/raylison100/agent-hub-daemon), o agente responde na
mesma conversa e aprovacoes viram botoes. Cada plataforma e um processo
separado, todos sobre o mesmo cliente do protocolo. Hoje existe o Telegram.

## Telegram

Usa a Bot API por long polling, sem dependencia alem de `ws`.

```bash
pnpm install
pnpm build
TELEGRAM_BOT_TOKEN=... TELEGRAM_ALLOWED_IDS=123456789 \
DAEMON_URL=ws://127.0.0.1:47311/ws DAEMON_TOKEN=... \
node dist/telegram/index.js
```

Pelo relay, troque `DAEMON_URL` pela URL do relay e informe
`RELAY_ACCOUNT_TOKEN` e, com mais de um dispositivo, `RELAY_DEVICE_ID`.

| Variavel | Uso |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token do bot criado no BotFather |
| `TELEGRAM_ALLOWED_IDS` | ids de usuario permitidos, separados por virgula; qualquer outro remetente e ignorado |
| `DAEMON_URL`, `DAEMON_TOKEN` | mesmos valores de `agent-hub-daemon pair` |
| `RELAY_ACCOUNT_TOKEN`, `RELAY_DEVICE_ID` | apenas pelo relay |
| `AGENT_HUB_TELEGRAM_STATE` | arquivo de estado por chat (padrao `~/.agent-hub/telegram-state.json`) |

Comandos no chat: `/workspace`, `/agente`, `/nova`, `/sessoes`, `/custo`,
`/cancelar`, `/status`, `/ajuda`. Texto sem barra vira mensagem para a sessao
atual. A resposta chega no fim do run com parada, passos, ferramentas usadas e
custo. Aprovacoes chegam com botoes Aprovar e Negar.

## Estrutura

```
src/
  shared/client.ts     cliente Node do protocolo, direto ou pelo relay, com reconexao
  telegram/api.ts      Bot API minima: getUpdates, sendMessage, botoes, callbacks
  telegram/index.ts    chat para sessao, comandos e aprovacoes
```

## Parte do Agent Hub

Este repositorio e uma das partes do [Agent Hub](https://github.com/raylison100/agent-hub),
um gerenciador de modelos de IA que roda na sua maquina. A documentacao geral
esta na [wiki](https://github.com/raylison100/agent-hub/wiki).

| Repositorio | Papel |
|---|---|
| [agent-hub](https://github.com/raylison100/agent-hub) | ponto de partida, Makefile, scripts e wiki |
| [agent-hub-core](https://github.com/raylison100/agent-hub-core) | biblioteca TypeScript: adaptadores, laco do agente, custo, roteamento, ferramentas, protocolo |
| [agent-hub-daemon](https://github.com/raylison100/agent-hub-daemon) | servico local: sessoes, runs, aprovacoes, automacao, conectores, API WebSocket |
| [agent-hub-web](https://github.com/raylison100/agent-hub-web) | interface Vue 3 como PWA, a mesma no navegador, no celular e no desktop |
| [agent-hub-agents](https://github.com/raylison100/agent-hub-agents) | perfis, papeis, skills, workflows, precos, roteamento e politicas, em texto |
| [agent-hub-desktop](https://github.com/raylison100/agent-hub-desktop) | app Tauri 2 para Windows e Linux |
| [agent-hub-relay](https://github.com/raylison100/agent-hub-relay) | retransmissor sem estado para acesso remoto |
| [agent-hub-channels](https://github.com/raylison100/agent-hub-channels) | clientes em plataformas de mensagem, hoje Telegram |
| [agent-hub-docs](https://github.com/raylison100/agent-hub-docs) | planejamento, arquitetura, ADRs e a fonte das paginas da wiki |

## Licenca

[PolyForm Noncommercial 1.0.0](LICENSE). Pode ler, estudar, modificar e usar
para fins pessoais, de pesquisa, ensino ou em organizacao sem fins lucrativos.
Uso comercial nao e permitido sem autorizacao do autor.

Required Notice: Copyright (c) 2026 Raylison Nunes (https://github.com/raylison100)
