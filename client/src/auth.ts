import { useEffect, useState } from 'react'

/**
 * Signed-in user, as reported by App Service Easy Auth.
 *
 * Auth lives entirely at the platform edge (`/.auth/me`), so there is nothing to
 * query when the app runs on a dev machine — the hook simply reports `anonymous`
 * and the UI hides the account chip.
 */
export interface AuthUser {
  name: string
  email: string
  initials: string
  /** Object URL for the Microsoft Graph photo, or null when unavailable. */
  photoUrl: string | null
}

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'signed-in'; user: AuthUser }

interface Claim {
  typ: string
  val: string
}

interface AuthPayload {
  provider_name?: string
  access_token?: string
  user_id?: string
  user_claims?: Claim[]
}

/** Claim types Entra ID may use for a display name, best first. */
const NAME_CLAIMS = [
  'name',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  'given_name',
]

const EMAIL_CLAIMS = [
  'preferred_username',
  'email',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'upn',
]

function claim(claims: Claim[], types: string[]): string {
  for (const type of types) {
    const hit = claims.find((c) => c.typ === type && c.val)
    if (hit) return hit.val
  }
  return ''
}

/** "Gabriel Nóvoa" -> "GN"; falls back to the local part of the email. */
export function initialsOf(name: string, email: string): string {
  const source = name.trim() || email.split('@')[0].replace(/[._-]+/g, ' ')
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]
  return letters.toUpperCase()
}

/**
 * Reads `/.auth/me`.
 *
 * The dev server answers unknown paths with the SPA's index.html, so a 200 is not
 * enough to conclude we are behind Easy Auth — the body has to actually be JSON.
 */
async function fetchIdentity(signal: AbortSignal): Promise<AuthPayload | null> {
  let res: Response
  try {
    res = await fetch('/.auth/me', { signal, credentials: 'include' })
  } catch {
    return null
  }
  if (!res.ok) return null
  if (!res.headers.get('content-type')?.includes('application/json')) return null

  try {
    const payload: unknown = await res.json()
    if (!Array.isArray(payload) || payload.length === 0) return null
    return payload[0] as AuthPayload
  } catch {
    return null
  }
}

/**
 * Fetches the user's Microsoft 365 photo.
 *
 * Returns null for every failure mode on purpose: the token is only good for Graph
 * when Easy Auth was configured to request User.Read, plenty of accounts have no
 * photo at all (404), and neither case is worth showing an error for — the initials
 * avatar covers both.
 */
async function fetchPhoto(token: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return null
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null })

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null

    void (async () => {
      const identity = await fetchIdentity(controller.signal)
      if (controller.signal.aborted) return

      if (!identity) {
        setState({ status: 'anonymous', user: null })
        return
      }

      const claims = identity.user_claims ?? []
      const email = claim(claims, EMAIL_CLAIMS) || identity.user_id || ''
      const name = claim(claims, NAME_CLAIMS) || email.split('@')[0]

      // Show the chip immediately; the photo is a slower, optional upgrade.
      const base: AuthUser = { name, email, initials: initialsOf(name, email), photoUrl: null }
      setState({ status: 'signed-in', user: base })

      if (!identity.access_token) return
      const photoUrl = await fetchPhoto(identity.access_token, controller.signal)
      if (!photoUrl || controller.signal.aborted) return

      objectUrl = photoUrl
      setState({ status: 'signed-in', user: { ...base, photoUrl } })
    })()

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [])

  return state
}
