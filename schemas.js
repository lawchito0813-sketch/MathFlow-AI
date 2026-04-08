function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateSolveRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体必须是 JSON 对象')
  }

  const hasText = isNonEmptyString(body.text)
  const hasImage = isNonEmptyString(body.imageBase64)

  if (!hasText && !hasImage) {
    throw new Error('必须提供 text 或 imageBase64')
  }

  if (hasText && hasImage) {
    throw new Error('text 和 imageBase64 只能二选一')
  }

  return {
    type: hasImage ? 'image' : 'text',
    text: hasText ? body.text.trim() : '',
    imageBase64: hasImage ? body.imageBase64.trim() : ''
  }
}

export function validateNormalizedProblem(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('题目标准化结果必须是对象')
  }
  if (!isNonEmptyString(data.problemText)) {
    throw new Error('题目标准化结果缺少 problemText')
  }
  return {
    sourceType: data.sourceType === 'image' ? 'image' : 'text',
    problemText: data.problemText.trim(),
    extractedText: isNonEmptyString(data.extractedText) ? data.extractedText.trim() : '',
    knownConditions: Array.isArray(data.knownConditions) ? data.knownConditions.filter(isNonEmptyString) : [],
    goal: isNonEmptyString(data.goal) ? data.goal.trim() : '',
    requiresDiagram: Boolean(data.requiresDiagram)
  }
}

export function validateSolverResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('求解结果必须是对象')
  }
  if (!Array.isArray(data.steps)) {
    throw new Error('求解结果缺少 steps')
  }
  if (!isNonEmptyString(data.finalAnswer)) {
    throw new Error('求解结果缺少 finalAnswer')
  }
  return {
    steps: data.steps.filter(isNonEmptyString),
    finalAnswer: data.finalAnswer.trim(),
    confidence: isNonEmptyString(data.confidence) ? data.confidence.trim() : 'unknown',
    assumptions: Array.isArray(data.assumptions) ? data.assumptions.filter(isNonEmptyString) : [],
    summary: isNonEmptyString(data.summary) ? data.summary.trim() : ''
  }
}

export function validateJudgeResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('裁决结果必须是对象')
  }
  if (!isNonEmptyString(data.finalAnswer)) {
    throw new Error('裁决结果缺少 finalAnswer')
  }
  return {
    finalAnswer: data.finalAnswer.trim(),
    chosenSolver: data.chosenSolver === 'A' || data.chosenSolver === 'B' ? data.chosenSolver : 'A',
    reasoning: isNonEmptyString(data.reasoning) ? data.reasoning.trim() : '',
    conflictPoints: Array.isArray(data.conflictPoints) ? data.conflictPoints.filter(isNonEmptyString) : [],
    confidence: isNonEmptyString(data.confidence) ? data.confidence.trim() : 'unknown'
  }
}

export function validateDiagramPlan(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('绘图规格必须是对象')
  }
  return {
    title: isNonEmptyString(data.title) ? data.title.trim() : '数学题图形',
    description: isNonEmptyString(data.description) ? data.description.trim() : '',
    shapes: Array.isArray(data.shapes) ? data.shapes : [],
    labels: Array.isArray(data.labels) ? data.labels : []
  }
}
