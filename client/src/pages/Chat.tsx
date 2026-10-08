// Free-form questions about the data, answered by the AI assistant on the server.
// Conversations are stored server-side per user, listed in the side panel, and can
// be reopened, continued or deleted. Only the id of the open conversation is kept
// in sessionStorage, so it stays open while navigating around the app.

import { useCallback, useEffect, useRef, useState, type ComponentPropsWithoutRef, type FormEvent, type KeyboardEvent } from 'react'
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
  id?: number
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

interface ConversationSummary {
  id: number
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface Conversation {
  id: number
  title: string
  messages: Message[]
}

interface AskResponse {
  conversationId: number
  title: string
  message: Message
}

const CURRENT_KEY = 'financemanager.chat.current'

const SUGGESTIONS: TranslationKey[] = [
  'chat.suggest.categories',
  'chat.suggest.compareYears',
  'chat.suggest.savingsRate',
  'chat.suggest.mortgage',
  'chat.suggest.netWorth',
  'chat.suggest.cutCosts',
]

function savedCurrent(): number | null {
  const v = Number(sessionStorage.getItem(CURRENT_KEY))
  return Number.isInteger(v) && v > 0 ? v : null
}

export default function Chat() {
  const { t, language } = useI18n()
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [currentId, setCurrentId] = useState<number | null>(savedCurrent)
  const [messages, setMessages] = useState<Message[]>([])
  const [opening, setOpening] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const loadConversations = useCallback(async () => {
    try {
      const list = await api.get<ConversationSummary[]>('chat/conversations')
      setConversations(list)
      // Drop selections for conversations that no longer exist.
      setSelected((cur) => new Set([...cur].filter((id) => list.some((c) => c.id === id))))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const openConversation = useCallback(async (id: number) => {
    setOpening(true)
    setError(null)
    try {
      const c = await api.get<Conversation>(`chat/conversations/${id}`)
      setMessages(c.messages)
      setCurrentId(c.id)
    } catch {
      // Deleted elsewhere, or belongs to someone else: fall back to a blank chat.
      setMessages([])
      setCurrentId(null)
    } finally {
      setOpening(false)
    }
  }, [])

  useEffect(() => {
    api.get<ChatStatus>('chat/status')
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, model: null, webSearch: false }))
    loadConversations()
    const id = savedCurrent()
    if (id) openConversation(id)
  }, [loadConversations, openConversation])

  useEffect(() => {
    if (currentId) sessionStorage.setItem(CURRENT_KEY, String(currentId))
    else sessionStorage.removeItem(CURRENT_KEY)
  }, [currentId])

  useEffect(() => {
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
      const res = await api.post<AskResponse>('chat', { conversationId: currentId, message: question, language })
      setMessages([...next, res.message])
      setCurrentId(res.conversationId)
      loadConversations()
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

  function newConversation() {
    setMessages([])
    setCurrentId(null)
    setError(null)
  }

  function toggle(id: number) {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = conversations.length > 0 && selected.size === conversations.length

  async function deleteSelected() {
    if (selected.size === 0 || !confirm(t('chat.confirmDelete', { count: selected.size }))) return
    try {
      await api.post('chat/conversations/delete', { ids: [...selected] })
      if (currentId && selected.has(currentId)) newConversation()
      setSelected(new Set())
      await loadConversations()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="chat-page">
      <div className="chat-head">
        <div>
          <h1 className="page-title">🤖 {t('chat.title')}</h1>
          <p className="page-sub">{t('chat.subtitle')}</p>
        </div>
      </div>

      {status && !status.enabled && (
        <div className="alert warn">{t('chat.disabled')}</div>
      )}

      <div className="chat-layout">
        <aside className="card chat-history" aria-label={t('chat.history')}>
          <div className="chat-history-head">
            <h2>{t('chat.history')}</h2>
            <button className="btn subtle" onClick={newConversation} disabled={busy}>
              ✨ {t('chat.newConversation')}
            </button>
          </div>

          {conversations.length > 0 && (
            <div className="chat-history-tools">
              <label className="check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(conversations.map((c) => c.id)))}
                />
                {t('chat.selectAll')}
              </label>
              <button className="btn subtle danger" onClick={deleteSelected} disabled={selected.size === 0 || busy}>
                🗑 {t('chat.deleteSelected', { count: selected.size })}
              </button>
            </div>
          )}

          {historyLoading ? (
            <p className="hint">{t('common.loading')}</p>
          ) : conversations.length === 0 ? (
            <p className="hint">{t('chat.noHistory')}</p>
          ) : (
            <ul className="chat-history-list">
              {conversations.map((c) => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  active={c.id === currentId}
                  checked={selected.has(c.id)}
                  disabled={busy}
                  onToggle={() => toggle(c.id)}
                  onOpen={() => openConversation(c.id)}
                />
              ))}
            </ul>
          )}
          <p className="hint chat-history-foot">🔒 {t('chat.privateHint')}</p>
        </aside>

        <section className="chat-main">
          <div className="card chat-log">
            {opening && <p className="hint">{t('common.loading')}</p>}

            {!opening && messages.length === 0 && (
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

            {!opening && messages.map((m, i) => (
              <div key={m.id ?? `p${i}`} className={`chat-msg ${m.role}`}>
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
                {messages[messages.length - 1]?.role === 'user' && (
                  <button className="btn subtle" onClick={retry} disabled={busy}>↻ {t('chat.retry')}</button>
                )}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="chat-input" onSubmit={onSubmit}>
            <textarea
              value={input}
              rows={2}
              placeholder={t('chat.placeholder')}
              disabled={!status?.enabled || opening}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button className="btn primary" type="submit" disabled={busy || opening || !input.trim() || !status?.enabled}>
              {t('chat.send')}
            </button>
          </form>
          <p className="hint chat-foot">
            {status?.webSearch && <>🌐 {t('chat.webOn')} · </>}
            {t('chat.footnote')}{status?.model ? ` · ${status.model}` : ''}
          </p>
        </section>
      </div>
    </div>
  )
}

interface ItemProps {
  conversation: ConversationSummary
  active: boolean
  checked: boolean
  disabled: boolean
  onToggle: () => void
  onOpen: () => void
}

function ConversationItem({ conversation: c, active, checked, disabled, onToggle, onOpen }: ItemProps) {
  const { t, fmt } = useI18n()
  return (
    <li className={`chat-history-item${active ? ' active' : ''}${checked ? ' checked' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={t('chat.selectConversation', { title: c.title })}
      />
      <button type="button" className="chat-history-open" onClick={onOpen} disabled={disabled} title={c.title}>
        <span className="chat-history-title">{c.title}</span>
        <span className="chat-history-meta">
          {fmt.dateTime(c.updatedAt)} · {t('chat.messageCount', { count: c.messageCount })}
        </span>
      </button>
    </li>
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