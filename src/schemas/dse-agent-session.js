function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

export function validateDseAgentSession(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('agent session 必須是物件')
  }

  return {
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : '',
    flowType: typeof data.flowType === 'string' ? data.flowType : 'dse-author',
    providerId: typeof data.providerId === 'string' ? data.providerId : '',
    request: data.request && typeof data.request === 'object' ? data.request : {},
    intent: data.intent && typeof data.intent === 'object' ? data.intent : null,
    blueprint: data.blueprint && typeof data.blueprint === 'object' ? data.blueprint : null,
    messages: normalizeArray(data.messages),
    toolCalls: normalizeArray(data.toolCalls),
    generatedQuestions: normalizeArray(data.generatedQuestions),
    questionTasks: normalizeArray(data.questionTasks),
    verificationHistory: normalizeArray(data.verificationHistory),
    diagramHistory: normalizeArray(data.diagramHistory),
    followupMessages: normalizeArray(data.followupMessages),
    agentState: data.agentState && typeof data.agentState === 'object' ? data.agentState : {},
    paper: data.paper && typeof data.paper === 'object' ? data.paper : null,
    finalExplanation: typeof data.finalExplanation === 'string' ? data.finalExplanation : '',
    diagramImage: data.diagramImage || null
  }
}
