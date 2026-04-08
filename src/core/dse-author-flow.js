import { createEvent, SESSION_EVENT_TYPES } from '../utils/events.js'
import { solveProblem, judgeSolutions, generateFinalExplanation, requestModel } from '../model/client.js'
import {
  buildSolverPrompt,
  buildJudgePrompt,
  buildDseAuthorIntentPrompt,
  buildDseAuthorIntentRepairPrompt,
  buildDseAuthorBlueprintPrompt,
  buildDseAuthorBlueprintRepairPrompt,
  buildDseAuthorQuestionPrompt,
  buildDseAuthorQuestionRepairPrompt,
  buildDseAuthorPaperPrompt
} from '../prompts/index.js'
import {
  validateSolverResult,
  validateJudgeResult,
  validateDseAuthorIntent,
  validateDseAuthorBlueprint,
  validateDseAuthorQuestion,
  validateDseAuthorPaper
} from '../schemas/index.js'
import { getSession, setSession } from './session-store.js'
import { runStructuredStage } from './structured-stage.js'

function createStructuredRequester(requestFn, emitDelta) {
  return (prompt, onDelta) => requestFn(prompt, delta => {
    emitDelta?.(delta)
    onDelta?.(delta)
  })
}

function createModelCallConfig({ scope, callRole, providerId, stageKey, questionNumber = '' }) {
  return {
    scope,
    callRole,
    providerId,
    stageKey,
    questionNumber
  }
}

function toAuthorConversation(history = []) {
  return Array.isArray(history)
    ? history.filter(item => item && typeof item === 'object' && typeof item.content === 'string' && item.content.trim())
    : []
}

function buildQuestionSolveInput(question) {
  return {
    type: 'text',
    text: question.questionTextZh || question.questionTextEn || '',
    mode: question.questionType === 'mc' ? 'simple' : 'hard'
  }
}

function extractQuestionAnswerFromWorking(working) {
  const text = String(working || '').trim()
  if (!text) return ''
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.at(-1) || text
}

function normalizeQuestionWithVerification(question, judgeResult, solverA, solverB) {
  const verifiedAnswer = String(judgeResult?.finalAnswer || '').trim()
  return {
    ...question,
    answer: verifiedAnswer || question.answer,
    verification: {
      finalAnswer: verifiedAnswer,
      reasoning: judgeResult.reasoning,
      confidence: judgeResult.confidence,
      chosenSolver: judgeResult.chosenSolver,
      conflictPoints: judgeResult.conflictPoints || []
    },
    solverA,
    solverB
  }
}

