function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeQuestion(item, index) {
  return {
    questionNumber: isNonEmptyString(item?.questionNumber) ? item.questionNumber.trim() : `${index + 1}`,
    paperSection: item?.paperSection === 'A' || item?.paperSection === 'B' ? item.paperSection : 'B',
    questionType: item?.questionType === 'mc' || item?.questionType === 'long' ? item.questionType : 'long',
    difficultyBand: ['1', '2', '3', '4', '5', '5*', '5**'].includes(String(item?.difficultyBand || '')) ? String(item.difficultyBand) : '3',
    topicTags: Array.isArray(item?.topicTags) ? item.topicTags.filter(isNonEmptyString).map(value => value.trim()) : [],
    subtopicTags: Array.isArray(item?.subtopicTags) ? item.subtopicTags.filter(isNonEmptyString).map(value => value.trim()) : [],
    marks: Math.max(1, Number(item?.marks) || 4),
    needsDiagram: item?.needsDiagram === 'required' || item?.needsDiagram === 'optional' || item?.needsDiagram === 'forbidden' ? item.needsDiagram : 'optional',
    answerForm: isNonEmptyString(item?.answerForm) ? item.answerForm.trim() : '',
    blueprintNotes: isNonEmptyString(item?.blueprintNotes) ? item.blueprintNotes.trim() : ''
  }
}

function minimumQuestionCount(data) {
  const mode = data?.mode === 'paper' ? 'paper' : 'single'
  return mode === 'paper' ? 2 : 1
}

export function validateDseAuthorBlueprint(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('出題藍圖結果必須是物件')
  }

  const questions = Array.isArray(data.questions)
    ? data.questions.map((item, index) => normalizeQuestion(item, index))
    : []

  const minQuestionCount = minimumQuestionCount(data)
  if (questions.length < minQuestionCount) {
    throw new Error(minQuestionCount > 1 ? '整卷藍圖至少需要兩題，不能把單題當整卷。' : '出題藍圖至少需要一題')
  }

  return {
    paperType: data.paperType === 'paper1' || data.paperType === 'paper2' || data.paperType === 'full' ? data.paperType : 'full',
    paperTitle: isNonEmptyString(data.paperTitle) ? data.paperTitle.trim() : '',
    structureSummary: isNonEmptyString(data.structureSummary) ? data.structureSummary.trim() : '',
    questions
  }
}
