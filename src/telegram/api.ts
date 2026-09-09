export interface TelegramUser {
  id: number
  first_name?: string
  username?: string
}

export interface TelegramMessage {
  message_id: number
  chat: { id: number; type: string }
  from?: TelegramUser
  text?: string
}

export interface TelegramCallback {
  id: string
  from: TelegramUser
  data?: string
  message?: TelegramMessage
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallback
}

export interface InlineButton {
  text: string
  callback_data: string
}

const maxMessage = 4000

/** Cliente minimo da Bot API do Telegram por long polling, sem dependencias. */
export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly log: (message: string) => void,
  ) {}

  async *updates(signal: AbortSignal): AsyncGenerator<TelegramUpdate> {
    let offset = 0
    while (!signal.aborted) {
      try {
        const res = await this.call<TelegramUpdate[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }, signal)
        for (const u of res) {
          offset = u.update_id + 1
          yield u
        }
      } catch (err) {
        if (signal.aborted) return
        this.log(`getUpdates: ${err instanceof Error ? err.message : String(err)}`)
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
  }

  async send(chatId: number, text: string, buttons?: InlineButton[][]): Promise<number | null> {
    let last: number | null = null
    for (const chunk of split(text)) {
      const res = await this.call<{ message_id: number }>('sendMessage', {
        chat_id: chatId,
        text: chunk,
        reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
      })
      last = res.message_id
    }
    return last
  }

  async answerCallback(id: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, text })
  }

  async clearButtons(chatId: number, messageId: number): Promise<void> {
    await this.call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
  }

  private async call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(20000),
    })
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string }
    if (!json.ok || json.result === undefined) throw new Error(json.description ?? `HTTP ${res.status}`)
    return json.result
  }
}

function split(text: string): string[] {
  if (text.length <= maxMessage) return [text || '(vazio)']
  const parts: string[] = []
  let rest = text
  while (rest.length > 0) {
    parts.push(rest.slice(0, maxMessage))
    rest = rest.slice(maxMessage)
  }
  return parts
}
