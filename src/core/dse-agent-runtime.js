import { createEvent, SESSION_EVENT_TYPES } from '../utils/events.js'
import { judgeSolutions, requestModel, generateDiagramCode } from '../model/client.js'
import { executePythonDiagram } from '../diagram/python-runner.js'
import { buildDiagramPlanPrompt, buildDiagramRepairPrompt } from '../prompts/diagram.js'
import {
  buildDseAgentSystemPrompt,
  buildDseAuthorBlueprintPrompt,
  buildDseAuthorBlueprintRepairPrompt,
  buildDseAuthorIntentPrompt,
  buildDseAuthorIntentRepairPrompt,
  buildDseAuthorPaperPrompt,
  buildDseAuthorQuestionPrompt,
  buildDseAuthorMarkingSchemePrompt,
  buildDseAuthorQuestionRepairPrompt,
  buildJudgePrompt,
  buildJudgeRepairPrompt,
  buildDseMarkingRules
} from '../prompts/index.js'
import {
  validateDseAgentAction,
  validateDseAuthorBlueprint,
  validateDseAuthorIntent,
  validateDseAuthorPaper,
  validateDseAuthorQuestion,
  validateDseAuthorQuestionDraft,
  validateDseAuthorQuestionCompletion,
  validateDseAgentSession,
  validateJudgeResult
} from '../schemas/index.js'
import { runStructuredStage } from './structured-stage.js'
import { runDseAuthorRevalidateFlow } from './dse-author-flow.js'

function createLegacyStructuredRequester(requestFn, emitDelta) {
  return (prompt, onDelta) => requestFn({
    providerId: prompt?.providerId,
    system: prompt?.system || '',
    user: typeof prompt?.user === 'function'
      ? prompt.user
      : () => (prompt?.user ?? ''),
    userContent: typeof prompt?.userContent === 'function'
      ? prompt.userContent
      : () => prompt?.userContent,
    stream: typeof prompt?.stream === 'boolean' ? prompt.stream : true,
    maxCompletionTokens: prompt?.maxCompletionTokens
  }, delta => {
    emitDelta?.(delta)
    onDelta?.(delta)
  })
}

function createDirectStructuredRequester(emitDelta) {
  return async (prompt, onDelta) => {
    const normalizedUser = typeof prompt?.user === 'function'
      ? prompt.user()
      : (prompt?.user ?? '')
    const normalizedUserContent = typeof prompt?.userContent === 'function'
      ? prompt.userContent()
      : prompt?.userContent

    if (!globalThis.__DSE_VERIFY_DEBUG__) {
      globalThis.__DSE_VERIFY_DEBUG__ = []
    }
    globalThis.__DSE_VERIFY_DEBUG__.push({
      at: new Date().toISOString(),
      providerId: prompt?.providerId,
      systemLength: String(prompt?.system || '').length,
      userType: typeof normalizedUser,
      userLength: typeof normalizedUser === 'string' ? normalizedUser.length : -1,
      userContentType: Array.isArray(normalizedUserContent) ? 'array' : typeof normalizedUserContent,
      userContentPreview: typeof normalizedUserContent === 'string'
        ? normalizedUserContent.slice(0, 200)
        : normalizedUserContent,
      stream: typeof prompt?.stream === 'boolean' ? prompt.stream : true
    })

    if ((normalizedUser == null || normalizedUser === '') && normalizedUserContent == null) {
      throw new Error('Verifier prompt normalized to empty user content')
    }

    const payload = {
      providerId: prompt?.providerId,
      system: prompt?.system || '',
      user: normalizedUser ?? '',
      stream: typeof prompt?.stream === 'boolean' ? prompt.stream : true,
      onDelta: delta => {
        emitDelta?.(delta)
        onDelta?.(delta)
      },
      maxCompletionTokens: prompt?.maxCompletionTokens
    }

    if (normalizedUserContent != null) {
      payload.userContent = normalizedUserContent
    }

    return requestModel(payload)
  }
}

function pushMessage(session, role, content, meta = {}) {
  const message = {
    role,
    content: String(content || '').trim(),
    timestamp: new Date().toISOString(),
    ...meta
  }
  return {
    ...session,
    messages: [...(Array.isArray(session.messages) ? session.messages : []), message]
  }
}

function pushToolCall(session, entry) {
  return {
    ...session,
    toolCalls: [...(Array.isArray(session.toolCalls) ? session.toolCalls : []), entry]
  }
}

function createModelCallConfig({ scope, callRole, providerId, stageKey, questionNumber = '' }) {
  return { scope, callRole, providerId, stageKey, questionNumber }
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return String(result || '')
  if (typeof result.resultSummary === 'string' && result.resultSummary) return result.resultSummary
  if (typeof result.assistantQuestion === 'string' && result.assistantQuestion) return result.assistantQuestion
  if (typeof result.intentSummary === 'string' && result.intentSummary) return result.intentSummary
  if (typeof result.structureSummary === 'string' && result.structureSummary) return result.structureSummary
  if (typeof result.title === 'string' && result.title) return result.title
  if (typeof result.paperTitle === 'string' && result.paperTitle) return result.paperTitle
  if (typeof result.finalAnswer === 'string' && result.finalAnswer) return result.finalAnswer
  if (typeof result.text === 'string' && result.text) return result.text
  return JSON.stringify(result)
}

function summarizeSessionForAgent(session) {
  const questions = Array.isArray(session.generatedQuestions)
    ? session.generatedQuestions.map(item => ({
        questionNumber: item.questionNumber,
        title: item.title || '',
        questionType: item.questionType || '',
        difficultyBand: item.difficultyBand || '',
        topicTags: item.topicTags || [],
        hasVerification: Boolean(item.verification),
        hasMarkAssessment: Boolean(item.markAssessment),
        needsDiagram: item.needsDiagram || 'optional',
        hasDiagram: Boolean(item.diagramImage || item.diagram || item.diagramInstructions),
        mergeStatus: item.mergeStatus || '',
        parserWarnings: item.parserWarnings || []
      }))
    : []

  return {
    request: session.request || {},
    intent: session.intent || null,
    blueprint: session.blueprint
      ? {
          paperTitle: session.blueprint.paperTitle || '',
          paperType: session.blueprint.paperType || '',
          structureSummary: session.blueprint.structureSummary || '',
          questionCount: Array.isArray(session.blueprint.questions) ? session.blueprint.questions.length : 0
        }
      : null,
    questionTasks: Array.isArray(session.questionTasks) ? session.questionTasks : [],
    generatedQuestions: questions,
    paper: session.paper
      ? {
          paperTitle: session.paper.paperTitle || '',
          paperType: session.paper.paperType || '',
          summary: session.paper.summary || ''
        }
      : null,
    finalExplanation: session.finalExplanation || '',
    agentState: session.agentState || {}
  }
}

function buildQuestionTask(blueprintQuestion) {
  return {
    questionNumber: String(blueprintQuestion.questionNumber || ''),
    paperSection: blueprintQuestion.paperSection || '',
    questionType: blueprintQuestion.questionType || '',
    difficultyBand: blueprintQuestion.difficultyBand || '',
    marks: blueprintQuestion.marks || 0,
    topicTags: blueprintQuestion.topicTags || [],
    status: 'queued',
    stages: {
      draft: 'pending',
      solution: 'pending',
      verify: 'pending'
    },
    error: ''
  }
}

function ensureQuestionTasks(session, emit) {
  const blueprintQuestions = Array.isArray(session.blueprint?.questions) ? session.blueprint.questions : []
  if (!blueprintQuestions.length) return session
  const existingTasks = Array.isArray(session.questionTasks) ? session.questionTasks : []
  if (existingTasks.length >= blueprintQuestions.length) return session
  const nextTasks = blueprintQuestions.map(blueprintQuestion => {
    const existing = existingTasks.find(item => String(item.questionNumber) === String(blueprintQuestion.questionNumber))
    return existing || buildQuestionTask(blueprintQuestion)
  })
  if (emit) {
    for (const task of nextTasks) {
      if (!existingTasks.find(item => String(item.questionNumber) === String(task.questionNumber))) {
        emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_QUESTION_TASK_QUEUED, {
          questionNumber: task.questionNumber,
          questionType: task.questionType,
          difficultyBand: task.difficultyBand,
          marks: task.marks
        }))
      }
    }
  }
  return {
    ...session,
    questionTasks: nextTasks
  }
}

function updateQuestionTask(session, questionNumber, updater) {
  const tasks = Array.isArray(session.questionTasks) ? session.questionTasks : []
  return {
    ...session,
    questionTasks: tasks.map(task => String(task.questionNumber) === String(questionNumber)
      ? updater(task)
      : task)
  }
}

function buildDraftTextPrompt({ intent, blueprintQuestion }) {
  return {
    providerId: '',
    system: [
      '你是 HKDSE Mathematics 題目起草助手。',
      '請只輸出自然語言題目草稿，不要輸出 JSON，不要加 markdown code block。',
      '若題型是 MC，需列出 A-D 四個選項。',
      '請按指定卷別與題型寫題。'
    ].join('\n\n'),
    user: [
      `卷別: ${intent.paperType}`,
      `題號: ${blueprintQuestion.questionNumber}`,
      `Section: ${blueprintQuestion.paperSection}`,
      `題型: ${blueprintQuestion.questionType}`,
      `難度: ${blueprintQuestion.difficultyBand}`,
      `分數: ${blueprintQuestion.marks}`,
      `課題: ${(blueprintQuestion.topicTags || []).join(' / ') || '未指定'}`,
      `限制: ${blueprintQuestion.blueprintNotes || intent.customConstraints || '無'}`
    ].join('\n\n'),
    stream: true,
    maxCompletionTokens: 2400
  }
}

function buildSolutionTextPrompt({ intent, blueprintQuestion, question }) {
  return {
    providerId: '',
    system: [
      buildDseMarkingRules(),
      '你是 HKDSE Mathematics 答案與評分指引助手。',
      '請只輸出自然語言答案、解題過程與 marking scheme，不要輸出 JSON，不要加 markdown code block。',
      'MC 題必須清楚寫正確選項。'
    ].join('\n\n'),
    user: [
      `卷別: ${intent.paperType}`,
      `題號: ${blueprintQuestion.questionNumber}`,
      `題型: ${blueprintQuestion.questionType}`,
      `題目草稿: ${question.draftText || question.questionTextZh || question.questionTextEn || ''}`
    ].join('\n\n'),
    stream: true,
    maxCompletionTokens: 2600
  }
}

