function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateSolverResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('求解結果必須是物件')
  }

  if (!Array.isArray(data.steps)) {
    throw new Error('求解結果缺少 steps')
  }

  if (!isNonEmptyString(data.finalAnswer)) {
    throw new Error('求解結果缺少 finalAnswer')
  }

  return {
    steps: data.steps.filter(isNonEmptyString),
    finalAnswer: data.finalAnswer.trim(),
    confidence: isNonEmptyString(data.confidence) ? data.confidence.trim() : 'unknown',
    assumptions: Array.isArray(data.assumptions) ? data.assumptions.filter(isNonEmptyString) : [],
    summary: isNonEmptyString(data.summary) ? data.summary.trim() : ''
  }
}