async function runQuestionVerification({ question, providerId, emit }) {
  const input = buildQuestionSolveInput(question)
  const normalizedProblem = {
    sourceType: 'text',
    problemText: input.text,
    extractedText: input.text,
    knownConditions: [],
    goal: '',
    requiresDiagram: question.needsDiagram === 'required'
  }

  let solverA = null
  let solverB = null

  if (question.questionType === 'long') {
    solverA = await runStructuredStage({
      stageKey: `author_solver_a_${question.questionNumber}`,
      emit,
      request: createStructuredRequester(solveProblem),
      mainPrompt: { ...buildSolverPrompt({ variant: 'A', sourceType: 'text', normalizedProblem, originalInput: input }), providerId },
      compactPrompt: { ...buildSolverPrompt({ variant: 'A', sourceType: 'text', normalizedProblem, originalInput: input, compact: true }), providerId, stream: true, maxCompletionTokens: 2200 },
      buildRepairPrompt: options => ({ ...buildDseAuthorQuestionRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 2200 }),
      validator: validateSolverResult,
      repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
      compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
      failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
      fallback: () => ({ steps: [], finalAnswer: extractQuestionAnswerFromWorking(question.working) || question.answer || '未能驗算', confidence: 'low', assumptions: [], summary: '驗算失敗，使用草稿答案保底。' }),
      modelCall: createModelCallConfig({ scope: 'dse_author', callRole: 'solver_a', providerId, stageKey: `author_solver_a_${question.questionNumber}`, questionNumber: question.questionNumber })
    })

    solverB = await runStructuredStage({
      stageKey: `author_solver_b_${question.questionNumber}`,
      emit,
      request: createStructuredRequester(solveProblem),
      mainPrompt: { ...buildSolverPrompt({ variant: 'B', sourceType: 'text', normalizedProblem, originalInput: input }), providerId },
      compactPrompt: { ...buildSolverPrompt({ variant: 'B', sourceType: 'text', normalizedProblem, originalInput: input, compact: true }), providerId, stream: true, maxCompletionTokens: 2200 },
      buildRepairPrompt: options => ({ ...buildDseAuthorQuestionRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 2200 }),
      validator: validateSolverResult,
      repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
      compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
      failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
      fallback: () => ({ steps: [], finalAnswer: extractQuestionAnswerFromWorking(question.working) || question.answer || '未能驗算', confidence: 'low', assumptions: [], summary: '驗算失敗，使用草稿答案保底。' }),
      modelCall: createModelCallConfig({ scope: 'dse_author', callRole: 'solver_b', providerId, stageKey: `author_solver_b_${question.questionNumber}`, questionNumber: question.questionNumber })
    })
  }

  const judgePrompt = question.questionType === 'mc'
    ? { ...buildJudgePrompt({ normalizedProblem, solverA: { finalAnswer: question.answer || extractQuestionAnswerFromWorking(question.working) || '', summary: question.working || '' }, solverB: { finalAnswer: question.answer || extractQuestionAnswerFromWorking(question.working) || '', summary: question.markingScheme || '' } }), providerId }
    : { ...buildJudgePrompt({ normalizedProblem, solverA, solverB }), providerId }

  const judgeResult = await runStructuredStage({
    stageKey: `author_verify_${question.questionNumber}`,
    emit,
    request: createStructuredRequester(judgeSolutions),
    mainPrompt: judgePrompt,
    compactPrompt: { ...buildJudgePrompt({ normalizedProblem, solverA: solverA || { finalAnswer: question.answer || '', summary: question.working || '' }, solverB: solverB || { finalAnswer: question.answer || '', summary: question.markingScheme || '' }, compact: true }), providerId, stream: true, maxCompletionTokens: 2200 },
    buildRepairPrompt: options => ({ ...buildDseAuthorQuestionRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 2200 }),
    validator: validateJudgeResult,
    repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
    compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
    failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
    fallback: () => ({ finalAnswer: question.answer || extractQuestionAnswerFromWorking(question.working) || '未能驗算', chosenSolver: 'neither', reasoning: '驗算失敗，暫保留草稿答案。', conflictPoints: [], confidence: 'low', diagramDecision: question.needsDiagram === 'required' ? 'required' : 'optional', diagramReason: question.diagramInstructions || '' }),
    modelCall: createModelCallConfig({ scope: 'dse_author', callRole: 'verifier', providerId, stageKey: `author_verify_${question.questionNumber}`, questionNumber: question.questionNumber })
  })

  return normalizeQuestionWithVerification(question, judgeResult, solverA, solverB)
}

async function runDraftFinalExplanation({ session, emit }) {
  const prompt = {
    providerId: session.providerId,
    system: [
      '你是 DSE 出題系統的老師版說明助手。',
      '請根據整份草稿，輸出給老師看的簡短自然語言總結。',
      '不要輸出 JSON。不要輸出 markdown 程式碼區塊。'
    ].join('\n\n'),
    user() {
      return [
        `卷名: ${session.paper?.paperTitle || ''}`,
        `卷別: ${session.paper?.paperType || session.intent?.paperType || 'full'}`,
        `題目數: ${(session.generatedQuestions || []).length}`,
        '題目概覽:',
        ...(session.generatedQuestions || []).map(item => `${item.questionNumber}. ${item.title || ''}｜${item.questionType}｜${item.difficultyBand}｜${(item.topicTags || []).join(' / ')}｜答案 ${item.answer || item.verification?.finalAnswer || ''}`)
      ].join('\n\n')
    },
    stream: true,
    maxCompletionTokens: 2400
  }

  let text = ''
  try {
    const response = await generateFinalExplanation(prompt, delta => {
      text += delta
      emit(createEvent(SESSION_EVENT_TYPES.FINAL_EXPLANATION_DELTA, { delta, text }))
    })
    text = (text || response.text || '').trim()
  } catch {
    text = ''
  }

  return text || '已完成 DSE 出題草稿生成。你可以繼續修改題目後再次驗算。'
}

