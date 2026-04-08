function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateJudgeResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('裁決結果必須是物件')
  }

  if (!isNonEmptyString(data.finalAnswer)) {
    throw new Error('裁決結果缺少 finalAnswer')
  }

  return {
    finalAnswer: data.finalAnswer.trim(),
    chosenSolver: data.chosenSolver === 'A' || data.chosenSolver === 'B' || data.chosenSolver === 'neither'
      ? data.chosenSolver
      : 'A',
    reasoning: isNonEmptyString(data.reasoning) ? data.reasoning.trim() : '',
    conflictPoints: Array.isArray(data.conflictPoints) ? data.conflictPoints.filter(isNonEmptyString) : [],
    confidence: isNonEmptyString(data.confidence) ? data.confidence.trim() : 'unknown',
    diagramDecision: data.diagramDecision === 'required' || data.diagramDecision === 'optional' || data.diagramDecision === 'unnecessary'
      ? data.diagramDecision
      : 'optional',
    diagramReason: isNonEmptyString(data.diagramReason) ? data.diagramReason.trim() : ''
  }
}
