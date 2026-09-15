#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ServerFrame } from '@agent-hub/core'
import { NodeDaemonClient } from '../shared/client.js'
import { TelegramApi, type TelegramMessage, type TelegramCallback } from './api.js'

interface ChatState {
  sessionId?: string
  workspace?: string
  agent?: string
}

interface RunBuffer {
  chatId: number
  text: string[]
  tools: number
}

const log = (m: string) => console.log(`[telegram] ${m}`)
const env = process.env
const botToken = required('TELEGRAM_BOT_TOKEN')
const allowed = new Set((env.TELEGRAM_ALLOWED_IDS ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0))
if (allowed.size === 0) throw new Error('TELEGRAM_ALLOWED_IDS vazio; informe ao menos um id de usuario')
const hubHome = env.AGENT_HUB_HOME ?? join(homedir(), '.agent-hub')
const stateFile = env.AGENT_HUB_TELEGRAM_STATE ?? join(hubHome, 'telegram-state.json')
const state: Record<string, ChatState> = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, ChatState>) : {}

const api = new TelegramApi(botToken, log)
const daemon = new NodeDaemonClient({
  url: env.DAEMON_URL ?? 'ws://127.0.0.1:47311/ws',
  token: env.DAEMON_TOKEN ?? localToken(),
  accountToken: env.RELAY_ACCOUNT_TOKEN,
  deviceId: env.RELAY_DEVICE_ID,
  client: 'telegram',
  log,
})
const buffers = new Map<string, RunBuffer>()
const sessionChat = new Map<string, number>()
const controller = new AbortController()

daemon.on(onFrame)
daemon.start()
process.on('SIGINT', () => {
  controller.abort()
  daemon.stop()
  process.exit(0)
})

for await (const update of api.updates(controller.signal)) {
  try {
    if (update.message) await onMessage(update.message)
    if (update.callback_query) await onCallback(update.callback_query)
  } catch (err) {
    log(err instanceof Error ? err.message : String(err))
  }
}

async function onMessage(m: TelegramMessage): Promise<void> {
  if (!m.from || !allowed.has(m.from.id) || !m.text) return
  const chatId = m.chat.id
  const st = state[String(chatId)] ?? {}
  const text = m.text.trim()
  if (text.startsWith('/')) {
    await onCommand(chatId, st, text)
    return
  }
  if (!daemon.online) {
    await api.send(chatId, 'Daemon desconectado. Tente de novo em instantes.')
    return
  }
  if (!st.sessionId) {
    if (!st.workspace) {
      await api.send(chatId, 'Defina o workspace primeiro: /workspace /caminho/do/projeto')
      return
    }
    const created = await daemon.request({ type: 'session.create', workspace: st.workspace, agent: st.agent, text }, 'session.created')
    st.sessionId = created.session.id
    save(chatId, st)
    await api.send(chatId, `Sessao nova com ${created.session.agent}${created.routed ? ` (roteado por ${created.routed.intent ?? 'regra'})` : ''}.`)
  }
  sessionChat.set(st.sessionId, chatId)
  const started = await daemon.request({ type: 'run.start', session_id: st.sessionId, text }, 'run.started')
  buffers.set(started.run_id, { chatId, text: [], tools: 0 })
}

async function onCommand(chatId: number, st: ChatState, text: string): Promise<void> {
  const [cmd, ...rest] = text.split(/\s+/)
  const arg = rest.join(' ').trim()
  switch (cmd) {
    case '/start':
    case '/ajuda':
      await api.send(
        chatId,
        [
          'Comandos:',
          '/workspace <dir>  define o diretorio permitido',
          '/agente <nome>    fixa o agente da proxima sessao (vazio = roteamento)',
          '/nova             comeca uma sessao nova na proxima mensagem',
          '/sessoes          ultimas sessoes',
          '/custo            custo de hoje por agente',
          '/cancelar         cancela o run atual',
          '/status           conexao com o daemon',
        ].join('\n'),
      )
      return
    case '/workspace':
      st.workspace = arg || undefined
      st.sessionId = undefined
      save(chatId, st)
      await api.send(chatId, st.workspace ? `Workspace: ${st.workspace}` : 'Workspace limpo.')
      return
    case '/agente':
      st.agent = arg || undefined
      st.sessionId = undefined
      save(chatId, st)
      await api.send(chatId, st.agent ? `Agente: ${st.agent}` : 'Agente por roteamento.')
      return
    case '/nova':
      st.sessionId = undefined
      save(chatId, st)
      await api.send(chatId, 'A proxima mensagem abre uma sessao nova.')
      return
    case '/sessoes': {
      const res = await daemon.request({ type: 'session.list', limit: 5 }, 'session.list')
      await api.send(chatId, res.sessions.map((s) => `${s.title} (${s.agent}, ${s.costUsd.toFixed(4)} USD)`).join('\n') || 'Nenhuma sessao.')
      return
    }
    case '/custo': {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const res = await daemon.request({ type: 'cost.report', group: 'agent', since: start.getTime() }, 'cost.report')
      const total = res.rows.reduce((a, r) => a + r.costUsd, 0)
      await api.send(chatId, [...res.rows.map((r) => `${r.key}: ${r.costUsd.toFixed(4)} USD em ${r.calls} chamadas`), `total: ${total.toFixed(4)} USD`].join('\n'))
      return
    }
    case '/cancelar': {
      const runId = [...buffers.entries()].find(([, b]) => b.chatId === chatId)?.[0]
      if (runId) daemon.send({ type: 'run.cancel', run_id: runId })
      await api.send(chatId, runId ? 'Cancelamento pedido.' : 'Nenhum run em andamento.')
      return
    }
    case '/status':
      await api.send(chatId, daemon.online ? 'Daemon conectado.' : 'Daemon desconectado.')
      return
    default:
      await api.send(chatId, 'Comando desconhecido. /ajuda lista os comandos.')
  }
}

