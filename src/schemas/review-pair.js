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
  if (!Array.isArray(value)) return []
  return value.filter(isNonEmptyString).map(item => item.trim())
}

function normalizeScoreItem(item, index) {
  return {
    label: normalizeString(item?.label, index === 0 ? '整題' : `part_${index + 1}`),
    awardedMarks: normalizeMarkNumber(item?.awardedMarks, 0),
    maxMarks: normalizeMarkNumber(item?.maxMarks, 0),
    comment: normalizeString(item?.comment)
  }
}

function normalizePairRoutingQuestion(item, index) {
  return {
    questionNumber: normalizeString(item?.questionNumber, String(index + 1)),
    reviewMode: item?.reviewMode === 'simple' || item?.reviewMode === 'hard' ? item.reviewMode : 'hard',
    normalizedQuestionText: normalizeString(item?.normalizedQuestionText),
    visibleMarks: normalizeString(item?.visibleMarks),
    topicTags: normalizeStringList(item?.topicTags),
    reasoning: normalizeString(item?.reasoning)
  }
}

function normalizePairReviewQuestion(item, index) {
  const scoreBreakdown = Array.isArray(item?.scoreBreakdown)
    ? item.scoreBreakdown.map((scoreItem, scoreIndex) => normalizeScoreItem(scoreItem, scoreIndex))
    : []

  const computedMax = scoreBreakdown.reduce((sum, scoreItem) => sum + scoreItem.maxMarks, 0)
  const computedAwarded = scoreBreakdown.reduce((sum, scoreItem) => sum + scoreItem.awardedMarks, 0)

  return {
    questionNumber: normalizeString(item?.questionNumber, String(index + 1)),
    answerVerdict: normalizeString(item?.answerVerdict),
    methodVerdict: normalizeString(item?.methodVerdict),
    referenceAnswer: normalizeString(item?.referenceAnswer),
    referenceReasoning: normalizeString(item?.referenceReasoning),
    whyWrong: normalizeString(item?.whyWrong),
    suggestedNextStep: normalizeString(item?.suggestedNextStep),
    scoreBreakdown: scoreBreakdown.length > 0
      ? scoreBreakdown
      : [{ label: '整題', awardedMarks: normalizeMarkNumber(item?.awardedTotalMarks, 0), maxMarks: normalizeMarkNumber(item?.maxTotalMarks, 0), comment: '' }],
    awardedTotalMarks: normalizeMarkNumber(item?.awardedTotalMarks, computedAwarded),
    maxTotalMarks: normalizeMarkNumber(item?.maxTotalMarks, computedMax),
    diagramDecision: item?.diagramDecision === 'required' || item?.diagramDecision === 'optional' || item?.diagramDecision === 'unnecessary'
      ? item.diagramDecision
      : 'unnecessary',
    diagramReason: normalizeString(item?.diagramReason)
  }
}

export function validateQuestionPairRoutingResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('雙題路由結果必須是物件')
  }

  const questions = Array.isArray(data.questions)
    ? data.questions.map((item, index) => normalizePairRoutingQuestion(item, index))
    : []

  if (questions.length === 0) {
    throw new Error('雙題路由結果缺少 questions')
  }

  return { questions }
}

export function validateReviewPairResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('雙題批改結果必須是物件')
  }

  const results = Array.isArray(data.results)
    ? data.results.map((item, index) => normalizePairReviewQuestion(item, index))
    : []

  if (results.length === 0) {
    throw new Error('雙題批改結果缺少 results')
  }

  return { results }
}
