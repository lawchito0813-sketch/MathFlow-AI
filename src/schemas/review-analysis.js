function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeString(value, fallback = '') {
  return isNonEmptyString(value) ? value.trim() : fallback
}

function normalizeMarkNumber(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return fallback
  return Math.round(number * 100) / 100
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.filter(item => isNonEmptyString(item)).map(item => item.trim())
    : []
}

function normalizeScoreItem(item, index) {
  return {
    label: normalizeString(item?.label, index === 0 ? '整題' : `part_${index + 1}`),
    suggestedMarks: normalizeMarkNumber(item?.suggestedMarks, 0),
    maxMarks: normalizeMarkNumber(item?.maxMarks, 0),
    rationale: normalizeString(item?.rationale)
  }
}

export function validateReviewAnalysisResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('批改分析結果必須是物件')
  }

  return {
    answerVerdict: normalizeString(data.answerVerdict),
    methodVerdict: normalizeString(data.methodVerdict),
    referenceAnswer: normalizeString(data.referenceAnswer),
    referenceReasoning: normalizeString(data.referenceReasoning),
    keyMistakes: normalizeStringList(data.keyMistakes),
    markingNotes: normalizeStringList(data.markingNotes),
    scoreBreakdownSuggestion: Array.isArray(data.scoreBreakdownSuggestion)
      ? data.scoreBreakdownSuggestion.map((item, index) => normalizeScoreItem(item, index))
      : [],
    diagramDecision: data.diagramDecision === 'required' || data.diagramDecision === 'optional' || data.diagramDecision === 'unnecessary'
      ? data.diagramDecision
      : 'unnecessary',
    diagramReason: normalizeString(data.diagramReason)
  }
}
