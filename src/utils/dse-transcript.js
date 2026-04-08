export function appendTranscriptMessage(session, message) {
  const messages = Array.isArray(session?.messages) ? session.messages : []
  return {
    ...session,
    messages: [...messages, { ...message, timestamp: message.timestamp || new Date().toISOString() }]
  }
}

export function appendToolHistory(session, toolCall) {
  const toolCalls = Array.isArray(session?.toolCalls) ? session.toolCalls : []
  return {
    ...session,
    toolCalls: [...toolCalls, { ...toolCall, timestamp: toolCall.timestamp || new Date().toISOString() }]
  }
}
