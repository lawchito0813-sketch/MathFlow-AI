function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function cleanExplanationText(value) {
  if (!isNonEmptyString(value)) {
    return ''
  }

  return value
    .replaceAll('\\r\\n', '\n')
    .replaceAll('\\n', '\n')
    .replaceAll('\\t', ' ')
    .replaceAll(/\\quad/g, ' ')
    .replaceAll(/\\,/g, ' ')
    .replaceAll(/[ \t]+\n/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .replaceAll(/[ \t]{2,}/g, ' ')
    .trim()
}

function normalizeStep(step) {
  if (!step || typeof step !== 'object') {
    return null
  }

  const heading = cleanExplanationText(step.heading)
  const content = cleanExplanationText(step.content)
  if (!heading && !content) {
    return null
  }

  return {
    heading: heading || '步驟',
    content
  }
}

export function validateFinalExplanationResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('最終講解結果必須是物件')
  }

  const title = cleanExplanationText(data.title) || '最終講解'
  const translation = cleanExplanationText(data.translation)
  const answerSummary = cleanExplanationText(data.answerSummary)

  if (!answerSummary) {
    throw new Error('最終講解結果缺少 answerSummary')
  }

  const steps = Array.isArray(data.steps) ? data.steps.map(normalizeStep).filter(Boolean).slice(0, 4) : []

  return {
    title,
    translation,
    answerSummary,
    steps,
    diagramReference: cleanExplanationText(data.diagramReference),
    commonTraps: [],
    conceptTeaching: [],
    formulaNotes: []
  }
}