function parseQuestionDraftText(text, blueprintQuestion) {
  const raw = String(text || '').trim()
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean)
  const title = lines[0]?.replace(/^題目\s*\d+[:：]?\s*/i, '').trim() || `Question ${blueprintQuestion.questionNumber}`
  const optionLines = lines.filter(line => /^[A-D][.)]\s*/i.test(line))
  const nonOptionLines = lines.filter(line => !/^[A-D][.)]\s*/i.test(line))
  const body = nonOptionLines.join('\n')
  return validateDseAuthorQuestionDraft({
    questionNumber: blueprintQuestion.questionNumber,
    title,
    paperSection: blueprintQuestion.paperSection,
    questionType: blueprintQuestion.questionType,
    difficultyBand: blueprintQuestion.difficultyBand,
    topicTags: blueprintQuestion.topicTags || [],
    questionTextZh: body,
    questionTextEn: '',
    options: blueprintQuestion.questionType === 'mc' ? optionLines.slice(0, 4) : [],
    marks: blueprintQuestion.marks,
    needsDiagram: blueprintQuestion.needsDiagram || 'optional',
    diagramInstructions: ''
  })
}

function parseQuestionSolutionText(text, question) {
  const raw = String(text || '').trim()
  const answerMatch = raw.match(/(?:正確選項|答案|Answer)\s*[:：]\s*([^\n]+)/i)
  const answer = answerMatch ? answerMatch[1].trim() : ''
  return validateDseAuthorQuestionCompletion({
    answer,
    working: raw,
    markingScheme: raw,
    qualityChecks: []
  })
}

function getLatestTeacherMessage(session) {
  const messages = Array.isArray(session.messages) ? session.messages : []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
      return message.content.trim()
    }
  }
  return ''
}

function getLatestTeacherMessageMeta(session) {
  const messages = Array.isArray(session.messages) ? session.messages : []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
      return {
        content: message.content.trim(),
        timestamp: message.timestamp || '',
        source: message.source || ''
      }
    }
  }
  return { content: '', timestamp: '', source: '' }
}

function buildFollowupToken(messageMeta = {}) {
  return [messageMeta.content || '', messageMeta.timestamp || '', messageMeta.source || ''].join('::')
}

function getPendingTeacherTurn(session) {
  const pending = session.agentState?.pendingTeacherTurn
  if (!pending || typeof pending !== 'object') {
    return { token: '', content: '', source: '', timestamp: '' }
  }
  return {
    token: typeof pending.token === 'string' ? pending.token : '',
    content: typeof pending.content === 'string' ? pending.content : '',
    source: typeof pending.source === 'string' ? pending.source : '',
    timestamp: typeof pending.timestamp === 'string' ? pending.timestamp : ''
  }
}

function hasUnconsumedTeacherTurn(session) {
  const pendingTeacherTurn = getPendingTeacherTurn(session)
  if (!pendingTeacherTurn.token || !pendingTeacherTurn.content) return false
  return pendingTeacherTurn.token !== (session.agentState?.lastHandledTeacherToken || '')
}

function detectTeacherRevisionIntent(message = '') {
  const text = String(message || '').trim().toLowerCase()
  if (!text) return false
  return [
    '重出',
    '重新出',
    '改条件',
    '改條件',
    '改成',
    '修改',
    '有问题',
    '有問題',
    '答案不是',
    '答案唔係',
    '要漂亮数字',
    '要漂亮數字',
    '要靓数',
    '要靚數',
    '不要烂数',
    '不要爛數',
    '唔好爛數',
    '分数',
    '分數',
    '小数',
    '小數',
    '丑数',
    '醜數',
    '核突数',
    '核突數',
    '再写过',
    '再寫過',
    '重写',
    '重寫'
  ].some(keyword => text.includes(keyword))
}

function getMinimumPaperQuestionCount(intent = {}) {
  return intent.mode === 'paper' ? 2 : Math.max(1, Number(intent.mustHaveQuestionCount) || 1)
}

function getBlueprintTargetCount(intent = {}) {
  if (intent.mode === 'paper') {
    return Math.max(getMinimumPaperQuestionCount(intent), Number(intent.mustHaveQuestionCount) || 0)
  }
  return Math.max(1, Number(intent.mustHaveQuestionCount) || 1)
}

function isBlueprintSufficientForIntent(intent = {}, blueprint = null) {
  const questions = Array.isArray(blueprint?.questions) ? blueprint.questions : []
  return questions.length >= getMinimumPaperQuestionCount(intent)
}

function buildTeacherResponse(message = '', question = null) {
  const text = String(message || '').trim()
  if (!text) return ''

  const responses = []
  if (/分数|分數|fraction/i.test(text) && /漂亮数字|漂亮數字|靓数|靚數|不要烂数|不要爛數|唔好爛數|小数|小數|丑数|醜數|核突数|核突數/i.test(text)) {
    responses.push('明白，你希望不要再用难看的小数，并且把题目数值重新设定得更工整，让最终答案优先呈现为分数或其他漂亮的精确值。')
  } else if (/分数|分數|fraction/i.test(text)) {
    responses.push('明白，你希望把答案形式改成分数或精确值，而不是现在这种小数写法。')
  } else if (/漂亮数字|漂亮數字|靓数|靚數|不要烂数|不要爛數|唔好爛數|丑数|醜數|核突数|核突數/i.test(text)) {
    responses.push('明白，你希望我重设题目条件，改用更工整、更自然的数字，避免出现难看的结果。')
  } else if (/有问题|有問題|不合理|唔合理|怪|错|錯/.test(text)) {
    responses.push('明白，你是在指出当前版本有问题，我应该先修正内容，而不是直接当作完成。')
  } else if (/验算|驗算|revalidate|verify/i.test(text)) {
    responses.push('明白，你希望我就当前题目再验算一次，确认答案与评分指引一致。')
  } else if (/重出|重新出|改条件|改條件|改成|修改|再写过|再寫過|重写|重寫/.test(text)) {
    responses.push('明白，你希望我按你的最新要求重写这道题。')
  } else {
    responses.push('明白，我会先按照你的最新意思处理，而不会直接结束。')
  }

  if (question?.questionNumber) {
    responses.push(`我会先处理 Q${question.questionNumber}。`)
  }

  return responses.join(' ')
}

function buildTeacherRevisionInstruction(message = '', question = null) {
  const text = String(message || '').trim()
  const instructions = []

  if (/分数|分數|fraction/i.test(text)) {
    instructions.push('答案应优先设计成分数或可化简的精确值，避免只出现难看的小数。')
  }
  if (/漂亮数字|漂亮數字|靓数|靚數|不要烂数|不要爛數|唔好爛數|丑数|醜數|核突数|核突數/i.test(text)) {
    instructions.push('请改用漂亮数字，使题目条件、运算结果与最终答案更工整易读。')
  }
  if (/小数|小數/.test(text) && !/分数|分數|fraction/i.test(text)) {
    instructions.push('避免使用难看的小数作为最终答案，优先改成整数、分数或简洁根式。')
  }
  if (/有问题|有問題|不合理|唔合理|怪|错|錯/.test(text)) {
    instructions.push('请修正题目条件、答案与评分指引之间的不一致。')
  }
  if (question?.markAssessment?.isValid === false) {
    instructions.push(`需修正 verifier / mark assessment 指出的问题：${question.markAssessment.summary || (question.markAssessment.issues || []).join('；') || '评分或答案存在冲突'}`)
  }
  if (question?.verification?.isValid === false || question?.verification?.summary) {
    instructions.push(`需同时处理 verification 指出的疑点：${question.verification.summary || ''}`.trim())
  }

  return instructions.length ? instructions.join('\n') : text
}

function buildAgentDecisionPrompt({ session, toolRegistry }) {
  return {
    providerId: session.providerId,
    system: [
      buildDseAgentSystemPrompt({ request: session.request, toolList: getToolList(toolRegistry) }),
      '你是 DSE author agent runtime 的決策器。',
      '你必須根據目前 session 狀態與老師最新消息，選擇下一步。',
      '只返回合法 JSON，不要輸出 markdown。',
      '可用 type: ask_teacher, call_tool, delegate_subagent, finish。',
      '若本輪已完成但老師提出新要求，你仍然要選工具處理，不可直接 finish。',
      '當老師要求再驗算、改條件、重出題、補圖、下載結果時，優先用 call_tool 或 delegate_subagent。',
      'call_tool / delegate_subagent 可帶 input.questionNumber、input.teacherMessage、input.patchInstruction、input.reason。',
      '若資訊不足才 ask_teacher。',
      '返回 JSON 例子：{"type":"call_tool","toolName":"verify_question","input":{"questionNumber":"1","teacherMessage":"再驗算一次"},"reason":"老師要求重新驗算第1題"}'
    ].join('\n\n'),
    user: JSON.stringify({
      latestTeacherMessage: getLatestTeacherMessage(session),
      session: summarizeSessionForAgent(session)
    }, null, 2),
    stream: false,
    maxCompletionTokens: 1400
  }
}

