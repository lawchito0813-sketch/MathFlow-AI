import { createEvent, SESSION_EVENT_TYPES } from './events.js'
import { solveProblem, judgeSolutions, planDiagram } from './model-client.js'
import {
  buildDiagramPlanPrompt,
  buildJudgePrompt,
  buildNormalizeImagePrompt,
  buildSolverPrompt
} from './prompts.js'
import {
  validateDiagramPlan,
  validateJudgeResult,
  validateNormalizedProblem,
  validateSolverResult
} from './schemas.js'
import { renderDiagramPngDataUrl } from './diagram-renderer.js'

function parseJsonFromText(text) {
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('模型未返回合法 JSON')
  }
  return JSON.parse(trimmed.slice(start, end + 1))
}

function createFallbackNormalizedProblem(input) {
  if (input.type === 'text') {
    return {
      sourceType: 'text',
      problemText: input.text,
      extractedText: input.text,
      knownConditions: [],
      goal: '',
      requiresDiagram: false
    }
  }
  return {
    sourceType: 'image',
    problemText: '请根据图片内容解题',
    extractedText: '',
    knownConditions: [],
    goal: '',
    requiresDiagram: true
  }
}

export async function runSolveFlow({ input, emit, storeSession }) {
  emit(createEvent(SESSION_EVENT_TYPES.SESSION_STARTED, { sourceType: input.type }))
  emit(createEvent(SESSION_EVENT_TYPES.INPUT_RECEIVED, { sourceType: input.type }))

  let normalizedProblem = createFallbackNormalizedProblem(input)

  if (input.type === 'image') {
    const prompt = buildNormalizeImagePrompt()
    const normalizeResponse = await solveProblem(prompt)
    normalizedProblem = validateNormalizedProblem(parseJsonFromText(normalizeResponse.text))
  }

  normalizedProblem = validateNormalizedProblem(normalizedProblem)
  emit(createEvent(SESSION_EVENT_TYPES.PROBLEM_NORMALIZED, normalizedProblem))

  const solverAPrompt = buildSolverPrompt({ variant: 'A', sourceType: input.type, normalizedProblem })
  const solverBPrompt = buildSolverPrompt({ variant: 'B', sourceType: input.type, normalizedProblem })

  emit(createEvent(SESSION_EVENT_TYPES.SOLVER_A_STARTED, {}))
  emit(createEvent(SESSION_EVENT_TYPES.SOLVER_B_STARTED, {}))

  let solverAText = ''
  let solverBText = ''

  const [solverAResponse, solverBResponse] = await Promise.all([
    solveProblem(solverAPrompt, delta => {
      solverAText += delta
      emit(createEvent(SESSION_EVENT_TYPES.SOLVER_A_DELTA, { delta }))
    }),
    solveProblem(solverBPrompt, delta => {
      solverBText += delta
      emit(createEvent(SESSION_EVENT_TYPES.SOLVER_B_DELTA, { delta }))
    })
  ])

  solverAText = solverAText || solverAResponse.text
  solverBText = solverBText || solverBResponse.text

  const solverA = validateSolverResult(parseJsonFromText(solverAText))
  const solverB = validateSolverResult(parseJsonFromText(solverBText))

  emit(createEvent(SESSION_EVENT_TYPES.SOLVER_A_DONE, solverA))
  emit(createEvent(SESSION_EVENT_TYPES.SOLVER_B_DONE, solverB))

  const judgePrompt = buildJudgePrompt({ normalizedProblem, solverA, solverB })
  emit(createEvent(SESSION_EVENT_TYPES.JUDGE_STARTED, {}))

  let judgeText = ''
  const judgeResponse = await judgeSolutions(judgePrompt, delta => {
    judgeText += delta
    emit(createEvent(SESSION_EVENT_TYPES.JUDGE_DELTA, { delta }))
  })

  judgeText = judgeText || judgeResponse.text
  const judgeResult = validateJudgeResult(parseJsonFromText(judgeText))

  emit(createEvent(SESSION_EVENT_TYPES.JUDGE_DONE, judgeResult))
  emit(createEvent(SESSION_EVENT_TYPES.FINAL_ANSWER_READY, judgeResult))

  const session = {
    input,
    normalizedProblem,
    solverA,
    solverB,
    judgeResult,
    diagramImage: null
  }

  storeSession(session)
  return session
}

export async function runDiagramFlow({ session, emit, storeSession }) {
  emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_STARTED, {}))

  const prompt = buildDiagramPlanPrompt({
    normalizedProblem: session.normalizedProblem,
    judgeResult: session.judgeResult
  })

  const response = await planDiagram(prompt)
  const plan = validateDiagramPlan(parseJsonFromText(response.text))
  const imageDataUrl = renderDiagramPngDataUrl(plan)

  const updatedSession = {
    ...session,
    diagramImage: imageDataUrl,
    diagramPlan: plan
  }

  storeSession(updatedSession)
  emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_DONE, {
    imageDataUrl
  }))

  return updatedSession
}
