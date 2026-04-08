function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateNormalizedProblem(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('題目標準化結果必須是物件')
  }

  if (!isNonEmptyString(data.problemText)) {
    throw new Error('題目標準化結果缺少 problemText')
  }

  return {
    sourceType: data.sourceType === 'image' ? 'image' : 'text',
    problemText: data.problemText.trim(),
    extractedText: isNonEmptyString(data.extractedText) ? data.extractedText.trim() : '',
    knownConditions: Array.isArray(data.knownConditions) ? data.knownConditions.filter(isNonEmptyString) : [],
    goal: isNonEmptyString(data.goal) ? data.goal.trim() : '',
    requiresDiagram: Boolean(data.requiresDiagram)
  }
}