async function onCallback(cb: TelegramCallback): Promise<void> {
  if (!allowed.has(cb.from.id) || !cb.data) return
  const [kind, id, decision] = cb.data.split(':')
  if (kind !== 'apr' || !id || (decision !== 'allow' && decision !== 'deny')) return
  try {
    daemon.send({ type: 'approval.respond', approval_id: id, decision })
    await api.answerCallback(cb.id, decision === 'allow' ? 'Aprovado' : 'Negado')
  } catch (err) {
    await api.answerCallback(cb.id, err instanceof Error ? err.message : String(err))
  }
  if (cb.message) await api.clearButtons(cb.message.chat.id, cb.message.message_id).catch(() => undefined)
}

function onFrame(f: ServerFrame): void {
  if (f.type === 'event') {
    const buf = buffers.get(f.run_id)
    if (!buf) return
    const e = f.event
    if (e.type === 'text_delta') buf.text.push(e.delta)
    if (e.type === 'tool_call') buf.tools += 1
    if (e.type === 'run_finished') {
      buffers.delete(f.run_id)
      const body = buf.text.join('').trim() || '(sem texto)'
      const tail = `\n\n[${e.stop}, ${e.steps} passos, ${buf.tools} ferramentas, ${e.costUsd.toFixed(4)} USD]${e.error ? `\n${e.error}` : ''}`
      void api.send(buf.chatId, body + tail)
    }
    return
  }
  if (f.type === 'approval.required') {
    const chatId = sessionChat.get(f.session_id) ?? [...allowed][0]!
    const args = JSON.stringify(f.args)
    void api.send(chatId, `Aprovar ${f.tool} (${f.risk})?\n${args.slice(0, 1500)}`, [
      [
        { text: 'Aprovar', callback_data: `apr:${f.approval_id}:allow` },
        { text: 'Negar', callback_data: `apr:${f.approval_id}:deny` },
      ],
    ])
    return
  }
  if (f.type === 'automation.finished') {
    const chatId = [...allowed][0]!
    const status = `Automacao ${f.kind} ${f.id} terminou com ${f.stop} (${f.cost_usd.toFixed(4)} USD). Sessao ${f.session_id.slice(0, 8)}.`
    if (!f.notify?.includes('telegram') || !f.text) {
      void api.send(chatId, status)
      return
    }
    const st = state[String(chatId)] ?? {}
    st.sessionId = f.session_id
    if (f.workspace) st.workspace = f.workspace
    save(chatId, st)
    sessionChat.set(f.session_id, chatId)
    void api.send(chatId, `${f.text}\n\n[${status} Responda aqui para continuar essa sessao; /nova volta ao normal.]`)
  }
}

function save(chatId: number, st: ChatState): void {
  state[String(chatId)] = st
  mkdirSync(dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, JSON.stringify(state, null, 2))
}

/** Token do daemon local gravado pelo agent-hub instalar, usado quando DAEMON_TOKEN nao vem no ambiente. */
function localToken(): string {
  const file = join(hubHome, 'token')
  if (!existsSync(file)) throw new Error(`variavel DAEMON_TOKEN obrigatoria (nao achei ${file})`)
  return readFileSync(file, 'utf8').trim()
}

function required(name: string): string {
  const v = env[name]
  if (!v) throw new Error(`variavel ${name} obrigatoria`)
  return v
}