function createSessionPayload({ sessionId, providerId, request, intent, blueprint, generatedQuestions, paper, followupMessages = [], finalExplanation = '' }) {
  return {
    sessionId,
    providerId,
    flowType: 'dse-author',
    request,
    intent,
    blueprint,
    generatedQuestions,
    paper,
    followupMessages,
    finalExplanation,
    diagramImage: null,
    diagramPlan: null,
    reviewMode: 'author'
  }
}

function getFollowupMessages(session) {
  return toAuthorConversation(session?.followupMessages || session?.request?.conversation || [])
}

async function waitForSession(sessionId, timeoutMs = 240000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const session = getSession(sessionId)
    if (session) return session
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return getSession(sessionId)
}

export async function runDseAuthorFlow({ sessionId, request, providerId, emit }) {
  emit(createEvent(SESSION_EVENT_TYPES.SESSION_STARTED, { sessionId, sourceType: 'dse-author', mode: request.mode || 'single' }))
  emit(createEvent(SESSION_EVENT_TYPES.INPUT_RECEIVED, { sourceType: 'dse-author', mode: request.mode || 'single' }))
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_INTAKE_STARTED, {}))

  const intentPrompt = { ...buildDseAuthorIntentPrompt({ request }), providerId }
  const intent = await runStructuredStage({
    stageKey: 'author_intake',
    emit,
    request: createStructuredRequester(judgeSolutions),
    mainPrompt: intentPrompt,
    compactPrompt: { ...buildDseAuthorIntentPrompt({ request, compact: true }), providerId, stream: true, maxCompletionTokens: 1800 },
    buildRepairPrompt: options => ({ ...buildDseAuthorIntentRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 1800 }),
    validator: validateDseAuthorIntent,
    repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
    compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
    failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
    fallback: () => ({ ...request, missingFields: ['teacherGoal'], assistantQuestion: '你想這份題目最主要訓練學生哪一種能力？', readyToGenerate: false, intentSummary: request.teacherGoal || '資料不足' }),
    modelCall: createModelCallConfig({ scope: 'dse_author', callRole: 'intake', providerId, stageKey: 'author_intake' })
  })
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_INTAKE_DONE, intent))

  if (!intent.readyToGenerate) {
    const pendingSession = createSessionPayload({ sessionId, providerId, request, intent, blueprint: null, generatedQuestions: [], paper: null, followupMessages: toAuthorConversation(request.conversation) })
    setSession(sessionId, pendingSession)
    emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_FOLLOWUP_REQUESTED, { question: intent.assistantQuestion, missingFields: intent.missingFields }))
    return pendingSession
  }

  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_BLUEPRINT_STARTED, {}))
  const blueprintPrompt = { ...buildDseAuthorBlueprintPrompt({ intent }), providerId }
  const blueprint = await runStructuredStage({
    stageKey: 'author_blueprint',
    emit,
    request: createStructuredRequester(judgeSolutions),
    mainPrompt: blueprintPrompt,
    compactPrompt: { ...buildDseAuthorBlueprintPrompt({ intent, compact: true }), providerId, stream: true, maxCompletionTokens: 2200 },
    buildRepairPrompt: options => ({ ...buildDseAuthorBlueprintRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 2200 }),
    validator: validateDseAuthorBlueprint,
    repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
    compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
    failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
    fallback: () => ({ paperType: intent.paperType, paperTitle: 'DSE Math Draft', structureSummary: intent.intentSummary || '', questions: Array.from({ length: intent.mustHaveQuestionCount || 1 }, (_, index) => ({ questionNumber: `${index + 1}`, paperSection: intent.paperType === 'paper2' ? 'A' : 'B', questionType: intent.questionType === 'mixed' ? (index === 0 && intent.paperType === 'paper2' ? 'mc' : 'long') : (intent.questionType === 'mc' ? 'mc' : 'long'), difficultyBand: intent.difficultyBand, topicTags: intent.topicCoverage || [], subtopicTags: [], marks: intent.marksPerQuestion, needsDiagram: intent.needsDiagram, answerForm: '', blueprintNotes: intent.customConstraints || '' })) }),
    modelCall: createModelCallConfig({ scope: 'dse_author', callRole: 'blueprint', providerId, stageKey: 'author_blueprint' })
  })
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_BLUEPRINT_DONE, blueprint))

  const generatedQuestions = []
  for (const blueprintQuestion of blueprint.questions) {
    emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_QUESTION_STARTED, { questionNumber: blueprintQuestion.questionNumber }))
    const questionPrompt = { ...buildDseAuthorQuestionPrompt({ intent, blueprintQuestion }), providerId }
    const questionDraft = await runStructuredStage({
      stageKey: `author_question_${blueprintQuestion.questionNumber}`,
      emit,
      request: createStructuredRequester(judgeSolutions),
      mainPrompt: questionPrompt,
      compactPrompt: { ...buildDseAuthorQuestionPrompt({ intent, blueprintQuestion, compact: true }), providerId, stream: true, maxCompletionTokens: 2600 },
      buildRepairPrompt: options => ({ ...buildDseAuthorQuestionRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 2600 }),
      validator: validateDseAuthorQuestion,
      repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
      compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
      failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
      fallback: () => ({ questionNumber: blueprintQuestion.questionNumber, title: `Question ${blueprintQuestion.questionNumber}`, paperSection: blueprintQuestion.paperSection, questionType: blueprintQuestion.questionType, difficultyBand: blueprintQuestion.difficultyBand, topicTags: blueprintQuestion.topicTags, questionTextZh: `請生成關於 ${(blueprintQuestion.topicTags || []).join('、') || '數學'} 的 DSE 題目。`, questionTextEn: '', options: blueprintQuestion.questionType === 'mc' ? ['A', 'B', 'C', 'D'] : [], answer: '', working: '', markingScheme: '', marks: blueprintQuestion.marks, needsDiagram: blueprintQuestion.needsDiagram, diagramInstructions: blueprintQuestion.needsDiagram === 'required' ? '請配合題意繪圖。' : '', qualityChecks: [] }),
      modelCall: createModelCallConfig({ scope: 'dse_author', callRole: 'generator', providerId, stageKey: `author_question_${blueprintQuestion.questionNumber}`, questionNumber: blueprintQuestion.questionNumber })
    })

    emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_VERIFICATION_STARTED, { questionNumber: questionDraft.questionNumber }))
    const verifiedQuestion = await runQuestionVerification({ question: questionDraft, providerId, emit })
    generatedQuestions.push(verifiedQuestion)
    emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_VERIFICATION_DONE, { questionNumber: verifiedQuestion.questionNumber, verification: verifiedQuestion.verification, answer: verifiedQuestion.answer }))
    emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_QUESTION_DONE, { questionNumber: verifiedQuestion.questionNumber, questionType: verifiedQuestion.questionType, difficultyBand: verifiedQuestion.difficultyBand, needsDiagram: verifiedQuestion.needsDiagram }))
  }

  const paperPrompt = { ...buildDseAuthorPaperPrompt({ intent, blueprint, generatedQuestions }), providerId }
  const paper = await runStructuredStage({
    stageKey: 'author_finalize',
    emit,
    request: createStructuredRequester(requestModel),
    mainPrompt: paperPrompt,
    buildRepairPrompt: options => ({
      ...paperPrompt,
      system: [paperPrompt.system, '請完整重發合法 JSON。'].join('\n\n'),
      user() {
        return [typeof paperPrompt.user === 'function' ? paperPrompt.user() : '', `解析/驗證錯誤: ${options.errorMessage}`, options.brokenOutput].filter(Boolean).join('\n\n')
      },
      providerId,
      stream: false,
      maxCompletionTokens: 2000
    }),
    validator: validateDseAuthorPaper,
    repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
    failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
    fallback: () => ({ paperTitle: blueprint.paperTitle || 'DSE Math Draft', paperType: blueprint.paperType || intent.paperType, summary: blueprint.structureSummary || '', editorNotes: '可於右側草稿區再作修改後重新驗算。' }),
    modelCall: createModelCallConfig({ scope: 'dse_author', callRole: 'finalizer', providerId, stageKey: 'author_finalize' })
  })

  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_PAPER_COMPILED, paper))
  let session = createSessionPayload({ sessionId, providerId, request, intent, blueprint, generatedQuestions, paper, followupMessages: toAuthorConversation(request.conversation) })
  setSession(sessionId, session)

  const finalExplanation = await runDraftFinalExplanation({ session, emit })
  session = { ...session, finalExplanation }
  setSession(sessionId, session)
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_SESSION_READY, { sessionId, questionCount: generatedQuestions.length, paperTitle: paper.paperTitle || blueprint.paperTitle || 'DSE Math Draft' }))
  emit(createEvent(SESSION_EVENT_TYPES.FINAL_EXPLANATION_DONE, { text: finalExplanation, rawText: finalExplanation }))
  return session
}

