import WebSocket from 'ws'
import type { ClientFrame, ClientToRelay, RelayToClient, ServerFrame } from '@agent-hub/core'

export interface ConnectOptions {
  url: string
  token: string
  accountToken?: string
  deviceId?: string
  client: string
  log: (message: string) => void
}

const protocolVersion = 1
const backoffMs = [2000, 5000, 10000, 30000]

/** Cliente Node do protocolo do daemon, direto ou pelo relay, com reconexao. Base para todos os canais. */
export class NodeDaemonClient {
  private socket: WebSocket | null = null
  private listeners = new Set<(f: ServerFrame) => void>()
  private waiters: { type: ServerFrame['type']; resolve: (f: ServerFrame) => void; reject: (e: Error) => void }[] = []
  private attempts = 0
  private stopped = false
  online = false

  constructor(private readonly opts: ConnectOptions) {}

  on(fn: (f: ServerFrame) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.socket?.close()
  }

  send(frame: ClientFrame): void {
    if (!this.online || !this.socket) throw new Error('daemon desconectado')
    this.raw(frame)
  }

  request<T extends ServerFrame['type']>(frame: ClientFrame, type: T, timeoutMs = 15000): Promise<Extract<ServerFrame, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter)
        reject(new Error(`sem resposta para ${frame.type}`))
      }, timeoutMs)
      const waiter = {
        type,
        resolve: (f: ServerFrame) => {
          clearTimeout(timer)
          resolve(f as Extract<ServerFrame, { type: T }>)
        },
        reject: (e: Error) => {
          clearTimeout(timer)
          reject(e)
        },
      }
      this.waiters.push(waiter)
      try {
        this.send(frame)
      } catch (err) {
        clearTimeout(timer)
        this.waiters = this.waiters.filter((w) => w !== waiter)
        reject(err as Error)
      }
    })
  }

  private connect(): void {
    const url = new URL(this.opts.url)
    if (this.opts.accountToken && !url.pathname.endsWith('/client')) url.pathname = url.pathname.replace(/\/$/, '') + '/client'
    const socket = new WebSocket(url)
    this.socket = socket
    socket.on('open', () => {
      if (this.opts.accountToken) this.raw({ type: 'relay.auth', account_token: this.opts.accountToken, client: this.opts.client })
      else this.raw({ type: 'auth', token: this.opts.token, protocol_version: protocolVersion, client: this.opts.client })
    })
    socket.on('message', (raw) => this.receive(JSON.parse(String(raw)) as RelayToClient))
    socket.on('error', (err) => this.opts.log(`conexao: ${err.message}`))
    socket.on('close', () => {
      this.online = false
      for (const w of this.waiters.splice(0)) w.reject(new Error('conexao encerrada'))
      if (this.stopped) return
      const delay = backoffMs[Math.min(this.attempts, backoffMs.length - 1)]!
      this.attempts += 1
      setTimeout(() => this.connect(), delay)
    })
  }

  private receive(frame: RelayToClient): void {
    switch (frame.type) {
      case 'relay.devices': {
        const wanted = this.opts.deviceId ?? frame.devices[0]?.id
        if (wanted) this.raw({ type: 'relay.attach', device_id: wanted })
        else this.opts.log('relay sem dispositivos online')
        return
      }
      case 'relay.attached':
        this.raw({ type: 'auth', token: this.opts.token, protocol_version: protocolVersion, client: this.opts.client })
        return
      case 'relay.detached':
        this.opts.log(`relay: ${frame.reason}`)
        this.socket?.close()
        return
      case 'relay.error':
        this.opts.log(`relay: ${frame.message}`)
        return
      case 'auth.ok':
        this.online = true
        this.attempts = 0
        this.opts.log(`conectado ao dispositivo ${frame.device}`)
        for (const l of this.listeners) l(frame)
        return
      case 'auth.error':
        this.opts.log(`auth: ${frame.message}`)
        this.stopped = true
        this.socket?.close()
        return
      default:
        this.dispatch(frame)
    }
  }

  private dispatch(frame: ServerFrame): void {
    if (frame.type === 'error') {
      const w = this.waiters.shift()
      if (w) w.reject(new Error(frame.message))
    } else {
      const i = this.waiters.findIndex((w) => w.type === frame.type)
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(frame)
    }
    for (const l of this.listeners) l(frame)
  }

  private raw(frame: ClientToRelay): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame))
  }
}
