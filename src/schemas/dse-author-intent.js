function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeQuestionCount(mode, value) {
  if (mode === 'paper') return 0
  return Math.max(1, Number(value) || 1)
}

export function validateDseAuthorIntent(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('出題意圖結果必須是物件')
  }

  const mode = data.mode === 'single' || data.mode === 'set' || data.mode === 'paper' ? data.mode : 'single'

  return {
    mode,
    questionType: data.questionType === 'mc' || data.questionType === 'long' || data.questionType === 'mixed' ? data.questionType : 'long',
    language: data.language === 'zh-HK' || data.language === 'en' || data.language === 'bilingual' ? data.language : 'zh-HK',
    difficultyBand: ['1', '2', '3', '4', '5', '5*', '5**'].includes(String(data.difficultyBand || '')) ? String(data.difficultyBand) : '3',
    paperType: data.paperType === 'paper1' || data.paperType === 'paper2' || data.paperType === 'full' ? data.paperType : 'full',
    topicCoverage: Array.isArray(data.topicCoverage) ? data.topicCoverage.filter(isNonEmptyString).map(item => item.trim()) : [],
    avoidTopics: Array.isArray(data.avoidTopics) ? data.avoidTopics.filter(isNonEmptyString).map(item => item.trim()) : [],
    needsDiagram: data.needsDiagram === 'required' || data.needsDiagram === 'optional' || data.needsDiagram === 'forbidden' ? data.needsDiagram : 'optional',
    useRealWorldContext: Boolean(data.useRealWorldContext),
    mustHaveQuestionCount: normalizeQuestionCount(mode, data.mustHaveQuestionCount),
    marksPerQuestion: Math.max(1, Number(data.marksPerQuestion) || 4),
    teacherGoal: isNonEmptyString(data.teacherGoal) ? data.teacherGoal.trim() : '',
    customConstraints: isNonEmptyString(data.customConstraints) ? data.customConstraints.trim() : '',
    missingFields: Array.isArray(data.missingFields) ? data.missingFields.filter(isNonEmptyString).map(item => item.trim()) : [],
    assistantQuestion: isNonEmptyString(data.assistantQuestion) ? data.assistantQuestion.trim() : '',
    readyToGenerate: Boolean(data.readyToGenerate),
    intentSummary: isNonEmptyString(data.intentSummary) ? data.intentSummary.trim() : ''
  }
}