function fallbackActionFromSession(session) {
  const pendingTeacherTurn = getPendingTeacherTurn(session)
  const latestTeacherMessage = pendingTeacherTurn.content || ''
  const normalizedMessage = latestTeacherMessage.toLowerCase()
  const questions = Array.isArray(session.generatedQuestions) ? session.generatedQuestions : []
  const firstQuestion = questions[0] || null
  const hasFreshTeacherFollowup = hasUnconsumedTeacherTurn(session)
  const detectQuestionNumber = latestTeacherMessage.match(/第\s*(\d+)\s*題|q\s*(\d+)/i)
  const requestedQuestionNumber = detectQuestionNumber ? (detectQuestionNumber[1] || detectQuestionNumber[2]) : (firstQuestion?.questionNumber || '')
  const requestedQuestion = questions.find(item => String(item.questionNumber) === String(requestedQuestionNumber)) || firstQuestion
  const autoRevisionTarget = session.agentState?.autoRevisionTarget
  const autoRevisionInstruction = session.agentState?.autoRevisionInstruction || ''

  if (autoRevisionTarget) {
    const targetQuestion = questions.find(item => String(item.questionNumber) === String(autoRevisionTarget)) || requestedQuestion
    return {
      type: 'delegate_subagent',
      subagent: 'generator-agent',
      teacherResponse: `我見到 verifier 指出目前版本仲有衝突，所以我會先修訂 Q${targetQuestion?.questionNumber || autoRevisionTarget}，之後再補答案同重新驗算。`,
      reason: `自動修訂 Q${targetQuestion?.questionNumber || autoRevisionTarget}`,
      toolName: 'regenerate_question',
      input: {
        questionNumber: targetQuestion?.questionNumber || autoRevisionTarget,
        teacherMessage: autoRevisionInstruction,
        patchInstruction: autoRevisionInstruction,
        reason: 'auto_revision_after_verification_conflict'
      }
    }
  }

  if (hasFreshTeacherFollowup) {
    if (normalizedMessage.includes('驗算') || normalizedMessage.includes('revalidate') || normalizedMessage.includes('verify')) {
      if (requestedQuestion && !isQuestionCompletionReady(requestedQuestion)) {
        const pendingAction = createPendingQuestionAction(session, requestedQuestion)
        if (pendingAction) {
          return {
            ...pendingAction,
            teacherResponse: buildTeacherResponse(latestTeacherMessage, requestedQuestion)
          }
        }
      }
      return {
        type: 'delegate_subagent',
        subagent: 'verifier-agent',
        teacherResponse: buildTeacherResponse(latestTeacherMessage, requestedQuestion),
        reason: `老師要求重新驗算${requestedQuestion ? ` Q${requestedQuestion.questionNumber}` : ''}`,
        toolName: 'verify_question',
        input: {
          questionNumber: requestedQuestion?.questionNumber || '',
          question: requestedQuestion || null,
          teacherMessage: latestTeacherMessage,
          reason: 'teacher_followup_revalidate'
        }
      }
    }

    if (
      detectTeacherRevisionIntent(latestTeacherMessage)
      || requestedQuestion?.markAssessment?.isValid === false
      || requestedQuestion?.verification?.isValid === false
    ) {
      return {
        type: 'delegate_subagent',
        subagent: 'generator-agent',
        teacherResponse: buildTeacherResponse(latestTeacherMessage, requestedQuestion),
        reason: `老師要求重寫${requestedQuestion ? ` Q${requestedQuestion.questionNumber}` : '題目'}`,
        toolName: 'regenerate_question',
        input: {
          questionNumber: requestedQuestion?.questionNumber || '',
          teacherMessage: latestTeacherMessage,
          patchInstruction: buildTeacherRevisionInstruction(latestTeacherMessage, requestedQuestion),
          reason: 'teacher_followup_regenerate'
        }
      }
    }

    if (normalizedMessage.includes('diagram') || normalizedMessage.includes('作圖') || normalizedMessage.includes('畫圖') || normalizedMessage.includes('補圖')) {
      return {
        type: 'delegate_subagent',
        subagent: 'diagram-agent',
        teacherResponse: buildTeacherResponse(latestTeacherMessage, requestedQuestion),
        reason: `老師要求補圖${requestedQuestion ? ` Q${requestedQuestion.questionNumber}` : ''}`,
        toolName: 'generate_diagram',
        input: {
          questionNumber: requestedQuestion?.questionNumber || '',
          question: requestedQuestion || null,
          teacherMessage: latestTeacherMessage,
          diagramInstructions: latestTeacherMessage
        }
      }
    }

    if (normalizedMessage.includes('下載') || normalizedMessage.includes('export')) {
      return {
        type: 'call_tool',
        toolName: 'export_artifact',
        teacherResponse: buildTeacherResponse(latestTeacherMessage, requestedQuestion),
        input: { teacherMessage: latestTeacherMessage },
        reason: '老師要求匯出結果'
      }
    }

    return {
      type: 'call_tool',
      toolName: 'summarize_teacher_update',
      teacherResponse: buildTeacherResponse(latestTeacherMessage, requestedQuestion),
      input: { teacherMessage: latestTeacherMessage },
      reason: '將老師最新要求整理成下一步回覆'
    }
  }

  if (!session.intent) {
    return { type: 'call_tool', toolName: 'collect_requirements', input: {}, reason: '先整理老師要求' }
  }
  if (isPaperSelectionMissing(session.intent, latestTeacherMessage)) {
    return {
      type: 'ask_teacher',
      teacherResponse: latestTeacherMessage ? '明白，你現在是要繼續整卷流程；不過整卷模式一定要先決定卷別，我不會自行替你決定。' : '',
      question: '你今次要先出 Paper 1 還是 Paper 2？',
      reason: '整卷模式必須先確定卷別'
    }
  }
  if (session.intent.readyToGenerate === false && !latestTeacherMessage) {
    return { type: 'ask_teacher', question: session.intent.assistantQuestion || '請補充更多要求。', reason: '資訊不足' }
  }
  if (!session.blueprint || !isBlueprintSufficientForIntent(session.intent || {}, session.blueprint)) {
    return { type: 'delegate_subagent', subagent: 'planner-agent', reason: '先建立出題藍圖', toolName: 'plan_blueprint' }
  }
  const blueprintQuestions = Array.isArray(session.blueprint?.questions) ? session.blueprint.questions : []
  const questionTasks = Array.isArray(session.questionTasks) ? session.questionTasks : []

  const nextQueuedTask = questionTasks.find(task => task.stages?.draft !== 'done')
  if (nextQueuedTask) {
    const nextBlueprintQuestion = blueprintQuestions.find(item => String(item.questionNumber) === String(nextQueuedTask.questionNumber)) || nextQueuedTask
    return { type: 'delegate_subagent', subagent: 'generator-agent', reason: `生成 Q${nextBlueprintQuestion?.questionNumber || questions.length + 1}`, toolName: 'generate_question', input: { blueprintQuestion: nextBlueprintQuestion } }
  }
  const nextSolutionTask = questionTasks.find(task => task.stages?.draft === 'done' && task.stages?.solution !== 'done')
  if (nextSolutionTask) {
    const pendingQuestion = questions.find(item => String(item.questionNumber) === String(nextSolutionTask.questionNumber))
    if (pendingQuestion) {
      return createPendingQuestionAction(session, pendingQuestion)
    }
  }
  const nextVerifyTask = questionTasks.find(task => task.stages?.solution === 'done' && task.stages?.verify !== 'done')
  if (nextVerifyTask) {
    const pendingQuestion = questions.find(item => String(item.questionNumber) === String(nextVerifyTask.questionNumber))
    if (pendingQuestion) {
      return createPendingQuestionAction(session, pendingQuestion)
    }
  }
  if (!session.paper) {
    return { type: 'delegate_subagent', subagent: 'compiler-agent', reason: '整理整卷摘要', toolName: 'compile_paper', input: {} }
  }
  if (!session.finalExplanation) {
    return { type: 'call_tool', toolName: 'summarize_teacher_update', input: {}, reason: '生成老師總結' }
  }
  return { type: 'finish', message: '已完成本輪 DSE 出題工作。', reason: '所有步驟已完成' }
}

function hasInterruptingTeacherFollowup(session) {
  return hasUnconsumedTeacherTurn(session)
}

function shouldDeferForTeacherFollowup(session, action) {
  if (!hasInterruptingTeacherFollowup(session)) return false
  if (!action || typeof action !== 'object') return false
  if (action.type === 'ask_teacher' || action.type === 'finish') return false
  if (action.toolName === 'collect_requirements') return false
  if (!session.agentState?.activeToolName) return false
  return true
}

function buildInterruptedTeacherTurnAction(session, action = null) {
  const pendingTeacherTurn = getPendingTeacherTurn(session)
  const latestTeacherMessage = pendingTeacherTurn.content || getLatestTeacherMessage(session)
  const questions = Array.isArray(session.generatedQuestions) ? session.generatedQuestions : []
  const firstQuestion = questions[0] || null
  const detectQuestionNumber = latestTeacherMessage.match(/第\s*(\d+)\s*題|q\s*(\d+)/i)
  const requestedQuestionNumber = detectQuestionNumber ? (detectQuestionNumber[1] || detectQuestionNumber[2]) : (firstQuestion?.questionNumber || '')
  const requestedQuestion = questions.find(item => String(item.questionNumber) === String(requestedQuestionNumber)) || firstQuestion

  const base = fallbackActionFromSession(session)

  return validateDseAgentAction({
    ...base,
    teacherResponse: base.teacherResponse || buildTeacherResponse(latestTeacherMessage, requestedQuestion),
    reason: base.reason || action?.reason || '優先處理老師最新 follow-up'
  })
}

function consumeFollowupTurn(nextSession, resolvedAction) {
  const pendingTeacherTurn = getPendingTeacherTurn(nextSession)
  return {
    ...nextSession,
    request: resolvedAction.teacherResponse
      ? {
          ...(nextSession.request || {}),
          conversation: [...(nextSession.request?.conversation || []), { role: 'assistant', content: resolvedAction.teacherResponse }]
        }
      : (nextSession.request || {}),
    agentState: {
      ...(nextSession.agentState || {}),
      lastTeacherResponse: resolvedAction.teacherResponse || (nextSession.agentState?.lastTeacherResponse || ''),
      pendingTeacherTurn: null,
      lastHandledTeacherMessage: pendingTeacherTurn.content || (nextSession.agentState?.lastHandledTeacherMessage || ''),
      lastHandledTeacherToken: pendingTeacherTurn.token || (nextSession.agentState?.lastHandledTeacherToken || '')
    }
  }
}

async function decideNextAction({ session, toolRegistry }) {
  const pendingTeacherTurn = getPendingTeacherTurn(session)
  const latestTeacherMessage = pendingTeacherTurn.content
  const hasFreshTeacherFollowup = hasUnconsumedTeacherTurn(session)

  if (!hasFreshTeacherFollowup) {
    return validateDseAgentAction(fallbackActionFromSession(session))
  }

  const fallback = fallbackActionFromSession(session)
  const shouldTrustFallback = fallback.toolName === 'regenerate_question'
    || fallback.toolName === 'verify_question'
    || fallback.toolName === 'generate_diagram'
    || fallback.toolName === 'export_artifact'
    || session.agentState?.autoRevisionTarget

  if (shouldTrustFallback) {
    return validateDseAgentAction(fallback)
  }

  const prompt = buildAgentDecisionPrompt({ session, toolRegistry })
  try {
    const response = await requestModel({
      providerId: session.providerId,
      system: prompt.system,
      user: prompt.user,
      stream: false,
      maxCompletionTokens: prompt.maxCompletionTokens || 1400
    })
    const parsed = JSON.parse(response.text || '{}')
    const validated = validateDseAgentAction(parsed)
    if (!validated.teacherResponse && latestTeacherMessage) {
      const questions = Array.isArray(session.generatedQuestions) ? session.generatedQuestions : []
      const detectQuestionNumber = latestTeacherMessage.match(/第\s*(\d+)\s*題|q\s*(\d+)/i)
      const requestedQuestionNumber = detectQuestionNumber ? (detectQuestionNumber[1] || detectQuestionNumber[2]) : (questions[0]?.questionNumber || '')
      const requestedQuestion = questions.find(item => String(item.questionNumber) === String(requestedQuestionNumber)) || questions[0] || null
      validated.teacherResponse = buildTeacherResponse(latestTeacherMessage, requestedQuestion)
    }
    return validated
  } catch {
    if (!fallback.teacherResponse && latestTeacherMessage) {
      const questions = Array.isArray(session.generatedQuestions) ? session.generatedQuestions : []
      const detectQuestionNumber = latestTeacherMessage.match(/第\s*(\d+)\s*題|q\s*(\d+)/i)
      const requestedQuestionNumber = detectQuestionNumber ? (detectQuestionNumber[1] || detectQuestionNumber[2]) : (questions[0]?.questionNumber || '')
      const requestedQuestion = questions.find(item => String(item.questionNumber) === String(requestedQuestionNumber)) || questions[0] || null
      fallback.teacherResponse = buildTeacherResponse(latestTeacherMessage, requestedQuestion)
    }
    return validateDseAgentAction(fallback)
  }
}