export async function runDseAuthorFollowupFlow({ session, message, emit }) {
  const nextRequest = {
    ...session.request,
    conversation: [...getFollowupMessages(session), { role: 'user', content: message }]
  }
  return runDseAuthorFlow({ sessionId: session.sessionId, request: nextRequest, providerId: session.providerId, emit })
}

export async function runDseAuthorRevalidateFlow({ session, draft, emit }) {
  const updatedQuestions = Array.isArray(session.generatedQuestions) ? [...session.generatedQuestions] : []
  const targetIndex = updatedQuestions.findIndex(item => String(item.questionNumber) === String(draft.questionNumber || draft.title) || item.title === draft.title)
  const current = targetIndex >= 0 ? updatedQuestions[targetIndex] : updatedQuestions[0]
  const mergedQuestion = {
    ...(current || {}),
    title: draft.title || current?.title || '',
    questionTextZh: draft.questionTextZh || current?.questionTextZh || '',
    questionTextEn: draft.questionTextEn || current?.questionTextEn || '',
    answer: draft.answer || current?.answer || '',
    working: draft.working || current?.working || '',
    markingScheme: draft.markingScheme || current?.markingScheme || '',
    options: draft.options?.length ? draft.options : (current?.options || []),
    needsDiagram: draft.needsDiagram || current?.needsDiagram || 'optional',
    diagramInstructions: draft.diagramInstructions || current?.diagramInstructions || ''
  }

  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_VERIFICATION_STARTED, { questionNumber: mergedQuestion.questionNumber || '1', revalidate: true }))
  const verifiedQuestion = await runQuestionVerification({ question: mergedQuestion, providerId: session.providerId, emit })
  if (targetIndex >= 0) {
    updatedQuestions[targetIndex] = verifiedQuestion
  } else if (updatedQuestions.length > 0) {
    updatedQuestions[0] = verifiedQuestion
  } else {
    updatedQuestions.push(verifiedQuestion)
  }

  const updatedSession = {
    ...session,
    generatedQuestions: updatedQuestions,
    finalExplanation: await runDraftFinalExplanation({ session: { ...session, generatedQuestions: updatedQuestions }, emit })
  }
  setSession(session.sessionId, updatedSession)
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_VERIFICATION_DONE, { questionNumber: verifiedQuestion.questionNumber || '1', verification: verifiedQuestion.verification, revalidate: true }))
  emit(createEvent(SESSION_EVENT_TYPES.FINAL_EXPLANATION_DONE, { text: updatedSession.finalExplanation, rawText: updatedSession.finalExplanation }))
  return updatedSession
}
