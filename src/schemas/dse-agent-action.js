function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateDseAgentAction(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('agent action 必須是物件')
  }

  const type = isNonEmptyString(data.type) ? data.type.trim() : ''
  if (!['ask_teacher', 'call_tool', 'delegate_subagent', 'finish'].includes(type)) {
    throw new Error('agent action type 不合法')
  }

  return {
    type,
    message: isNonEmptyString(data.message) ? data.message.trim() : '',
    question: isNonEmptyString(data.question) ? data.question.trim() : '',
    teacherResponse: isNonEmptyString(data.teacherResponse) ? data.teacherResponse.trim() : '',
    toolName: isNonEmptyString(data.toolName) ? data.toolName.trim() : '',
    subagent: isNonEmptyString(data.subagent) ? data.subagent.trim() : '',
    input: data.input && typeof data.input === 'object' ? data.input : {},
    reason: isNonEmptyString(data.reason) ? data.reason.trim() : ''
  }
}