function createBlueprintQuestionFromIntent(session, questionNumber = '1', extraNotes = '') {
  const intent = session.intent || {}
  return {
    questionNumber: String(questionNumber || '1'),
    paperSection: intent.paperType === 'paper2' ? 'A' : 'B',
    questionType: intent.questionType === 'mixed' ? 'long' : (intent.questionType === 'mc' ? 'mc' : 'long'),
    difficultyBand: intent.difficultyBand || '3',
    topicTags: intent.topicCoverage || [],
    subtopicTags: [],
    marks: intent.marksPerQuestion || 4,
    needsDiagram: intent.needsDiagram || 'optional',
    answerForm: '',
    blueprintNotes: [intent.customConstraints || '', extraNotes].filter(Boolean).join('\n')
  }
}

function buildBlueprintFallback(intent = {}) {
  const requestedCount = getBlueprintTargetCount(intent)
  const paperType = intent.paperType || 'full'
  const baseTopics = Array.isArray(intent.topicCoverage) && intent.topicCoverage.length
    ? intent.topicCoverage
    : ['概率']

  if (paperType === 'full') {
    return {
      paperType: 'full',
      paperTitle: 'DSE Math Draft',
      structureSummary: '等待老師選擇先出 Paper 1 或 Paper 2。',
      questions: []
    }
  }

  const isPaperMode = intent.mode === 'paper'
  const questionType = intent.questionType === 'mixed' ? null : (intent.questionType === 'mc' ? 'mc' : 'long')
  const defaultPaper2Types = ['mc', 'mc', 'mc', 'mc', 'mc', 'mc', 'mc', 'mc', 'mc', 'mc', 'mc', 'mc', 'mc', 'mc', 'mc', 'mc', 'mc']
  const defaultPaper1Types = ['long', 'long', 'long', 'long', 'long', 'long', 'long', 'long']
  const defaultQuestionTypes = paperType === 'paper2' ? defaultPaper2Types : defaultPaper1Types

  return {
    paperType,
    paperTitle: paperType === 'paper2' ? 'DSE Math Paper 2 Draft' : 'DSE Math Paper 1 Draft',
    structureSummary: intent.intentSummary || (isPaperMode
      ? (paperType === 'paper2' ? '先建立 Paper 2 的整卷多題藍圖。' : '先建立 Paper 1 的整卷多題藍圖。')
      : ''),
    questions: Array.from({ length: requestedCount }, (_, index) => ({
      questionNumber: `${index + 1}`,
      paperSection: paperType === 'paper2' ? 'A' : 'B',
      questionType: questionType || defaultQuestionTypes[index] || (paperType === 'paper2' ? 'mc' : 'long'),
      difficultyBand: intent.difficultyBand || '3',
      topicTags: [baseTopics[index % baseTopics.length]],
      subtopicTags: [],
      marks: intent.marksPerQuestion || (paperType === 'paper2' ? 1 : 4),
      needsDiagram: intent.needsDiagram || 'optional',
      answerForm: '',
      blueprintNotes: intent.customConstraints || ''
    }))
  }
}

function isPaperSelectionMissing(intent = {}, latestTeacherMessage = '') {
  if ((intent.paperType || '') !== 'full') return false
  const text = String(latestTeacherMessage || '').trim().toLowerCase()
  if (!text) return true
  return !(/paper\s*1|paper1|卷\s*1|第一卷|甲卷/.test(text) || /paper\s*2|paper2|卷\s*2|第二卷|乙卷/.test(text))
}

function inferPaperTypeFromMessage(message = '') {
  const text = String(message || '').trim().toLowerCase()
  if (/paper\s*1|paper1|卷\s*1|第一卷|甲卷/.test(text)) return 'paper1'
  if (/paper\s*2|paper2|卷\s*2|第二卷|乙卷/.test(text)) return 'paper2'
  return ''
}

function isQuestionDraftReady(question) {
  if (!question || typeof question !== 'object') return false
  return Boolean((question.questionTextZh || '').trim() || (question.questionTextEn || '').trim())
}

function isQuestionCompletionReady(question) {
  if (!question || typeof question !== 'object') return false
  return Boolean((question.answer || '').trim() && (question.working || '').trim() && (question.markingScheme || '').trim())
}

function resolveQuestionFromInput(session, input = {}) {
  const questions = Array.isArray(session.generatedQuestions) ? session.generatedQuestions : []
  if (input.question && typeof input.question === 'object') return input.question
  if (input.questionNumber != null) {
    const found = questions.find(item => String(item.questionNumber) === String(input.questionNumber))
    if (found) return found
  }
  return questions[0] || null
}

function buildQuestionFallback(blueprintQuestion) {
  return {
    questionNumber: blueprintQuestion.questionNumber,
    title: `Question ${blueprintQuestion.questionNumber}`,
    paperSection: blueprintQuestion.paperSection,
    questionType: blueprintQuestion.questionType,
    difficultyBand: blueprintQuestion.difficultyBand,
    topicTags: blueprintQuestion.topicTags || [],
    questionTextZh: '',
    questionTextEn: '',
    options: blueprintQuestion.questionType === 'mc' ? ['A', 'B', 'C', 'D'] : [],
    marks: blueprintQuestion.marks,
    needsDiagram: blueprintQuestion.needsDiagram || 'optional',
    diagramInstructions: ''
  }
}

function buildQuestionCompletionFallback() {
  return {
    answer: '',
    working: '',
    markingScheme: '',
    qualityChecks: []
  }
}

function createQuestionCompletionPayload({ questionDraft, completion }) {
  return validateDseAuthorQuestion({
    ...questionDraft,
    ...completion
  })
}

function getBlueprintQuestionForQuestion(session, question) {
  const blueprintQuestions = Array.isArray(session.blueprint?.questions) ? session.blueprint.questions : []
  return blueprintQuestions.find(item => String(item.questionNumber) === String(question?.questionNumber))
    || createBlueprintQuestionFromIntent(session, question?.questionNumber || '1', question?.patchInstruction || '')
}

function createPendingQuestionAction(session, question) {
  const blueprintQuestion = getBlueprintQuestionForQuestion(session, question)
  if (!isQuestionCompletionReady(question)) {
    return {
      type: 'delegate_subagent',
      subagent: 'generator-agent',
      reason: `補齊 Q${question.questionNumber} 答案與評分指引`,
      toolName: 'draft_marking_scheme',
      input: {
        questionNumber: question.questionNumber,
        question,
        blueprintQuestion
      }
    }
  }
  if (!question?.verification || !question?.markAssessment) {
    return {
      type: 'delegate_subagent',
      subagent: 'verifier-agent',
      reason: `驗算 Q${question.questionNumber}`,
      toolName: 'verify_question',
      input: { question, questionNumber: question.questionNumber }
    }
  }
  return null
}

