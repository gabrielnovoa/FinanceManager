// Free-form questions about the data, answered by the AI assistant on the server.
// The conversation lives in sessionStorage, so it survives navigating around the
// app but not closing the tab — nothing about it is stored server-side.

import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type FormEvent, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'
import { useI18n, type TranslationKey } from '../i18n'

interface ChatQuery {
  sql: string
  rowCount: number | null
  error: string | null
}

interface ChatSource {
  title: string
  url: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  queries?: ChatQuery[]
  webSearches?: string[]
  sources?: ChatSource[]
}

interface ChatStatus {
  enabled: boolean
  model: string | null
  webSearch: boolean
}

const STORAGE_KEY = 'financemanager.chat'

const SUGGESTIONS: TranslationKey[] = [
  'chat.suggest.categories',
  'chat.suggest.compareYears',
  'chat.suggest.savingsRate',
  'chat.suggest.mortgage',
  'chat.suggest.netWorth',
  'chat.suggest.cutCosts',
]

function loadHistory(): Message[] {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    return saved ? (JSON.parse(saved) as Message[]) : []
  } catch {
    return []
  }
}

export default function Chat() {
  const { t, language } = useI18n()
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [messages, setMessages] = useState<Message[]>(loadHistory)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get<ChatStatus>('chat/status')
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, model: null, webSearch: false }))
  }, [])

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  async function send(text: string, history: Message[] = messages) {
    const question = text.trim()
    if (!question || busy) return
    const next: Message[] = [...history, { role: 'user', content: question }]
    setMessages(next)
    setInput('')
    setError(null)
    setBusy(true)
    try {
      const res = await api.post<{ reply: string; queries: ChatQuery[]; webSearches: string[]; sources: ChatSource[] }>('chat', {
        language,
        messages: next.map(({ role, content }) => ({ role, content })),
      })
      setMessages([...next, {
        role: 'assistant',
        content: res.reply,
        queries: res.queries,
        webSearches: res.webSearches,
        sources: res.sources,
      }])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(input)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(input)
    }
  }

  /** Re-asks the last question after a failure, without duplicating it. */
  function retry() {
    const last = messages[messages.length - 1]
    if (last?.role === 'user') send(last.content, messages.slice(0, -1))
  }

  function reset() {
    setMessages([])
    setError(null)
  }

  return (
    <div className="chat-page">
      <div className="chat-head">
        <div>
          <h1 className="page-title">🤖 {t('chat.title')}</h1>
          <p className="page-sub">{t('chat.subtitle')}</p>
        </div>
        {messages.length > 0 && (
          <button className="btn subtle" onClick={reset} disabled={busy}>
            ✨ {t('chat.newConversation')}
          </button>
        )}
      </div>

      {status && !status.enabled && (
        <div className="alert warn">{t('chat.disabled')}</div>
      )}

      <div className="card chat-log">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p className="muted">{t('chat.intro')}</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="chip"
                  disabled={busy || !status?.enabled}
                  onClick={() => send(t(key))}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.role === 'assistant' ? (
              <div className="bubble markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ExternalLink }}>{m.content}</ReactMarkdown>
                {m.sources && m.sources.length > 0 && <Sources sources={m.sources} />}
                {((m.queries?.length ?? 0) > 0 || (m.webSearches?.length ?? 0) > 0) && (
                  <Queries queries={m.queries ?? []} webSearches={m.webSearches ?? []} />
                )}
              </div>
            ) : (
              <div className="bubble">{m.content}</div>
            )}
          </div>
        ))}

        {busy && (
          <div className="chat-msg assistant">
            <div className="bubble thinking">
              <span className="dots" aria-hidden="true"><i /><i /><i /></span> {t('chat.thinking')}
            </div>
          </div>
        )}

        {error && (
          <div className="alert err chat-error">
            {error}{' '}
            <button className="btn subtle" onClick={retry} disabled={busy}>↻ {t('chat.retry')}</button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="chat-input" onSubmit={onSubmit}>
        <textarea
          value={input}
          rows={2}
          placeholder={t('chat.placeholder')}
          disabled={!status?.enabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="btn primary" type="submit" disabled={busy || !input.trim() || !status?.enabled}>
          {t('chat.send')}
        </button>
      </form>
      <p className="hint chat-foot">
        {status?.webSearch && <>🌐 {t('chat.webOn')} · </>}
        {t('chat.footnote')}{status?.model ? ` · ${status.model}` : ''}
      </p>
    </div>
  )
}

/** Links in answers point at web sources — never navigate the app away. */
function ExternalLink(props: ComponentPropsWithoutRef<'a'>) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />
}

function Sources({ sources }: { sources: ChatSource[] }) {
  const { t } = useI18n()
  return (
    <div className="chat-sources">
      <span className="hint">🌐 {t('chat.sources')}</span>
      <ol>
        {sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Queries({ queries, webSearches }: { queries: ChatQuery[]; webSearches: string[] }) {
  const { t } = useI18n()
  return (
    <details className="chat-queries">
      <summary>
        {[
          queries.length > 0 && t('chat.queries', { count: queries.length }),
          webSearches.length > 0 && t('chat.webSearches', { count: webSearches.length }),
        ].filter(Boolean).join(' · ')}
      </summary>
      {webSearches.map((q, i) => (
        <div key={`w${i}`} className="chat-query">
          <span className="hint">🔎 {q}</span>
        </div>
      ))}
      {queries.map((q, i) => (
        <div key={i} className="chat-query">
          <pre>{q.sql}</pre>
          <span className={`hint${q.error ? ' neg' : ''}`}>
            {q.error ? `⚠ ${q.error}` : t('chat.queryRows', { count: q.rowCount ?? 0 })}
          </span>
        </div>
      ))}
    </details>
  )
}
