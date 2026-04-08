function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateQuestionRoutingResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('題目路由結果必須是物件')
  }

  const reviewMode = data.reviewMode === 'simple' || data.reviewMode === 'hard'
    ? data.reviewMode
    : 'hard'

  return {
    reviewMode,
    normalizedQuestionText: isNonEmptyString(data.normalizedQuestionText) ? data.normalizedQuestionText.trim() : '',
    visibleMarks: isNonEmptyString(data.visibleMarks) ? data.visibleMarks.trim() : '',
    topicTags: Array.isArray(data.topicTags)
      ? data.topicTags.filter(item => isNonEmptyString(item)).map(item => item.trim())
      : [],
    reasoning: isNonEmptyString(data.reasoning) ? data.reasoning.trim() : ''
  }
}