function getToolRegistry({ providerId, emit }) {
  return {
    collect_requirements: {
      description: '整理老師需求並判斷是否可開始生成',
      async run({ session }) {
        const request = session.request || {}
        const latestTeacherMessage = getLatestTeacherMessage(session)
        const inferredPaperType = inferPaperTypeFromMessage(latestTeacherMessage)
        const normalizedRequest = inferredPaperType && request.paperType === 'full'
          ? { ...request, paperType: inferredPaperType }
          : request
        return runStructuredStage({
          stageKey: 'author_agent_collect_requirements',
          emit,
          request: createLegacyStructuredRequester(judgeSolutions),
          mainPrompt: { ...buildDseAuthorIntentPrompt({ request: normalizedRequest }), providerId },
          compactPrompt: { ...buildDseAuthorIntentPrompt({ request: normalizedRequest, compact: true }), providerId, stream: true, maxCompletionTokens: 1800 },
          buildRepairPrompt: options => ({ ...buildDseAuthorIntentRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 1800 }),
          validator: validateDseAuthorIntent,
          repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
          compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
          failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
          fallback: () => {
            if (normalizedRequest.paperType === 'full') {
              return {
                ...normalizedRequest,
                missingFields: ['paperType'],
                assistantQuestion: '你今次要先出 Paper 1 還是 Paper 2？',
                readyToGenerate: false,
                intentSummary: normalizedRequest.teacherGoal || '等待老師選擇卷別'
              }
            }
            return { ...normalizedRequest, missingFields: ['teacherGoal'], assistantQuestion: '你想這份題目最主要訓練學生哪一種能力？', readyToGenerate: false, intentSummary: normalizedRequest.teacherGoal || '資料不足' }
          },
          modelCall: createModelCallConfig({ scope: 'dse_author_agent', callRole: 'intake', providerId, stageKey: 'author_agent_collect_requirements' })
        }).then(result => {
          const normalizedResult = result?.mode === 'paper'
            ? { ...result, mustHaveQuestionCount: 0 }
            : result
          if (normalizedResult.paperType === 'full' && !inferredPaperType) {
            return {
              ...normalizedResult,
              missingFields: ['paperType'],
              assistantQuestion: '你今次要先出 Paper 1 還是 Paper 2？',
              readyToGenerate: false
            }
          }
          if (inferredPaperType) {
            return {
              ...normalizedResult,
              paperType: inferredPaperType,
              missingFields: (normalizedResult.missingFields || []).filter(item => item !== 'paperType'),
              assistantQuestion: normalizedResult.readyToGenerate === false && (normalizedResult.missingFields || []).length === 1 && normalizedResult.missingFields[0] === 'paperType'
                ? ''
                : normalizedResult.assistantQuestion
            }
          }
          return normalizedResult
        })
      }
    },
    plan_blueprint: {
      description: '生成整份題目藍圖',
      async run({ session }) {
        return runStructuredStage({
          stageKey: 'author_agent_plan_blueprint',
          emit,
          request: createLegacyStructuredRequester(judgeSolutions),
          mainPrompt: { ...buildDseAuthorBlueprintPrompt({ intent: session.intent }), providerId },
          compactPrompt: { ...buildDseAuthorBlueprintPrompt({ intent: session.intent, compact: true }), providerId, stream: true, maxCompletionTokens: 2200 },
          buildRepairPrompt: options => ({ ...buildDseAuthorBlueprintRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 2200 }),
          validator: data => validateDseAuthorBlueprint({ ...data, mode: session.intent?.mode || 'single' }),
          repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
          compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
          failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
          fallback: () => buildBlueprintFallback(session.intent),
          modelCall: createModelCallConfig({ scope: 'dse_author_agent', callRole: 'blueprint', providerId, stageKey: 'author_agent_plan_blueprint' })
        })
      }
    },
    generate_question: {
      description: '生成單題草稿',
      async run({ session, input }) {
        const blueprintQuestion = input?.blueprintQuestion
          || (input?.questionNumber ? (session.blueprint?.questions || []).find(item => String(item.questionNumber) === String(input.questionNumber)) : null)
          || session.agentState?.pendingBlueprintQuestion
          || session.blueprint?.questions?.[0]
          || (session.intent ? createBlueprintQuestionFromIntent(session, input?.questionNumber || '1', input?.reason || input?.teacherMessage || '') : null)
        if (!blueprintQuestion) throw new Error('缺少 blueprintQuestion')

        if (input?.useTextArtifacts) {
          emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_QUESTION_TASK_STARTED, {
            questionNumber: blueprintQuestion.questionNumber,
            stage: 'draft'
          }))
          const prompt = buildDraftTextPrompt({ intent: session.intent, blueprintQuestion })
          const response = await requestModel({ ...prompt, providerId, onDelta: delta => emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_TOOL_CALL_DELTA, { toolName: 'generate_question', questionNumber: blueprintQuestion.questionNumber, delta })) })
          const draftText = String(response.text || '').trim()
          const parsedDraft = parseQuestionDraftText(draftText, blueprintQuestion)
          emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_QUESTION_TASK_STAGE_DONE, {
            questionNumber: blueprintQuestion.questionNumber,
            stage: 'draft'
          }))
          emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_QUESTION_TASK_MERGED, {
            questionNumber: blueprintQuestion.questionNumber,
            mergeStatus: 'draft_ready'
          }))
          return {
            ...parsedDraft,
            draftText,
            parserWarnings: [],
            mergeStatus: 'draft_ready'
          }
        }

        return runStructuredStage({
          stageKey: `author_agent_generate_question_${blueprintQuestion.questionNumber}`,
          emit,
          request: createLegacyStructuredRequester(judgeSolutions),
          mainPrompt: { ...buildDseAuthorQuestionPrompt({ intent: session.intent, blueprintQuestion }), providerId },
          compactPrompt: { ...buildDseAuthorQuestionPrompt({ intent: session.intent, blueprintQuestion, compact: true }), providerId, stream: true, maxCompletionTokens: 1800 },
          buildRepairPrompt: options => ({ ...buildDseAuthorQuestionRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 1800 }),
          validator: validateDseAuthorQuestionDraft,
          repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
          compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
          failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
          fallback: () => buildQuestionFallback(blueprintQuestion),
          modelCall: createModelCallConfig({ scope: 'dse_author_agent', callRole: 'generator', providerId, stageKey: `author_agent_generate_question_${blueprintQuestion.questionNumber}`, questionNumber: blueprintQuestion.questionNumber })
        })
      }
    },
    draft_marking_scheme: {
      description: '補齊答案解題與評分指引',
      async run({ session, input }) {
        const questionDraft = resolveQuestionFromInput(session, input)
        if (!questionDraft) throw new Error('缺少 question draft')
        const blueprintQuestion = input?.blueprintQuestion || getBlueprintQuestionForQuestion(session, questionDraft)
        if (!blueprintQuestion) throw new Error('缺少 blueprintQuestion')

        if (input?.useTextArtifacts) {
          emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_QUESTION_TASK_STARTED, {
            questionNumber: questionDraft.questionNumber,
            stage: 'solution'
          }))
          const prompt = buildSolutionTextPrompt({ intent: session.intent, blueprintQuestion, question: questionDraft })
          const response = await requestModel({ ...prompt, providerId, onDelta: delta => emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_TOOL_CALL_DELTA, { toolName: 'draft_marking_scheme', questionNumber: questionDraft.questionNumber, delta })) })
          const solutionText = String(response.text || '').trim()
          const completion = parseQuestionSolutionText(solutionText, questionDraft)
          emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_QUESTION_TASK_STAGE_DONE, {
            questionNumber: questionDraft.questionNumber,
            stage: 'solution'
          }))
          emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_QUESTION_TASK_MERGED, {
            questionNumber: questionDraft.questionNumber,
            mergeStatus: 'solution_ready'
          }))
          return {
            ...createQuestionCompletionPayload({ questionDraft, completion }),
            draftText: questionDraft.draftText || '',
            solutionText,
            parserWarnings: [],
            mergeStatus: 'solution_ready'
          }
        }

        return runStructuredStage({
          stageKey: `author_agent_marking_scheme_${questionDraft.questionNumber}`,
          emit,
          request: createLegacyStructuredRequester(judgeSolutions),
          mainPrompt: { ...buildDseAuthorMarkingSchemePrompt({ intent: session.intent, blueprintQuestion, questionDraft }), providerId },
          compactPrompt: { ...buildDseAuthorMarkingSchemePrompt({ intent: session.intent, blueprintQuestion, questionDraft, compact: true }), providerId, stream: true, maxCompletionTokens: 1800 },
          buildRepairPrompt: options => ({ ...buildDseAuthorQuestionRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 1800 }),
          validator: validateDseAuthorQuestionCompletion,
          repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
          compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
          failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
          fallback: () => buildQuestionCompletionFallback(),
          modelCall: createModelCallConfig({ scope: 'dse_author_agent', callRole: 'marking', providerId, stageKey: `author_agent_marking_scheme_${questionDraft.questionNumber}`, questionNumber: questionDraft.questionNumber })
        }).then(result => createQuestionCompletionPayload({ questionDraft, completion: result }))
      }
    },
    assess_mark_scheme: {
      description: '檢查題目評分指引是否符合 HKDSE marks and remarks',
      async run({ input }) {
        const question = input?.question
        if (!question) throw new Error('缺少 question')
        const prompt = {
          providerId,
          system: [
            buildDseMarkingRules(),
            '你是 HKDSE Math Core marking scheme assessor。',
            '你要判斷給定題目的 marking scheme 是否合理，並返回合法 JSON。',
            '不要輸出 markdown。',
            '返回 JSON: {"isValid":true,"summary":"","issues":[""],"suggestions":[""]}'
          ].join('\n\n'),
          user() {
            return [
              `題目: ${question.questionTextZh || question.questionTextEn || ''}`,
              `答案: ${question.answer || ''}`,
              `解題過程: ${question.working || ''}`,
              `評分指引: ${question.markingScheme || ''}`
            ].join('\n\n')
          },
          stream: false,
          maxCompletionTokens: 1800
        }
        const response = await requestModel(prompt)
        return JSON.parse(response.text || '{}')
      }
    },
    verify_question: {
      description: '驗算題目答案與評分合理性',
      async run({ session, input }) {
        const question = input?.question
        if (!question) throw new Error('缺少 question')
        const normalizedProblem = {
          sourceType: 'text',
          problemText: question.questionTextZh || question.questionTextEn || '',
          extractedText: question.questionTextZh || question.questionTextEn || '',
          knownConditions: [],
          goal: '',
          requiresDiagram: question.needsDiagram === 'required'
        }
        const solverA = { finalAnswer: question.answer || '', summary: question.working || '' }
        const solverB = { finalAnswer: question.answer || '', summary: `${question.markingScheme || ''}\n\n${buildDseMarkingRules()}` }
        const verificationPrompt = {
          providerId,
          system: [
            buildDseMarkingRules(),
            buildJudgePrompt({
              normalizedProblem,
              solverA,
              solverB
            }).system
          ].filter(Boolean).join('\n\n'),
          user: [
            `題目: ${normalizedProblem.problemText}`,
            normalizedProblem.goal ? `求解目標: ${normalizedProblem.goal}` : '求解目標: 請自行判斷',
            `Solver A: ${JSON.stringify(solverA)}`,
            `Solver B: ${JSON.stringify(solverB)}`
          ].join('\n\n'),
          stream: false,
          maxCompletionTokens: 2200
        }

        let verification
        try {
          const response = await requestModel(verificationPrompt)
          verification = validateJudgeResult(JSON.parse(response.text || '{}'))
        } catch (firstError) {
          const repairPrompt = buildJudgeRepairPrompt({
            basePrompt: {
              system: verificationPrompt.system,
              user() {
                return verificationPrompt.user
              }
            },
            brokenOutput: firstError instanceof Error ? firstError.message : '',
            errorMessage: firstError instanceof Error ? firstError.message : '驗算失敗'
          })
          const repairUser = typeof repairPrompt.user === 'function' ? repairPrompt.user() : repairPrompt.user
          const response = await requestModel({
            providerId,
            system: repairPrompt.system || '',
            user: typeof repairUser === 'string' ? repairUser : '',
            stream: false,
            maxCompletionTokens: 2200
          })
          verification = validateJudgeResult(JSON.parse(response.text || '{}'))
        }

        const normalizedAnswer = this.normalizeVerifiedAnswer({ question, verification })
        const markAssessment = await this.runAssessment({ question: { ...question, answer: normalizedAnswer } })
        return {
          ...question,
          answer: normalizedAnswer,
          verification: {
            ...verification,
            finalAnswer: normalizedAnswer || verification.finalAnswer
          },
          markAssessment
        }
      },
      normalizeVerifiedAnswer({ question, verification }) {
        const currentAnswer = String(question?.answer || '').trim()
        const finalAnswer = String(verification?.finalAnswer || '').trim()
        const options = Array.isArray(question?.options) ? question.options : []
        if (!options.length) {
          return finalAnswer || currentAnswer
        }

        const optionMatches = options.map((option, index) => {
          const label = String.fromCharCode(65 + index)
          const text = String(option || '').trim()
          return {
            label,
            text,
            normalizedText: text.replace(/^([A-D])\s*[.)]\s*/i, '').trim()
          }
        })

        const upperCurrent = currentAnswer.toUpperCase()
        if (optionMatches.some(item => item.label === upperCurrent)) {
          return upperCurrent
        }

        const upperFinal = finalAnswer.toUpperCase()
        if (optionMatches.some(item => item.label === upperFinal)) {
          return upperFinal
        }

        const finalOptionMatch = finalAnswer.match(/(?:correct option|answer)\s*[:：]?\s*([A-D])/i)
        if (finalOptionMatch) {
          return finalOptionMatch[1].toUpperCase()
        }

        const normalizedFinal = finalAnswer.replace(/^[^A-Za-z0-9]+/, '').trim()
        const matchedByText = optionMatches.find(item => item.normalizedText && normalizedFinal.includes(item.normalizedText))
        if (matchedByText) {
          return matchedByText.label
        }

        const matchedByCurrentText = optionMatches.find(item => item.normalizedText && currentAnswer.includes(item.normalizedText))
        if (matchedByCurrentText) {
          return matchedByCurrentText.label
        }

        return currentAnswer || finalAnswer
      },
      async runAssessment({ question }) {
        const prompt = {
          providerId,
          system: [
            buildDseMarkingRules(),
            '你要審核給定題目的評分指引，判斷 mark allocation、M/A/B/ft 是否合理。',
            '只返回合法 JSON。',
            '返回 JSON: {"isValid":true,"summary":"","issues":[""],"suggestions":[""]}'
          ].join('\n\n'),
          user: [
            `題目: ${question.questionTextZh || question.questionTextEn || ''}`,
            `答案: ${question.answer || ''}`,
            `解題: ${question.working || ''}`,
            `評分指引: ${question.markingScheme || ''}`
          ].join('\n\n'),
          stream: false,
          maxCompletionTokens: 1800
        }
        const response = await requestModel(prompt)
        try {
          return JSON.parse(response.text || '{}')
        } catch {
          return { isValid: false, summary: 'mark scheme assessment 解析失敗', issues: ['invalid json'], suggestions: [] }
        }
      }
    },
    regenerate_question: {
      description: '根據老師最新要求重寫指定題目',
      async run({ session, input }) {
        const targetQuestion = resolveQuestionFromInput(session, input)
        if (!targetQuestion) throw new Error('缺少可重寫的題目')
        const blueprintQuestion = (session.blueprint?.questions || []).find(item => String(item.questionNumber) === String(targetQuestion.questionNumber)) || {
          questionNumber: targetQuestion.questionNumber,
          paperSection: targetQuestion.paperSection,
          questionType: targetQuestion.questionType,
          difficultyBand: targetQuestion.difficultyBand,
          topicTags: targetQuestion.topicTags || [],
          marks: targetQuestion.marks,
          needsDiagram: targetQuestion.needsDiagram,
          blueprintNotes: [targetQuestion.diagramInstructions || '', input?.patchInstruction || '', input?.teacherMessage || ''].filter(Boolean).join('\n')
        }
        const result = await this.generateQuestion({ session, blueprintQuestion, patchInstruction: input?.patchInstruction || input?.teacherMessage || '' })
        return {
          ...result,
          questionNumber: targetQuestion.questionNumber,
          title: result.title || targetQuestion.title,
          answer: '',
          working: '',
          markingScheme: '',
          solutionText: '',
          verification: null,
          markAssessment: null,
          regeneratedFrom: targetQuestion.questionNumber,
          patchInstruction: input?.patchInstruction || input?.teacherMessage || ''
        }
      },
      async generateQuestion({ session, blueprintQuestion, patchInstruction = '' }) {
        const nextBlueprintQuestion = {
          ...blueprintQuestion,
          blueprintNotes: [blueprintQuestion.blueprintNotes || '', patchInstruction].filter(Boolean).join('\n')
        }
        return getToolRegistry({ providerId: session.providerId, emit }).generate_question.run({ session, input: { blueprintQuestion: nextBlueprintQuestion, useTextArtifacts: true } })
      }
    },
    compile_paper: {
      description: '整理整卷摘要與編輯說明',
      async run({ session }) {
        return runStructuredStage({
          stageKey: 'author_agent_compile_paper',
          emit,
          request: createDirectStructuredRequester(),
          mainPrompt: { ...buildDseAuthorPaperPrompt({ intent: session.intent, blueprint: session.blueprint, generatedQuestions: session.generatedQuestions || [], questionTasks: session.questionTasks || [] }), providerId },
          buildRepairPrompt: options => ({
            providerId,
            system: [buildDseAuthorPaperPrompt({ intent: session.intent, blueprint: session.blueprint, generatedQuestions: session.generatedQuestions || [], questionTasks: session.questionTasks || [] }).system, '請完整重發合法 JSON。'].join('\n\n'),
            user() {
              const basePrompt = buildDseAuthorPaperPrompt({ intent: session.intent, blueprint: session.blueprint, generatedQuestions: session.generatedQuestions || [], questionTasks: session.questionTasks || [] })
              return [typeof basePrompt.user === 'function' ? basePrompt.user() : '', `解析/驗證錯誤: ${options.errorMessage}`, options.brokenOutput].filter(Boolean).join('\n\n')
            },
            stream: false,
            maxCompletionTokens: 2000
          }),
          validator: validateDseAuthorPaper,
          repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
          failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
          fallback: () => ({
            paperTitle: session.blueprint?.paperTitle || 'DSE Math Draft',
            paperType: session.blueprint?.paperType || session.intent?.paperType || 'full',
            summary: session.questionTasks?.length
              ? `整卷進度：已完成 ${(session.questionTasks || []).filter(item => item?.stages?.verify === 'done').length} / ${(session.questionTasks || []).length} 題。`
              : (session.blueprint?.structureSummary || session.intent?.intentSummary || ''),
            editorNotes: '可於右側草稿區繼續檢查各題內容，全部題目完成後再視為整卷完成。'
          }),
          modelCall: createModelCallConfig({ scope: 'dse_author_agent', callRole: 'finalizer', providerId, stageKey: 'author_agent_compile_paper' })
        })
      }
    },
    generate_diagram: {
      description: '為指定題目生成圖形草稿',
      async run({ session, input }) {
        const question = resolveQuestionFromInput(session, input)
        if (!question) throw new Error('缺少可作圖的題目')
        emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_STARTED, { questionNumber: question.questionNumber }))

        const normalizedProblem = {
          sourceType: 'text',
          problemText: question.questionTextZh || question.questionTextEn || '',
          extractedText: question.questionTextZh || question.questionTextEn || '',
          knownConditions: [],
          goal: input?.diagramInstructions || input?.teacherMessage || question.diagramInstructions || '',
          requiresDiagram: true
        }

        const basePrompt = buildDiagramPlanPrompt({
          normalizedProblem,
          judgeResult: question.verification || { finalAnswer: question.answer || '' },
          originalInput: { type: 'text' }
        })

        let brokenOutput = ''
        let lastError = ''

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const prompt = attempt === 0
            ? { ...basePrompt, providerId, stream: false, maxCompletionTokens: 2600 }
            : { ...buildDiagramRepairPrompt({ basePrompt, brokenOutput, errorMessage: lastError }), providerId, stream: false, maxCompletionTokens: 2600 }

          const response = await generateDiagramCode(prompt)
          brokenOutput = response.text || '{}'

          let diagramPlan
          try {
            diagramPlan = JSON.parse(brokenOutput)
          } catch {
            lastError = 'diagram JSON 解析失敗'
            continue
          }

          const diagramResult = await executePythonDiagram({
            pythonCode: String(diagramPlan.pythonCode || ''),
            canvasType: diagramPlan.canvasType || 'square'
          })

          if (diagramResult.ok) {
            emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_DONE, { questionNumber: question.questionNumber }))
            return {
              questionNumber: question.questionNumber,
              diagramInstructions: input?.diagramInstructions || input?.teacherMessage || question.diagramInstructions || '',
              diagramPlan,
              diagramImage: diagramResult.imageDataUrl,
              resultSummary: `已為 Q${question.questionNumber} 生成圖形`,
              generatedAt: new Date().toISOString()
            }
          }

          lastError = diagramResult.error || 'diagram 失敗'
        }

        emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_ERROR, { questionNumber: question.questionNumber, message: lastError || 'diagram 失敗' }))
        throw new Error(lastError || 'diagram 失敗')
      }
    },
    export_artifact: {
      description: '整理當前會話的可下載內容',
      async run({ session }) {
        const questions = Array.isArray(session.generatedQuestions) ? session.generatedQuestions : []
        const text = [
          session.paper?.paperTitle || 'DSE Math Draft',
          '',
          ...(questions.flatMap(question => [
            `${question.questionNumber || ''}. ${question.title || ''}`,
            question.questionTextZh || question.questionTextEn || '',
            question.answer ? `答案：${question.answer}` : '',
            question.markingScheme ? `評分：${question.markingScheme}` : '',
            ''
          ]))
        ].filter(Boolean).join('\n')
        return {
          format: 'session-export',
          fileName: `${(session.paper?.paperTitle || 'dse-math-draft').replace(/\s+/g, '-').toLowerCase()}.txt`,
          text,
          generatedAt: new Date().toISOString()
        }
      }
    },
    summarize_teacher_update: {
      description: '把目前草稿狀態轉成老師可讀總結',
      async run({ session }) {
        const prompt = {
          providerId,
          system: '你是 DSE 出題系統的老師版說明助手。請根據目前 session 狀態，輸出簡短自然語言總結。不要輸出 JSON。',
          user: [
            `題數: ${(session.generatedQuestions || []).length}`,
            ...(session.generatedQuestions || []).map(item => `${item.questionNumber}. ${item.title || ''}｜答案 ${item.answer || item.verification?.finalAnswer || ''}`)
          ].join('\n'),
          stream: true,
          maxCompletionTokens: 1800
        }
        const response = await requestModel(prompt)
        return { text: (response.text || '').trim() }
      }
    }
  }
}

