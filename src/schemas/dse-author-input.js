function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeString(value, fallback = '') {
  return isNonEmptyString(value) ? value.trim() : fallback
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => normalizeString(typeof item === 'string' ? item : item?.text || item?.label || ''))
    .filter(Boolean)
}

function normalizeDifficultyBand(value) {
  const normalized = normalizeString(value)
  return ['1', '2', '3', '4', '5', '5*', '5**'].includes(normalized) ? normalized : '3'
}

function normalizeMode(value) {
  return value === 'single' || value === 'set' || value === 'paper' ? value : 'single'
}

function normalizeQuestionType(value) {
  return value === 'mc' || value === 'long' || value === 'mixed' ? value : 'long'
}

function normalizeLanguage(value) {
  return value === 'zh-HK' || value === 'en' || value === 'bilingual' ? value : 'zh-HK'
}

function normalizeDiagramRequirement(value) {
  return value === 'required' || value === 'optional' || value === 'forbidden' ? value : 'optional'
}

function normalizePaperType(value) {
  return value === 'paper1' || value === 'paper2' || value === 'full' ? value : 'full'
}

function normalizePaperQuestionCount(mode, value) {
  if (mode === 'paper') return 0
  return Math.max(1, Number(value) || 1)
}

export function validateDseAuthorRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('請求體必須是 JSON 物件')
  }

  const mode = normalizeMode(body.mode)

  return {
    mode,
    questionType: normalizeQuestionType(body.questionType),
    language: normalizeLanguage(body.language),
    difficultyBand: normalizeDifficultyBand(body.difficultyBand),
    paperType: normalizePaperType(body.paperType),
    topicCoverage: normalizeStringList(body.topicCoverage),
    avoidTopics: normalizeStringList(body.avoidTopics),
    mustHaveQuestionCount: normalizePaperQuestionCount(mode, body.mustHaveQuestionCount),
    marksPerQuestion: Math.max(1, Number(body.marksPerQuestion) || 4),
    needsDiagram: normalizeDiagramRequirement(body.needsDiagram),
    useRealWorldContext: Boolean(body.useRealWorldContext),
    teacherGoal: normalizeString(body.teacherGoal),
    customConstraints: normalizeString(body.customConstraints),
    conversation: Array.isArray(body.conversation)
      ? body.conversation
          .map(item => ({
            role: item?.role === 'assistant' ? 'assistant' : 'user',
            content: normalizeString(item?.content)
          }))
          .filter(item => item.content)
      : []
  }
}

export function validateDseAuthorFollowupRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('請求體必須是 JSON 物件')
  }

  const sessionId = normalizeString(body.sessionId)
  const message = normalizeString(body.message)

  if (!sessionId) {
    throw new Error('缺少 sessionId')
  }

  if (!message) {
    throw new Error('缺少追問內容')
  }

  return { sessionId, message }
}

export function validateDseAuthorRevalidateRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('請求體必須是 JSON 物件')
  }

  const sessionId = normalizeString(body.sessionId)
  if (!sessionId) {
    throw new Error('缺少 sessionId')
  }

  const draft = body.draft
  if (!draft || typeof draft !== 'object') {
    throw new Error('缺少 draft')
  }

  return {
    sessionId,
    draft: {
      title: normalizeString(draft.title),
      questionTextZh: normalizeString(draft.questionTextZh),
      questionTextEn: normalizeString(draft.questionTextEn),
      answer: normalizeString(draft.answer),
      working: normalizeString(draft.working),
      markingScheme: normalizeString(draft.markingScheme),
      options: normalizeStringList(draft.options),
      needsDiagram: normalizeDiagramRequirement(draft.needsDiagram),
      diagramInstructions: normalizeString(draft.diagramInstructions)
    }
  }
}
