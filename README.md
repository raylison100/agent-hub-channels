# agent-hub-channels

Clientes do daemon que vivem em plataformas de mensagem. Uma mensagem no
chat cria ou continua uma sessao, o agente responde na mesma conversa e
aprovacoes viram botoes. Cada plataforma e um processo separado, todos
sobre o mesmo cliente do protocolo em `src/shared/client.ts`.

Estado: fase 3, Telegram funcional. Slack na fase 4. Planejamento em
`../docs/10-automacao.md`.

## Telegram

Sem dependencias alem de `ws`: usa a Bot API por long polling.

```bash
pnpm install
pnpm build
TELEGRAM_BOT_TOKEN=... TELEGRAM_ALLOWED_IDS=123456789 \
DAEMON_URL=ws://127.0.0.1:47311/ws DAEMON_TOKEN=... \
node dist/telegram/index.js
```

Pelo relay, troque `DAEMON_URL` pela URL do relay e informe
`RELAY_ACCOUNT_TOKEN` e, se houver mais de um dispositivo, `RELAY_DEVICE_ID`.

| Variavel | Uso |
|----------|-----|
| `TELEGRAM_BOT_TOKEN` | token do bot criado no BotFather |
| `TELEGRAM_ALLOWED_IDS` | ids de usuario permitidos, separados por virgula. Qualquer outro remetente e ignorado |
| `DAEMON_URL`, `DAEMON_TOKEN` | mesmos valores de `agent-hub-daemon pair` |
| `RELAY_ACCOUNT_TOKEN`, `RELAY_DEVICE_ID` | apenas pelo relay |
| `AGENT_HUB_TELEGRAM_STATE` | arquivo de estado por chat (padrao `~/.agent-hub/telegram-state.json`) |

Comandos no chat: `/workspace`, `/agente`, `/nova`, `/sessoes`, `/custo`,
`/cancelar`, `/status`, `/ajuda`. Texto sem barra vira mensagem para a
sessao atual. A resposta chega ao fim do run com parada, passos, numero de
ferramentas e custo. Aprovacoes chegam com botoes Aprovar e Negar.

## Estrutura

```
src/
  shared/client.ts     cliente Node do protocolo, direto ou pelo relay, com reconexao
  telegram/api.ts      Bot API minima: getUpdates, sendMessage, botoes, callbacks
  telegram/index.ts    mapeamento chat para sessao, comandos, aprovacoes
```