function getToolList(toolRegistry) {
  return Object.entries(toolRegistry).map(([name, value]) => ({ name, description: value.description }))
}

function areAllQuestionTasksVerified(session = {}) {
  const tasks = Array.isArray(session.questionTasks) ? session.questionTasks : []
  return tasks.length > 0 && tasks.every(task => task?.stages?.verify === 'done')
}

function shouldCompilePaper(session = {}) {
  return !session.paper && areAllQuestionTasksVerified(session)
}

function isPaperCompilationReady(session = {}) {
  if (!session.paper) return false
  return areAllQuestionTasksVerified(session)
}

function deriveNextAction(session) {
  if (!session.intent) {
    return { type: 'call_tool', toolName: 'collect_requirements', input: {}, reason: '先整理老師要求' }
  }
  if (session.intent.readyToGenerate === false) {
    return { type: 'ask_teacher', question: session.intent.assistantQuestion || '請補充更多要求。', reason: '資訊不足' }
  }
  if (!session.blueprint) {
    return { type: 'delegate_subagent', subagent: 'planner-agent', reason: '先建立出題藍圖' , toolName: 'plan_blueprint'}
  }
  const questionCount = Array.isArray(session.generatedQuestions) ? session.generatedQuestions.length : 0
  const blueprintQuestions = Array.isArray(session.blueprint?.questions) ? session.blueprint.questions : []
  const nextBlueprintQuestion = blueprintQuestions.find(item => {
    const existing = (session.generatedQuestions || []).find(question => String(question.questionNumber) === String(item.questionNumber))
    return !existing || !isQuestionDraftReady(existing)
  })
  if (nextBlueprintQuestion) {
    return { type: 'delegate_subagent', subagent: 'generator-agent', reason: `生成 Q${nextBlueprintQuestion?.questionNumber || questionCount + 1}`, toolName: 'generate_question', input: { blueprintQuestion: nextBlueprintQuestion } }
  }
  const pendingQuestion = (session.generatedQuestions || []).find(item => isQuestionDraftReady(item) && (!isQuestionCompletionReady(item) || !item?.verification || !item?.markAssessment))
  if (pendingQuestion) {
    return createPendingQuestionAction(session, pendingQuestion)
  }
  if (shouldCompilePaper(session)) {
    return { type: 'delegate_subagent', subagent: 'compiler-agent', reason: '整理整卷摘要', toolName: 'compile_paper', input: {} }
  }
  if (!session.paper) {
    return { type: 'finish', message: '整卷仍在生成中，先保留進度摘要。', reason: '等待全部題目完成驗算後再編整卷摘要' }
  }
  if (!isPaperCompilationReady(session)) {
    return { type: 'finish', message: '整卷仍在生成中，先保留進度摘要。', reason: '等待全部題目完成驗算後再視為整卷完成' }
  }
  if (!session.finalExplanation) {
    return { type: 'call_tool', toolName: 'summarize_teacher_update', input: {}, reason: '生成老師總結' }
  }
  return { type: 'finish', message: '已完成本輪 DSE 出題工作。', reason: '所有步驟已完成' }
}

