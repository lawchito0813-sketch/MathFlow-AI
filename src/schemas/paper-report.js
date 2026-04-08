function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeString(value, fallback = '') {
  return isNonEmptyString(value) ? value.trim() : fallback
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return fallback
  return Math.round(number * 100) / 100
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return []
  return value.filter(isNonEmptyString).map(item => item.trim())
}

function normalizeQuestionSummary(item, index) {
  return {
    questionNumber: normalizeString(item?.questionNumber, String(index + 1)),
    status: ['completed', 'failed', 'partial'].includes(item?.status) ? item.status : 'partial',
    awardedMarks: normalizeNumber(item?.awardedMarks, 0),
    maxMarks: normalizeNumber(item?.maxMarks, 0),
    summary: normalizeString(item?.summary),
    weakTopics: normalizeStringList(item?.weakTopics),
    mistakeTypes: normalizeStringList(item?.mistakeTypes)
  }
}

function normalizeWeakTopic(item, index) {
  return {
    topic: normalizeString(item?.topic, `topic_${index + 1}`),
    lostMarks: normalizeNumber(item?.lostMarks, 0),
    questionNumbers: normalizeStringList(item?.questionNumbers),
    reasoning: normalizeString(item?.reasoning)
  }
}

export function validatePaperReportResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('整卷報告結果必須是物件')
  }

  const questionSummaries = Array.isArray(data.questionSummaries)
    ? data.questionSummaries.map((item, index) => normalizeQuestionSummary(item, index))
    : []

  const weakTopics = Array.isArray(data.weakTopics)
    ? data.weakTopics.map((item, index) => normalizeWeakTopic(item, index))
    : []

  const computedTotal = questionSummaries.reduce((sum, item) => sum + item.awardedMarks, 0)
  const computedMax = questionSummaries.reduce((sum, item) => sum + item.maxMarks, 0)

  return {
    totalScore: normalizeNumber(data.totalScore, computedTotal),
    maxScore: normalizeNumber(data.maxScore, computedMax),
    questionSummaries,
    weakTopics,
    overallComment: normalizeString(data.overallComment),
    mistakePatterns: normalizeStringList(data.mistakePatterns),
    recommendations: normalizeStringList(data.recommendations)
  }
}
