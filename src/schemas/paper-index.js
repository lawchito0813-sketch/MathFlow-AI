function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeQuestion(item, index) {
  const pageRange = Array.isArray(item?.pageRange)
    ? item.pageRange.map(value => Number(value)).filter(Number.isFinite)
    : []

  return {
    questionNumber: isNonEmptyString(item?.questionNumber) ? item.questionNumber.trim() : `Q${index + 1}`,
    pageRange,
    samePageMultiQuestion: Boolean(item?.samePageMultiQuestion),
    crossPage: Boolean(item?.crossPage),
    visibleMarks: isNonEmptyString(item?.visibleMarks) ? item.visibleMarks.trim() : '',
    regionHint: isNonEmptyString(item?.regionHint) ? item.regionHint.trim() : '',
    confidence: item?.confidence === 'low' || item?.confidence === 'medium' || item?.confidence === 'high'
      ? item.confidence
      : 'medium'
  }
}

export function validatePaperIndexResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('整卷索引結果必須是物件')
  }

  const questions = Array.isArray(data.questions)
    ? data.questions.map((item, index) => normalizeQuestion(item, index))
    : []

  if (questions.length === 0) {
    throw new Error('未能識別任何題目')
  }

  return {
    questions,
    summary: typeof data.summary === 'string' ? data.summary.trim() : ''
  }
}