async function runAgentDecision({ session, providerId, emit, toolRegistry }) {
  const action = await decideNextAction({ session, toolRegistry })
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_AGENT_TURN_STARTED, { turn: (session.agentState?.turn || 0) + 1, reason: action.reason || '' }))
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_AGENT_MESSAGE, { role: 'assistant', content: action.message || action.reason || '', kind: 'decision_trace' }))
  return action
}

function createInitialSession({ sessionId, providerId, request }) {
  return validateDseAgentSession({
    sessionId,
    providerId,
    flowType: 'dse-author',
    request,
    messages: [],
    toolCalls: [],
    generatedQuestions: [],
    questionTasks: [],
    verificationHistory: [],
    diagramHistory: [],
    agentState: { turn: 0, status: 'running', pendingQuestionIndex: 0 },
    paper: null,
    finalExplanation: ''
  })
}

async function runAgentLoop({ session, emit, setSession, toolRegistry, maxSteps = 16 }) {
  let nextSession = session

  for (let step = 0; step < maxSteps; step += 1) {
      nextSession = {
        ...nextSession,
        agentState: {
          ...(nextSession.agentState || {}),
          turn: (nextSession.agentState?.turn || 0) + 1,
          status: 'running',
          lastTeacherResponse: '',
          activeToolName: '',
          activeToolStartedAt: ''
        }
      }
    setSession(nextSession.sessionId, nextSession)
    const action = await runAgentDecision({ session: nextSession, providerId: nextSession.providerId, emit, toolRegistry })
    const resolvedAction = shouldDeferForTeacherFollowup(nextSession, action)
      ? buildInterruptedTeacherTurnAction(nextSession, action)
      : action
    emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_AGENT_ACTION_SELECTED, resolvedAction))

    if (resolvedAction.message) {
      nextSession = pushMessage(nextSession, 'assistant', resolvedAction.message, { kind: 'agent_message' })
      emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_AGENT_MESSAGE, { role: 'assistant', content: resolvedAction.message }))
    }

    if (resolvedAction.teacherResponse) {
      nextSession = pushMessage(nextSession, 'assistant', resolvedAction.teacherResponse, { kind: 'teacher_response' })
      emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_AGENT_MESSAGE, { role: 'assistant', content: resolvedAction.teacherResponse, kind: 'teacher_response' }))
      nextSession = consumeFollowupTurn(nextSession, resolvedAction)
    }

    if (resolvedAction.type === 'ask_teacher') {
      const question = resolvedAction.question || resolvedAction.message || '請補充更多出題要求。'
      nextSession = pushMessage(nextSession, 'assistant', question, { kind: 'question' })
      nextSession = { ...nextSession, intent: { ...(nextSession.intent || {}), assistantQuestion: question, readyToGenerate: false }, agentState: { ...(nextSession.agentState || {}), status: 'waiting_teacher' } }
      setSession(nextSession.sessionId, nextSession)
      emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_WAITING_TEACHER, { question }))
      return nextSession
    }

    if (resolvedAction.type === 'delegate_subagent') {
      const subagent = resolvedAction.subagent || 'generator-agent'
      emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_SUBAGENT_STARTED, { subagent, reason: resolvedAction.reason || '' }))
      nextSession = pushMessage(nextSession, 'assistant', `委派 ${subagent}：${resolvedAction.reason || '開始處理。'}`, { kind: 'subagent', subagent })
      setSession(nextSession.sessionId, nextSession)
      if (subagent === 'intake-agent') {
        resolvedAction.type = 'call_tool'
        resolvedAction.toolName = 'collect_requirements'
      } else if (subagent === 'planner-agent') {
        resolvedAction.type = 'call_tool'
        resolvedAction.toolName = 'plan_blueprint'
      } else if (subagent === 'generator-agent') {
        resolvedAction.type = 'call_tool'
        resolvedAction.toolName = resolvedAction.toolName || 'generate_question'
      } else if (subagent === 'verifier-agent') {
        resolvedAction.type = 'call_tool'
        resolvedAction.toolName = 'verify_question'
      } else if (subagent === 'compiler-agent') {
        resolvedAction.type = 'call_tool'
        resolvedAction.toolName = 'compile_paper'
      } else if (subagent === 'diagram-agent') {
        resolvedAction.type = 'call_tool'
        resolvedAction.toolName = 'generate_diagram'
      } else {
        emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_SUBAGENT_DONE, { subagent }))
        continue
      }
    }

    if (resolvedAction.type === 'call_tool') {
      if (resolvedAction.subagent === 'generator-agent' && (resolvedAction.toolName === 'generate_question' || resolvedAction.toolName === 'draft_marking_scheme')) {
        resolvedAction.input = { ...(resolvedAction.input || {}), useTextArtifacts: true }
      }
      if (resolvedAction.teacherResponse && nextSession.agentState?.lastTeacherResponse === resolvedAction.teacherResponse) {
        resolvedAction.teacherResponse = ''
      }
      const tool = toolRegistry[resolvedAction.toolName]
      if (!tool) throw new Error(`未知工具：${resolvedAction.toolName}`)
      const started = { toolCallId: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, toolName: resolvedAction.toolName, input: resolvedAction.input || {}, status: 'started', startedAt: new Date().toISOString() }
      nextSession = pushToolCall(nextSession, started)
      nextSession = {
        ...nextSession,
        agentState: {
          ...(nextSession.agentState || {}),
          activeToolName: resolvedAction.toolName,
          activeToolStartedAt: started.startedAt
        }
      }
      setSession(nextSession.sessionId, nextSession)
      emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_TOOL_CALL_STARTED, started))
      try {
        const result = await tool.run({ session: nextSession, input: resolvedAction.input || {} })
        emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_AGENT_MESSAGE, { role: 'assistant', content: `工具 ${resolvedAction.toolName} 已完成，正在整理結果。`, kind: 'progress' }))
        if (resolvedAction.toolName === 'collect_requirements') {
          nextSession = {
            ...nextSession,
            intent: result,
            request: result.paperType !== 'full' && nextSession.request?.paperType === 'full'
              ? { ...(nextSession.request || {}), paperType: result.paperType }
              : nextSession.request
          }
        } else if (resolvedAction.toolName === 'plan_blueprint') {
          nextSession = ensureQuestionTasks({ ...nextSession, blueprint: result, agentState: { ...(nextSession.agentState || {}), pendingBlueprintQuestion: null } }, emit)
        } else if (resolvedAction.toolName === 'generate_question') {
          const existingIndex = (nextSession.generatedQuestions || []).findIndex(item => String(item.questionNumber) === String(result.questionNumber))
          const nextQuestions = [...(nextSession.generatedQuestions || [])]
          if (existingIndex >= 0) nextQuestions[existingIndex] = { ...nextQuestions[existingIndex], ...result }
          else nextQuestions.push(result)
          nextSession = updateQuestionTask({ ...nextSession, generatedQuestions: nextQuestions, agentState: { ...(nextSession.agentState || {}), pendingQuestionIndex: (nextSession.agentState?.pendingQuestionIndex || 0) + 1 } }, result.questionNumber, task => ({
            ...task,
            status: 'draft_ready',
            stages: { ...(task.stages || {}), draft: 'done' },
            error: ''
          }))
        } else if (resolvedAction.toolName === 'draft_marking_scheme') {
          const questionIndex = (nextSession.generatedQuestions || []).findIndex(item => String(item.questionNumber) === String(result.questionNumber))
          const nextQuestions = [...(nextSession.generatedQuestions || [])]
          if (questionIndex >= 0) nextQuestions[questionIndex] = { ...nextQuestions[questionIndex], ...result }
          else nextQuestions.push(result)
          nextSession = updateQuestionTask({ ...nextSession, generatedQuestions: nextQuestions, agentState: { ...(nextSession.agentState || {}), autoRevisionTarget: '', autoRevisionInstruction: '' } }, result.questionNumber, task => ({
            ...task,
            status: 'solution_ready',
            stages: { ...(task.stages || {}), solution: 'done' },
            error: ''
          }))
          if (result.questionNumber) {
            const verifiedResult = await toolRegistry.verify_question.run({
              session: { ...nextSession, generatedQuestions: nextQuestions },
              input: { questionNumber: result.questionNumber, question: { ...result } }
            })
            const questionIndexAfterVerify = (nextSession.generatedQuestions || []).findIndex(item => String(item.questionNumber) === String(verifiedResult.questionNumber))
            const verifiedQuestions = [...(nextSession.generatedQuestions || [])]
            if (questionIndexAfterVerify >= 0) verifiedQuestions[questionIndexAfterVerify] = verifiedResult
            else verifiedQuestions.push(verifiedResult)
            nextSession = updateQuestionTask({ ...nextSession, generatedQuestions: verifiedQuestions, verificationHistory: [...(nextSession.verificationHistory || []), { questionNumber: verifiedResult.questionNumber, verification: verifiedResult.verification, markAssessment: verifiedResult.markAssessment }] }, verifiedResult.questionNumber, task => ({
              ...task,
              status: verifiedResult.markAssessment?.isValid === false ? 'needs_revision' : 'done',
              stages: { ...(task.stages || {}), verify: 'done' },
              error: verifiedResult.markAssessment?.isValid === false ? (verifiedResult.markAssessment.summary || '驗算衝突') : ''
            }))
            if (verifiedResult.markAssessment && verifiedResult.markAssessment.isValid === false) {
              emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_VERIFICATION_CONFLICT, { questionNumber: verifiedResult.questionNumber, issues: verifiedResult.markAssessment.issues || [] }))
              nextSession = pushMessage(nextSession, 'assistant', `Q${verifiedResult.questionNumber} 的評分指引仍有衝突，我會再調整或要求重生。`, { kind: 'retry_explanation' })
              nextSession = {
                ...nextSession,
                finalExplanation: '',
                paper: null,
                agentState: {
                  ...(nextSession.agentState || {}),
                  status: 'running',
                  autoRevisionTarget: verifiedResult.questionNumber,
                  autoRevisionInstruction: buildTeacherRevisionInstruction(verifiedResult.markAssessment.summary || (verifiedResult.markAssessment.issues || []).join('；') || '請修正驗算與評分衝突', verifiedResult)
                }
              }
            }
          }
        } else if (resolvedAction.toolName === 'regenerate_question') {
          const questionIndex = (nextSession.generatedQuestions || []).findIndex(item => String(item.questionNumber) === String(result.questionNumber))
          const nextQuestions = [...(nextSession.generatedQuestions || [])]
          if (questionIndex >= 0) nextQuestions[questionIndex] = {
            ...nextQuestions[questionIndex],
            ...result
          }
          else nextQuestions.push(result)
          nextSession = updateQuestionTask({ ...nextSession, generatedQuestions: nextQuestions, paper: null, finalExplanation: '', agentState: { ...(nextSession.agentState || {}), autoRevisionTarget: '', autoRevisionInstruction: '' } }, result.questionNumber, task => ({
            ...task,
            status: 'draft_ready',
            stages: { ...(task.stages || {}), draft: 'done', solution: 'pending', verify: 'pending' },
            error: ''
          }))
        } else if (resolvedAction.toolName === 'verify_question') {
          const questionIndex = (nextSession.generatedQuestions || []).findIndex(item => String(item.questionNumber) === String(result.questionNumber))
          const nextQuestions = [...(nextSession.generatedQuestions || [])]
          if (questionIndex >= 0) nextQuestions[questionIndex] = result
          nextSession = updateQuestionTask({ ...nextSession, generatedQuestions: nextQuestions, verificationHistory: [...(nextSession.verificationHistory || []), { questionNumber: result.questionNumber, verification: result.verification, markAssessment: result.markAssessment }] }, result.questionNumber, task => ({
            ...task,
            status: result.markAssessment?.isValid === false ? 'needs_revision' : 'done',
            stages: { ...(task.stages || {}), verify: 'done' },
            error: result.markAssessment?.isValid === false ? (result.markAssessment.summary || '驗算衝突') : ''
          }))
          if (result.markAssessment && result.markAssessment.isValid === false) {
            emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_VERIFICATION_CONFLICT, { questionNumber: result.questionNumber, issues: result.markAssessment.issues || [] }))
            nextSession = pushMessage(nextSession, 'assistant', `Q${result.questionNumber} 的評分指引仍有衝突，我會再調整或要求重生。`, { kind: 'retry_explanation' })
            nextSession = {
              ...nextSession,
              finalExplanation: '',
              paper: null,
              agentState: {
                ...(nextSession.agentState || {}),
                status: 'running',
                autoRevisionTarget: result.questionNumber,
                autoRevisionInstruction: buildTeacherRevisionInstruction(result.markAssessment.summary || (result.markAssessment.issues || []).join('；') || '請修正驗算與評分衝突', result)
              }
            }
          }
        } else if (resolvedAction.toolName === 'generate_diagram') {
          nextSession = {
            ...nextSession,
            diagramHistory: [...(nextSession.diagramHistory || []), result],
            generatedQuestions: (nextSession.generatedQuestions || []).map(item => String(item.questionNumber) === String(result.questionNumber)
              ? { ...item, diagramInstructions: result.diagramInstructions || item.diagramInstructions, diagramPlan: result.diagramPlan || null, diagramImage: result.diagramImage || item.diagramImage || null }
              : item)
          }
        } else if (resolvedAction.toolName === 'compile_paper') {
          nextSession = { ...nextSession, paper: result }
        } else if (resolvedAction.toolName === 'summarize_teacher_update') {
          nextSession = { ...nextSession, finalExplanation: result.text || '' }
        } else if (resolvedAction.toolName === 'export_artifact') {
          nextSession = { ...nextSession, exportArtifact: result, agentState: { ...(nextSession.agentState || {}), lastExportAt: result.generatedAt || new Date().toISOString() } }
        }
        const done = { ...started, status: 'done', resultSummary: summarizeResult(result), result, finishedAt: new Date().toISOString() }
        nextSession = pushToolCall(nextSession, done)
        nextSession = {
          ...nextSession,
          agentState: {
            ...(nextSession.agentState || {}),
            activeToolName: '',
            activeToolStartedAt: '',
            lastTeacherResponse: resolvedAction.teacherResponse || (nextSession.agentState?.lastTeacherResponse || ''),
            pendingTeacherTurn: null,
            lastHandledTeacherMessage: nextSession.agentState?.lastHandledTeacherMessage || '',
            lastHandledTeacherToken: nextSession.agentState?.lastHandledTeacherToken || ''
          }
        }
        setSession(nextSession.sessionId, nextSession)
        emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_TOOL_CALL_DONE, done))
        if (resolvedAction.toolName === 'collect_requirements' && result.readyToGenerate === false) {
          const question = result.assistantQuestion || '請補充更多要求。'
          nextSession = pushMessage(nextSession, 'assistant', question, { kind: 'question' })
          nextSession = { ...nextSession, agentState: { ...(nextSession.agentState || {}), status: 'waiting_teacher' } }
          setSession(nextSession.sessionId, nextSession)
          emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_WAITING_TEACHER, { question }))
          emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_FOLLOWUP_REQUESTED, { question }))
          return nextSession
        }
        if (resolvedAction.subagent) {
          emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_SUBAGENT_DONE, { subagent: resolvedAction.subagent }))
        }
        continue
      } catch (error) {
        const message = error instanceof Error ? error.message : '工具執行失敗'
        const failed = { ...started, status: 'failed', message, finishedAt: new Date().toISOString() }
        nextSession = pushToolCall(nextSession, failed)
        nextSession = pushMessage(nextSession, 'assistant', `工具 ${resolvedAction.toolName} 失敗：${message}`, { kind: 'tool_error' })
        nextSession = {
          ...nextSession,
          agentState: {
            ...(nextSession.agentState || {}),
            activeToolName: '',
            activeToolStartedAt: ''
          }
        }
        setSession(nextSession.sessionId, nextSession)
        emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_TOOL_CALL_FAILED, failed))
        if (resolvedAction.subagent) emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_SUBAGENT_FAILED, { subagent: resolvedAction.subagent, message }))
        continue
      }
    }

    if (resolvedAction.type === 'finish') {
      nextSession = { ...nextSession, agentState: { ...(nextSession.agentState || {}), status: 'ready', lastHandledTeacherMessage: nextSession.agentState?.lastHandledTeacherMessage || '', lastHandledTeacherToken: nextSession.agentState?.lastHandledTeacherToken || '', pendingTeacherTurn: null } }
      setSession(nextSession.sessionId, nextSession)
      emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_RUN_FINISHED, { sessionId: nextSession.sessionId, turn: nextSession.agentState?.turn || 0 }))
      return nextSession
    }
  }

  nextSession = { ...nextSession, agentState: { ...(nextSession.agentState || {}), status: 'ready', pendingTeacherTurn: null } }
  setSession(nextSession.sessionId, nextSession)
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_RUN_FINISHED, { sessionId: nextSession.sessionId, forced: true, turn: nextSession.agentState?.turn || 0 }))
  return nextSession
}

