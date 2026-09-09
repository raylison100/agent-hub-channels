# agent-hub-channels

Clientes do daemon que vivem em plataformas de mensagem. Uma mensagem no
chat cria ou continua uma sessao, o agente responde na mesma conversa e
aprovacoes viram botoes. Cada plataforma e um processo separado.

Estado: fase 0, sem codigo. Telegram entra na fase 3, Slack na fase 4.
Planejamento em `../docs/10-automacao.md`.

Estrutura prevista:

```
telegram/
  src/index.ts     bot, mapeamento chat para sessao, botoes de aprovacao
slack/
  src/index.ts
shared/
  src/client.ts    cliente do protocolo WebSocket do daemon
```

Regras fixas: remetente fora da lista de ids permitidos e ignorado;
segredos da plataforma ficam em variaveis de ambiente.
