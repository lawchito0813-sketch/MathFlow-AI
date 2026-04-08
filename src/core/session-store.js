const sessions = globalThis.__MATH_SESSION_STORE__ || new Map()
globalThis.__MATH_SESSION_STORE__ = sessions

function debugStore(action, sessionId, extra = {}) {
  globalThis.__MATH_SESSION_DEBUG__ = globalThis.__MATH_SESSION_DEBUG__ || []
  globalThis.__MATH_SESSION_DEBUG__.push({
    action,
    sessionId,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    size: sessions.size,
    keys: Array.from(sessions.keys()).slice(-20),
    ...extra
  })
  if (globalThis.__MATH_SESSION_DEBUG__.length > 100) {
    globalThis.__MATH_SESSION_DEBUG__ = globalThis.__MATH_SESSION_DEBUG__.slice(-100)
  }
}

export function setSession(sessionId, session) {
  sessions.set(sessionId, session)
  debugStore('set', sessionId, { hasSession: Boolean(session), keys: session ? Object.keys(session) : [] })
  return session
}

export function getAllSessions() {
  return sessions
}

export function getSession(sessionId) {
  const session = sessions.get(sessionId) || null
  debugStore('get', sessionId, { found: Boolean(session) })
  return session
}

export function updateSession(sessionId, updater) {
  const current = getSession(sessionId)
  const next = typeof updater === 'function' ? updater(current) : current
  if (!next) return null
  sessions.set(sessionId, next)
  return next
}

export function getSessionDebugLog() {
  return Array.isArray(globalThis.__MATH_SESSION_DEBUG__) ? globalThis.__MATH_SESSION_DEBUG__ : []
}

export function appendFollowupMessage(sessionId, message) {
  const session = getSession(sessionId)
  if (!session) return null

  const history = Array.isArray(session.followupMessages) ? session.followupMessages : []
  const updatedSession = {
    ...session,
    followupMessages: [...history, message].slice(-12)
  }

  sessions.set(sessionId, updatedSession)
  return updatedSession
}

export function appendSessionMessage(sessionId, message) {
  const session = getSession(sessionId)
  if (!session) return null
  const messages = Array.isArray(session.messages) ? session.messages : []
  const updatedSession = {
    ...session,
    messages: [...messages, { ...message, timestamp: message.timestamp || new Date().toISOString() }]
  }
  sessions.set(sessionId, updatedSession)
  return updatedSession
}

export function appendToolCall(sessionId, toolCall) {
  const session = getSession(sessionId)
  if (!session) return null
  const toolCalls = Array.isArray(session.toolCalls) ? session.toolCalls : []
  const updatedSession = {
    ...session,
    toolCalls: [...toolCalls, { ...toolCall, timestamp: toolCall.timestamp || new Date().toISOString() }]
  }
  sessions.set(sessionId, updatedSession)
  return updatedSession
}