export async function runDseAgentFlow({ sessionId, request, providerId, emit, getSession, setSession }) {
  const toolRegistry = getToolRegistry({ providerId, emit })
  let session = createInitialSession({ sessionId, providerId, request })
  session = pushMessage(session, 'user', request.teacherGoal || '請開始規劃 DSE 出題工作。', { source: 'form' })
  setSession(sessionId, session)

  const intent = await toolRegistry.collect_requirements.run({ session, input: {} })
  session = {
    ...session,
    intent,
    request: intent.paperType !== 'full' && session.request?.paperType === 'full'
      ? { ...(session.request || {}), paperType: intent.paperType }
      : session.request
  }
  setSession(sessionId, session)
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_TOOL_CALL_DONE, {
    toolCallId: `bootstrap-intent-${Date.now()}`,
    toolName: 'collect_requirements',
    input: {},
    status: 'done',
    resultSummary: summarizeResult(intent),
    result: intent,
    finishedAt: new Date().toISOString()
  }))

  if (intent.readyToGenerate === false) {
    const question = intent.assistantQuestion || '請補充更多要求。'
    session = pushMessage(session, 'assistant', question, { kind: 'question' })
    session = { ...session, agentState: { ...(session.agentState || {}), status: 'waiting_teacher' } }
    setSession(sessionId, session)
    emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_WAITING_TEACHER, { question }))
    return session
  }

  const blueprint = await toolRegistry.plan_blueprint.run({ session, input: {} })
  session = ensureQuestionTasks({ ...session, blueprint }, emit)
  setSession(sessionId, session)
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_TOOL_CALL_DONE, {
    toolCallId: `bootstrap-blueprint-${Date.now()}`,
    toolName: 'plan_blueprint',
    input: {},
    status: 'done',
    resultSummary: summarizeResult(blueprint),
    result: blueprint,
    finishedAt: new Date().toISOString()
  }))

  return runAgentLoop({ session, emit, setSession, toolRegistry })
}

export async function runDseAgentFollowupFlow({ session, message, emit, setSession }) {
  const toolRegistry = getToolRegistry({ providerId: session.providerId, emit })
  let nextSession = pushMessage(session, 'user', message, { source: 'followup' })
  const latestMessage = nextSession.messages?.[nextSession.messages.length - 1] || null
  const pendingTeacherTurn = latestMessage
    ? {
        token: buildFollowupToken({ content: latestMessage.content || '', timestamp: latestMessage.timestamp || '', source: latestMessage.source || 'followup' }),
        content: latestMessage.content || '',
        timestamp: latestMessage.timestamp || '',
        source: latestMessage.source || 'followup'
      }
    : null
  nextSession = {
    ...nextSession,
    request: {
      ...(session.request || {}),
      conversation: [...(session.request?.conversation || []), { role: 'user', content: message }]
    },
    agentState: {
      ...(session.agentState || {}),
      status: 'running',
      pendingTeacherTurn,
      lastHandledTeacherMessage: session.agentState?.lastHandledTeacherMessage,
      lastHandledTeacherToken: session.agentState?.lastHandledTeacherToken || '',
      lastTeacherResponse: ''
    }
  }
  setSession(session.sessionId, nextSession)
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_AGENT_TURN_STARTED, {
    turn: (session.agentState?.turn || 0) + 1,
    reason: '處理老師新消息'
  }))
  emit(createEvent(SESSION_EVENT_TYPES.AUTHOR_AGENT_MESSAGE, {
    role: 'assistant',
    content: '正在處理你的要求…',
    kind: 'status'
  }))
  return runAgentLoop({ session: nextSession, emit, setSession, toolRegistry })
}

export async function runDseAgentRevalidateFlow({ session, draft, emit, setSession }) {
  const updatedSession = await runDseAuthorRevalidateFlow({ session, draft, emit })
  const nextSession = validateDseAgentSession({
    ...updatedSession,
    flowType: 'dse-author',
    messages: session.messages || [],
    toolCalls: session.toolCalls || [],
    verificationHistory: [...(session.verificationHistory || []), { questionNumber: draft.questionNumber || draft.title || '', revalidate: true }],
    diagramHistory: session.diagramHistory || [],
    agentState: { ...(session.agentState || {}), status: 'running' }
  })
  setSession(session.sessionId, nextSession)
  return nextSession
}
