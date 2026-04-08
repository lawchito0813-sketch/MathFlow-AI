function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeString(value, fallback = '') {
  return isNonEmptyString(value) ? value.trim() : fallback
}

function normalizeMistakeStep(item) {
  if (typeof item === 'string' && item.trim()) {
    return item.trim()
  }

  if (item && typeof item === 'object') {
    if (typeof item.step === 'string' && item.step.trim()) return item.step.trim()
    if (typeof item.content === 'string' && item.content.trim()) return item.content.trim()
    if (typeof item.text === 'string' && item.text.trim()) return item.text.trim()
  }

  return ''
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return []
  return value.map(item => normalizeMistakeStep(item)).filter(Boolean)
}

function normalizeMarkNumber(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return fallback
  return Math.round(number * 100) / 100
}

function normalizeScoreItem(item, index) {
  return {
    label: normalizeString(item?.label, index === 0 ? '整題' : `part_${index + 1}`),
    awardedMarks: normalizeMarkNumber(item?.awardedMarks, 0),
    maxMarks: normalizeMarkNumber(item?.maxMarks, 0),
    comment: normalizeString(item?.comment)
  }
}

export function validateReviewResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('批改結果必須是物件')
  }

  const scoreBreakdown = Array.isArray(data.scoreBreakdown)
    ? data.scoreBreakdown.map((item, index) => normalizeScoreItem(item, index)).filter(item => item.maxMarks >= 0)
    : []

  const computedMax = scoreBreakdown.reduce((sum, item) => sum + item.maxMarks, 0)
  const computedAwarded = scoreBreakdown.reduce((sum, item) => sum + item.awardedMarks, 0)

  return {
    isCorrect: typeof data.isCorrect === 'boolean' ? data.isCorrect : false,
    answerVerdict: normalizeString(data.answerVerdict),
    methodVerdict: normalizeString(data.methodVerdict),
    mistakeSteps: normalizeStringList(data.mistakeSteps),
    whyWrong: normalizeString(data.whyWrong),
    markingNotes: normalizeStringList(data.markingNotes),
    suggestedNextStep: normalizeString(data.suggestedNextStep),
    referenceAnswer: normalizeString(data.referenceAnswer),
    referenceReasoning: normalizeString(data.referenceReasoning),
    scoreJudgement: normalizeString(data.scoreJudgement),
    scoreBreakdown: scoreBreakdown.length > 0
      ? scoreBreakdown
      : [{ label: '整題', awardedMarks: normalizeMarkNumber(data.awardedTotalMarks, 0), maxMarks: normalizeMarkNumber(data.maxTotalMarks, 0), comment: '' }],
    awardedTotalMarks: normalizeMarkNumber(data.awardedTotalMarks, computedAwarded),
    maxTotalMarks: normalizeMarkNumber(data.maxTotalMarks, computedMax),
    followupHint: normalizeString(data.followupHint),
    diagramDecision: data.diagramDecision === 'required' || data.diagramDecision === 'optional' || data.diagramDecision === 'unnecessary'
      ? data.diagramDecision
      : 'unnecessary',
    diagramReason: normalizeString(data.diagramReason)
  }
}
