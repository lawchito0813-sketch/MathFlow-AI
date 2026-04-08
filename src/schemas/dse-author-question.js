function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeBaseQuestion(data) {
  return {
    questionNumber: isNonEmptyString(data.questionNumber) ? data.questionNumber.trim() : '1',
    title: isNonEmptyString(data.title) ? data.title.trim() : '',
    paperSection: data.paperSection === 'A' || data.paperSection === 'B' ? data.paperSection : 'B',
    questionType: data.questionType === 'mc' || data.questionType === 'long' ? data.questionType : 'long',
    difficultyBand: ['1', '2', '3', '4', '5', '5*', '5**'].includes(String(data.difficultyBand || '')) ? String(data.difficultyBand) : '3',
    topicTags: Array.isArray(data.topicTags) ? data.topicTags.filter(isNonEmptyString).map(item => item.trim()) : [],
    questionTextZh: isNonEmptyString(data.questionTextZh) ? data.questionTextZh.trim() : '',
    questionTextEn: isNonEmptyString(data.questionTextEn) ? data.questionTextEn.trim() : '',
    options: Array.isArray(data.options) ? data.options.filter(isNonEmptyString).map(item => item.trim()) : [],
    marks: Math.max(1, Number(data.marks) || 4),
    needsDiagram: data.needsDiagram === 'required' || data.needsDiagram === 'optional' || data.needsDiagram === 'forbidden' ? data.needsDiagram : 'optional',
    diagramInstructions: isNonEmptyString(data.diagramInstructions) ? data.diagramInstructions.trim() : ''
  }
}

export function validateDseAuthorQuestionDraft(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('出題結果必須是物件')
  }

  return normalizeBaseQuestion(data)
}

export function validateDseAuthorQuestionCompletion(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('補全結果必須是物件')
  }

  return {
    answer: isNonEmptyString(data.answer) ? data.answer.trim() : '',
    working: isNonEmptyString(data.working) ? data.working.trim() : '',
    markingScheme: isNonEmptyString(data.markingScheme) ? data.markingScheme.trim() : '',
    qualityChecks: Array.isArray(data.qualityChecks) ? data.qualityChecks.filter(isNonEmptyString).map(item => item.trim()) : []
  }
}

export function validateDseAuthorQuestion(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('出題結果必須是物件')
  }

  return {
    ...normalizeBaseQuestion(data),
    answer: isNonEmptyString(data.answer) ? data.answer.trim() : '',
    working: isNonEmptyString(data.working) ? data.working.trim() : '',
    markingScheme: isNonEmptyString(data.markingScheme) ? data.markingScheme.trim() : '',
    qualityChecks: Array.isArray(data.qualityChecks) ? data.qualityChecks.filter(isNonEmptyString).map(item => item.trim()) : []
  }
}
