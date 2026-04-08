import { createEvent, SESSION_EVENT_TYPES } from '../utils/events.js'
import { solveProblem, judgeSolutions, generateDiagramCode, generateFinalExplanation, requestModel } from '../model/client.js'
import { getModelConfig } from '../model/config.js'
import {
  buildDiagramPlanPrompt,
  buildDiagramRepairPrompt,
  buildJudgePrompt,
  buildJudgeRepairPrompt,
  buildNormalizeImagePrompt,
  buildNormalizeImageRepairPrompt,
  buildSolverPrompt,
  buildSolverRepairPrompt,
  buildSimpleJudgePrompt,
  buildFinalExplanationPrompt,
  buildReviewFinalExplanationPrompt,
  buildReferenceAnswerPrompt,
  buildStudentJudgementPrompt,
  buildScoreJsPrompt,
  buildReviewRepairPrompt,
  buildReviewFollowupPrompt,
  buildPaperIndexPrompt,
  buildPaperIndexRepairPrompt,
  buildPaperReportPrompt
} from '../prompts/index.js'
import {
  validateJudgeResult,
  validateNormalizedProblem,
  validateSolverResult,
  validateReviewResult,
  validatePaperIndexResult
} from '../schemas/index.js'
import { executePythonDiagram } from '../diagram/python-runner.js'
import { renderPdfToImages } from '../pdf/renderer.js'
import { cropPageImage } from '../pdf/cropper.js'
import { appendFollowupMessage, getSession, setSession } from './session-store.js'
import { runStructuredStage } from './structured-stage.js'

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
    problemText: '請根據圖片內容解題',
    extractedText: '',
    knownConditions: [],
    goal: '',
    requiresDiagram: true
  }
}

function validateDiagramCodeResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('作圖模型輸出必須是物件')
  }

  if (typeof data.pythonCode !== 'string' || !data.pythonCode.trim()) {
    throw new Error('作圖模型輸出缺少 pythonCode')
  }

  const canvasType = data.canvasType === 'square' || data.canvasType === 'portrait' || data.canvasType === 'landscape' || data.canvasType === 'wide'
    ? data.canvasType
    : 'square'

  return {
    pythonCode: data.pythonCode.trim(),
    imageFormat: typeof data.imageFormat === 'string' ? data.imageFormat.trim().toLowerCase() : 'jpg',
    expectedFilename: typeof data.expectedFilename === 'string' && data.expectedFilename.trim()
      ? data.expectedFilename.trim()
      : 'diagram.jpg',
    canvasType,
    reasoningSummary: typeof data.reasoningSummary === 'string' ? data.reasoningSummary.trim() : ''
  }
}

function createFallbackFinalExplanation(session) {
  return [
    '題意整理：',
    session.normalizedProblem.problemText || '',
    '',
    '最終答案：',
    session.judgeResult.finalAnswer,
    '',
    '講解：',
    session.judgeResult.reasoning || '系統已完成解題，但最終講解生成失敗，這裡先顯示最小保底說明。',
    session.diagramImage ? '可配合上方圖形理解題意與關鍵關係。' : ''
  ].filter(Boolean).join('\n')
}

function createStructuredRequester(requestFn, emitDelta) {
  return (prompt, onDelta) => requestFn(prompt, delta => {
    emitDelta?.(delta)
    onDelta?.(delta)
  })
}

function createNormalizationPromise({ input }) {
  const fallback = createFallbackNormalizedProblem(input)
  return {
    normalizedProblem: fallback,
    normalizedProblemPromise: Promise.resolve(fallback)
  }
}

function emitPaperPhaseTiming(emit, phase, startedAt, extra = {}) {
  const durationMs = Math.max(0, Date.now() - startedAt)
  emit(createEvent(SESSION_EVENT_TYPES.PAPER_PHASE_TIMING, {
    phase,
    durationMs,
    ...extra
  }))
  return { phase, durationMs, ...extra }
}

function createQuestionSchedulerOptions(question) {
  const id = String(question?.questionId || question?.questionNumber || 'unknown')
  return {
    bypassScheduler: false,
    lane: `paper_review_question_${id}`
  }
}

function createQuickPaperReport(questionResults) {
  const completed = Array.isArray(questionResults)
    ? questionResults.filter(item => item?.status === 'completed')
    : []
  const totalScore = completed.reduce((sum, item) => sum + (Number(item?.awardedTotalMarks) || 0), 0)
  const maxScore = completed.reduce((sum, item) => sum + (Number(item?.maxTotalMarks) || 0), 0)
  return completed.length > 0
    ? `整卷已完成，共 ${completed.length} 題，暫計總分 ${totalScore}/${maxScore}。完整總評生成中。`
    : '整卷已完成，完整總評生成中。'
}

function createModelCallConfig({ scope, callRole, providerId, stageKey, questionId = '', questionNumber = '', groupId = '', questionNumbers = [], schedulerOptions = null }) {
  return {
    scope,
    callRole,
    providerId,
    stageKey,
    questionId,
    questionNumber,
    groupId,
    questionNumbers,
    schedulerOptions
  }
}

async function runWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : []
  const limit = Math.max(1, Number(concurrency) || 1)
  const results = new Array(list.length)
  let nextIndex = 0

  async function consume() {
    while (nextIndex < list.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(list[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => consume()))
  return results
}

function repairBrokenMathText(text) {
  let repaired = String(text || '')

  repaired = repaired
    .replaceAll(/\\times/g, ' <<CC_TIMES>> ')
    .replaceAll(/\\neq/g, ' <<CC_NEQ>> ')
    .replaceAll(/\\text/g, ' <<CC_TEXT>> ')
    .replaceAll(/(?<![\\\w])imes\b/g, '<<CC_TIMES>>')
    .replaceAll(/(?<=[\\({\[]|^)\s*imes\b/g, '<<CC_TIMES>>')
    .replaceAll(/(?<=π)\s*imes\b/g, ' <<CC_TIMES>> ')
    .replaceAll(/(?<=[\dA-Za-z)}\].,])\s*imes\b/g, ' <<CC_TIMES>> ')
    .replaceAll(/(?<=\})\s*imes\b/g, ' <<CC_TIMES>> ')
    .replaceAll(/(?<=\s)imes\b/g, '<<CC_TIMES>>')
    .replaceAll(/(?<![\\\w])ext(?=\{|\b)/g, '<<CC_TEXT>>')
    .replaceAll(/(?<=[_^{(\s])ext(?=\{|\b)/g, '<<CC_TEXT>>')
    .replaceAll(/(?<![\\\w])text(?=\{|\b)/g, '<<CC_TEXT>>')
    .replaceAll(/(?<=[_^{(\s])text(?=\{|\b)/g, '<<CC_TEXT>>')
    .replaceAll(/(?<![\\\w])eq\b/g, '<<CC_NEQ>>')
    .replaceAll(/(?<=π)\s*eq\b/g, ' <<CC_NEQ>> ')
    .replaceAll(/(?<=[\dA-Za-z)}\].])\s*eq\b/g, ' <<CC_NEQ>> ')
    .replaceAll(/(?<=\s)eq\b/g, '<<CC_NEQ>>')
    .replaceAll(/(?<![\\\w])frac(?=\{)/g, '\\frac')
    .replaceAll(/(?<![\\\w])sqrt(?=\{)/g, '\\sqrt')
    .replaceAll(/(?<![\\\w])pi\b/g, '\\pi')
    .replaceAll(/(?<![\\\w])extArea\b/g, '<<CC_TEXT>>{Area}')
    .replaceAll(/(?<![\\\w])textArea\b/g, '<<CC_TEXT>>{Area}')
    .replaceAll(/(?<![\\\w])Area\b/g, '<<CC_TEXT>>{Area}')
    .replaceAll(/(?<![\\\w])riangle(?=[A-Z\s])/g, '\\triangle')
    .replaceAll(/(?<![\\\w])triangle(?=[A-Z\s])/g, '\\triangle')
    .replaceAll(/(?:\\?text|ext)常數/g, ' 常數')
    .replaceAll(/(?:\\?text|ext)最大/g, ' 最大')
    .replaceAll(/(?:\\?text|ext)最小/g, ' 最小')
    .replaceAll(/(?:\\?text|ext)因此/g, ' 因此')
    .replaceAll(/(?:\\?text|ext)所以/g, ' 所以')
    .replaceAll(/(?:\\?text|ext)可得/g, ' 可得')
    .replaceAll(/(?:\\?text|ext)即/g, ' 即')
    .replaceAll(/(?:\\?text|ext)當/g, ' 當')
    .replaceAll(/(?<=\d)\s*(?:\\?text|ext)\s*\{?\s*cm\s*\}?\s*\^\s*3\b/g, '<<CC_TEXT>>{ cm}^3')
    .replaceAll(/(?<=π)\s*(?:\\?text|ext)\s*\{?\s*cm\s*\}?\s*\^\s*3\b/g, '<<CC_TEXT>>{ cm}^3')
    .replaceAll(/(?<=\d)\s*(?:\\?text|ext)\s*\{?\s*cm\s*\}?\s*\^\s*2\b/g, '<<CC_TEXT>>{ cm}^2')
    .replaceAll(/(?<=π)\s*(?:\\?text|ext)\s*\{?\s*cm\s*\}?\s*\^\s*2\b/g, '<<CC_TEXT>>{ cm}^2')
    .replaceAll(/(?<=\d)\s*(?:\\?text|ext)\s*\{?\s*cm\s*\}?\b/g, '<<CC_TEXT>>{ cm}')
    .replaceAll(/(?<=π)\s*(?:\\?text|ext)\s*\{?\s*cm\s*\}?\b/g, '<<CC_TEXT>>{ cm}')

  repaired = repaired
    .replaceAll(/<<CC_TEXT>>\s*\{\s*([^{}\n]{1,24})\s*\}/g, (_, label) => `\\text{${label.trim()}}`)
    .replaceAll(/<<CC_TEXT>>(?=[A-Za-z一-龥])/g, '\\text')
    .replaceAll(/<<CC_TIMES>>\s*<<CC_TIMES>>/g, '<<CC_TIMES>>')
    .replaceAll(/\s*<<CC_TIMES>>\s*/g, ' \\times ')
    .replaceAll(/\s*<<CC_NEQ>>\s*/g, ' \\neq ')
    .replaceAll(/\s*<<CC_TEXT>>\s*/g, '\\text ')
    .replaceAll(/=\s*=+/g, '=')
    .replaceAll(/[ \t]{2,}/g, ' ')
    .trim()

  return repaired
}

function rewriteMathLabelSegments(text) {
  return String(text || '')
    .replaceAll(/\\text\{\s*曲面面積\s*\}\s*=\s*/g, 'A = ')
    .replaceAll(/\\text\{\s*原錐曲面面積\s*\}\s*=\s*/g, 'A = ')
    .replaceAll(/\\text\{\s*原錐曲面\s*\}/g, 'A')
    .replaceAll(/\\text\{\s*圓錐\s*A\s*曲面\s*\}/g, 'A_A')
    .replaceAll(/V_\{\s*\\text\{\s*原錐\s*\}\s*\}/g, 'V')
    .replaceAll(/V_\{\s*\\text\{\s*每一個\s*\}\s*\}/g, 'V')
    .replaceAll(/V_\{\s*\\text\{\s*每一個新圓錐\s*\}\s*\}/g, 'V')
}

function normalizeMathSegment(text) {
  const normalized = repairBrokenMathText(String(text || ''))
    .replaceAll(/\\quad/g, ' ')
    .replaceAll(/\\,/g, ' ')
    .replaceAll(/[ \t]{2,}/g, ' ')
    .replaceAll(/\\text\s+\{/g, '\\text{')
    .replaceAll(/_\{\s+/g, '_{')
    .replaceAll(/\s+\}/g, '}')
    .trim()

  return rewriteMathLabelSegments(normalized)
}

function normalizeProseMathCandidates(text) {
  return String(text || '')
    .replaceAll(/\\text\{\s*第\s*\}\s*(\d+)\s*\\text\{\s*個\s*\}\s*=\s*([^\n，。]+)/g, '第 $1 個數據為 $$$2$$')
    .replaceAll(/(?:\\text|ext)\{\s*第\s*\}(\d+)(?:\\text|ext)\{\s*個\s*\}\s*=\s*([^\n，。]+)/g, '第 $1 個數據為 $$$2$$')
    .replaceAll(/([^\n，。]+?)\s*(?:\\text|ext)\{\s*或\s*\}\s*([^\n，。]+)/g, '$$$1$$ 或 $$$2$$')
    .replaceAll(/([^\n，。]+?)\s*(?:\\text|ext)\{\s*and\s*\}\s*([^\n，。]+)/gi, '$$$1$$ and $$$2$$')
    .replaceAll(/(?<![\\$])\b([A-Za-z])\s*=\s*([^\n，。]+?)\s*(?:或|and)\s*\1\s*=\s*([^\n，。]+)(?![$\\])/g, '$$$1 = $2$$ 或 $$$1 = $3$$')
    .replaceAll(/(?<![\\$])\b([A-Za-z])\s*=\s*([^\n，。]+?)(?![$\\])/g, (match, variable, value) => {
      const candidate = `${variable} = ${value}`.trim()
      if (!/[0-9π\\frac\\sqrt()+\-*/.^]/.test(candidate)) {
        return match
      }

      if (/^(因此|所以|可得|即|當|若|設|令)\b/.test(candidate)) {
        return match
      }

      return `$$${candidate}$$`
    })
    .replaceAll(/\$\$\s*([^$]+?)\s*\$\$\s*或\s*\$\$\s*([^$]+?)\s*\$\$/g, '$$$1$$ 或 $$$2$$')
    .replaceAll(/\$\$\s*([^$]+?)\s*\$\$\s*and\s*\$\$\s*([^$]+?)\s*\$\$/gi, '$$$1$$ and $$$2$$')
}

function normalizeProseSegment(text) {
  return normalizeProseMathCandidates(
    repairBrokenMathText(
      String(text || '')
        .replaceAll('\r\n', '\n')
        .replaceAll('\\n', '\n')
        .replaceAll(/(?:\\?text|ext)常數/g, '常數')
        .replaceAll(/(?:\\?text|ext)最大/g, '最大')
        .replaceAll(/(?:\\?text|ext)最小/g, '最小')
        .replaceAll(/(?:\\?text|ext)因此/g, '因此')
        .replaceAll(/(?:\\?text|ext)所以/g, '所以')
        .replaceAll(/(?:\\?text|ext)可得/g, '可得')
        .replaceAll(/(?:\\?text|ext)即/g, '即')
        .replaceAll(/(?:\\?text|ext)當/g, '當')
        .replaceAll(/[ \t]+\n/g, '\n')
        .replaceAll(/[ \t]{2,}/g, ' ')
    )
  )
}

function normalizeExplanationSegments(text) {
  const input = String(text || '')
  const pattern = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+\$)/g

  let result = ''
  let lastIndex = 0

  for (const match of input.matchAll(pattern)) {
    const matchedText = match[0]
    const startIndex = match.index ?? 0

    if (startIndex > lastIndex) {
      result += normalizeProseSegment(input.slice(lastIndex, startIndex))
    }

    if (matchedText.startsWith('$$')) {
      result += `$$${normalizeMathSegment(matchedText.slice(2, -2))}$$`
    } else if (matchedText.startsWith('\\[')) {
      result += `\\[${normalizeMathSegment(matchedText.slice(2, -2))}\\]`
    } else if (matchedText.startsWith('\\(')) {
      result += `\\(${normalizeMathSegment(matchedText.slice(2, -2))}\\)`
    } else {
      result += `$${normalizeMathSegment(matchedText.slice(1, -1))}$`
    }

    lastIndex = startIndex + matchedText.length
  }

  if (lastIndex < input.length) {
    result += normalizeProseSegment(input.slice(lastIndex))
  }

  return result
}

function normalizeUnitAnswerLines(text) {
  return String(text || '')
    .replaceAll(/(曲面面積為|表面積為|面積為)\s*\$?\s*([^$，。\n]+?)\s*(?:\\text\{\s*cm\s*\}\s*\^\s*2|ext\s*cm\s*2|text\s*cm\s*2|cm\s*2)\s*\$?([，。])/g, '$1 $$$2$$，單位為平方厘米$3')
    .replaceAll(/(體積為)\s*\$?\s*([^$，。\n]+?)\s*(?:\\text\{\s*cm\s*\}\s*\^\s*3|ext\s*cm\s*3|text\s*cm\s*3|cm\s*3)\s*\$?([，。])/g, '$1 $$$2$$，單位為立方厘米$3')
    .replaceAll(/(長度為|半徑為|直徑為|高為|斜高為)\s*\$?\s*([^$，。\n]+?)\s*(?:\\text\{\s*cm\s*\}|ext\s*cm|text\s*cm|cm)\s*\$?([，。])/g, '$1 $$$2$$，單位為厘米$3')
}

function simplifyOverlongFormulaChains(text) {
  return String(text || '').replaceAll(/\$\$([\s\S]*?)\$\$/g, (block, inner) => {
    const equationCount = (inner.match(/=/g) || []).length
    if (equationCount <= 2) {
      return block
    }

    const parts = inner.split('=').map(part => part.trim()).filter(Boolean)
    if (parts.length < 2) {
      return block
    }

    const shortened = `${parts[0]} = ${parts[parts.length - 1]}`
    return `$$${shortened}$$`
  })
}

function normalizeExplanationText(text) {
  return normalizeUnitAnswerLines(
    simplifyOverlongFormulaChains(
      normalizeExplanationSegments(String(text || ''))
        .replaceAll('\r\n', '\n')
        .replaceAll(/[ \t]{2,}/g, ' ')
        .replaceAll(/\n\s*\n-{10,}\n\s*/g, '\n\n--------------------------------\n\n')
        .replaceAll(/([^\n：])\\\[/g, '$1\n\\[')
        .replaceAll(/\\\]([^\n，。])/g, '\\]\n$1')
        .trim()
    )
  )
    .replaceAll(/\n{3,}/g, '\n\n')
    .replaceAll(/\b公式為：\s*\\\[\s*A\s*=\s*([^\]]+)\\\]/g, '公式為：\n\\[$A = $1\\]')
    .replaceAll(/\b公式為：\s*\\\[\s*V\s*=\s*([^\]]+)\\\]/g, '公式為：\n\\[$V = $1\\]')
    .replaceAll(/\\\[\s*A\s*=\s*([^\]]+)\\\]/g, '公式為：\n\\[$A = $1\\]')
    .replaceAll(/\\\[\s*V\s*=\s*([^\]]+)\\\]/g, '公式為：\n\\[$V = $1\\]')
    .replaceAll(/\\text\s+\{/g, '\\text{')
    .replaceAll(/_\{\s+/g, '_{')
    .replaceAll(/\s+\}/g, '}')
    .trim()
}

function createReviewUserContent(input) {
  const items = []

  if (input.problem?.type === 'image' && input.problem.imageBase64) {
    items.push({
      type: 'text',
      text: '這是題目圖片。請只抽取題目本身的可讀內容，不要加入額外解題。'
    })
    items.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: input.problem.mediaType || 'image/png',
        data: input.problem.imageBase64
      }
    })
  }

  if (input.studentWork?.type === 'image' && input.studentWork.imageBase64) {
    items.push({
      type: 'text',
      text: '這是學生解題過程圖片。請抽取學生作答步驟與式子。'
    })
    items.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: input.studentWork.mediaType || 'image/png',
        data: input.studentWork.imageBase64
      }
    })
  }

  if (input.studentAnswer?.provided && input.studentAnswer.type === 'image' && input.studentAnswer.imageBase64) {
    items.push({
      type: 'text',
      text: '這是學生最終答案圖片。請只抽取答案內容。'
    })
    items.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: input.studentAnswer.mediaType || 'image/png',
        data: input.studentAnswer.imageBase64
      }
    })
  }

  return items
}

function createReviewTextInput(input, extracted = {}) {
  const fallbackReviewInput = createFallbackReviewInputFromQuestion(input.problem || {})
  return {
    problem: input.problem,
    studentWork: input.studentWork,
    problemText: input.problem?.type === 'text'
      ? (input.problem.text || fallbackReviewInput.problemText)
      : (extracted.problemText || input.problem?.text || fallbackReviewInput.problemText),
    studentWorkText: input.studentWork?.type === 'text'
      ? (input.studentWork.text || fallbackReviewInput.studentWorkText)
      : (extracted.studentWorkText || input.studentWork?.text || fallbackReviewInput.studentWorkText),
    studentAnswer: {
      provided: Boolean(input.studentAnswer?.provided),
      type: input.studentAnswer?.type || 'text',
      text: input.studentAnswer?.type === 'text' ? (input.studentAnswer.text || '') : (extracted.studentAnswerText || ''),
      imageBase64: input.studentAnswer?.imageBase64 || '',
      mediaType: input.studentAnswer?.mediaType || 'image/png'
    }
  }
}

function buildReviewNormalizationPrompt(input) {
  return {
    system: [
      '你是香港 DSE Core Math 題目與學生作答抽取助手。',
      '你必須只輸出合法 JSON。',
      '不要輸出 markdown 程式碼區塊。',
      '不要輸出額外解釋。',
      '請準確抽取題目、學生解題過程、學生答案（如有）中的可讀文字。',
      '數學式可保留原貌；看不清的部分可留空，不要亂猜。',
      '返回 JSON: {"problemText":"","studentWorkText":"","studentAnswerText":""}'
    ].join('\n'),
    user() {
      return [
        input.problem?.type === 'image' ? '題目來源: 圖片' : `題目來源: 文字\n${input.problem?.text || ''}`,
        input.studentWork?.type === 'image' ? '學生解題過程來源: 圖片' : `學生解題過程來源: 文字\n${input.studentWork?.text || ''}`,
        input.studentAnswer?.provided
          ? (input.studentAnswer.type === 'image' ? '學生最終答案來源: 圖片' : `學生最終答案來源: 文字\n${input.studentAnswer.text || ''}`)
          : '學生最終答案: 未提供'
      ].join('\n\n')
    },
    userContent() {
      return createReviewUserContent(input)
    },
    stream: true,
    maxCompletionTokens: 2200
  }
}

function validateReviewExtractionResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('學生作答抽取結果必須是物件')
  }

  return {
    problemText: typeof data.problemText === 'string' ? data.problemText.trim() : '',
    studentWorkText: typeof data.studentWorkText === 'string' ? data.studentWorkText.trim() : '',
    studentAnswerText: typeof data.studentAnswerText === 'string' ? data.studentAnswerText.trim() : ''
  }
}

function isQuestionTextUsable(question) {
  const text = String(question?.normalizedQuestionText || '').trim()
  if (!text) return false
  if (text.length < 12) return false
  if (/寫在頁邊空白位置的答案將不予評分|本頁不能作答|本頁作答無效|一般指示/.test(text)) return false
  return /[0-9A-Za-z一-龥]/.test(text)
}

function createQuestionReviewFallbackText(question, kind = 'problem') {
  const questionNumber = String(question?.questionNumber || '').trim()
  const visibleMarks = String(question?.visibleMarks || '').trim()
  const regionHint = String(question?.regionHint || '').trim()
  const normalizedQuestionText = String(question?.normalizedQuestionText || '').trim()

  if (kind === 'work') {
    return [
      `這是第 ${questionNumber || '?'} 題的學生作答頁面。`,
      regionHint ? `定位提示：${regionHint}。` : '',
      visibleMarks ? `可見分數：${visibleMarks}。` : '',
      '請根據頁面中與本題相關的可見學生作答內容進行批改；若內容較少，也要按可見步驟判分。'
    ].filter(Boolean).join('\n')
  }

  return isQuestionTextUsable(question)
    ? normalizedQuestionText
    : [
        `第 ${questionNumber || '?'} 題。`,
        visibleMarks ? `可見分數：${visibleMarks}。` : '',
        regionHint ? `定位提示：${regionHint}。` : '',
        '請只根據該題所在位置的可見題目內容理解題意，忽略同頁其他題目。'
      ].filter(Boolean).join('\n')
}

function createFallbackReviewInputFromQuestion(question) {
  return {
    problemText: createQuestionReviewFallbackText(question, 'problem'),
    studentWorkText: createQuestionReviewFallbackText(question, 'work'),
    studentAnswer: {
      provided: false,
      type: 'text',
      text: ''
    }
  }
}

async function createReviewContext({ input, providerId, emit }) {
  const hasAnyImage = input.problem?.type === 'image'
    || input.studentWork?.type === 'image'
    || (input.studentAnswer?.provided && input.studentAnswer.type === 'image')

  if (!hasAnyImage) {
    return createReviewTextInput(input)
  }

  if (input.problem?.type === 'image' && !input.problem.imageBase64 && Array.isArray(input.problem.pages) && input.problem.pages.length > 0) {
    input.problem.imageBase64 = input.problem.pages[0]?.reviewImageBase64 || input.problem.pages[0]?.imageBase64 || ''
    input.problem.mediaType = input.problem.pages[0]?.mediaType || input.problem.mediaType || 'image/png'
  }

  if (input.studentWork?.type === 'image' && !input.studentWork.imageBase64 && Array.isArray(input.studentWork.pages) && input.studentWork.pages.length > 0) {
    input.studentWork.imageBase64 = input.studentWork.pages[0]?.reviewImageBase64 || input.studentWork.pages[0]?.imageBase64 || ''
    input.studentWork.mediaType = input.studentWork.pages[0]?.mediaType || input.studentWork.mediaType || 'image/png'
  }

  const fallbackReviewInput = createFallbackReviewInputFromQuestion(input.problem || {})
  return {
    problem: input.problem,
    studentWork: input.studentWork,
    problemText: String(input.problem?.text || '').trim() || fallbackReviewInput.problemText,
    studentWorkText: String(input.studentWork?.text || '').trim() || fallbackReviewInput.studentWorkText,
    studentAnswer: {
      provided: Boolean(input.studentAnswer?.provided),
      type: input.studentAnswer?.type || 'text',
      text: input.studentAnswer?.type === 'text' ? (input.studentAnswer.text || '') : '',
      imageBase64: input.studentAnswer?.imageBase64 || '',
      mediaType: input.studentAnswer?.mediaType || 'image/png'
    }
  }
}

function buildReviewFollowupSummary(history) {
  if (!Array.isArray(history) || history.length <= 6) {
    return ''
  }

  const olderHistory = history.slice(0, -6)
  return olderHistory
    .map(item => `${item.role === 'assistant' ? '助手' : '用戶'}曾提及：${item.content}`)
    .join('；')
    .slice(0, 1200)
}

function projectReviewFollowupSession(session, question) {
  const history = Array.isArray(session.followupMessages) ? session.followupMessages : []
  const nextHistory = [...history, { role: 'user', content: question }].slice(-12)

  return {
    ...session,
    followupSummary: buildReviewFollowupSummary(nextHistory),
    followupMessages: nextHistory.slice(-6)
  }
}

function classifyReviewQuestion(question) {
  const text = String(question || '')

  if (/扣分|幾分|得分|失分|評分/.test(text)) return 'scoring'
  if (/哪一步|邊一步|錯在|錯咗|為什麼錯|點解錯/.test(text)) return 'mistake_step'
  if (/另一個方法|替代做法|可唔可以用|可以用/.test(text)) return 'alternative_method'
  if (/答案|最終答案|標準答案/.test(text)) return 'final_answer'
  return 'general'
}

function createReviewFailure(message, code = 'review_failed', details = null) {
  const error = new Error(message)
  error.reviewCode = code
  if (details && typeof details === 'object') {
    error.details = details
  }
  return error
}

function projectReviewResultToJudgeLike(reviewResult) {
  const reasoningParts = [
    reviewResult.referenceReasoning || '',
    reviewResult.answerVerdict || '',
    reviewResult.methodVerdict || '',
    reviewResult.whyWrong || ''
  ].filter(Boolean)

  return {
    finalAnswer: reviewResult.referenceAnswer || '',
    reasoning: reasoningParts.join('；'),
    diagramDecision: reviewResult.diagramDecision || 'unnecessary',
    diagramReason: reviewResult.diagramReason || ''
  }
}

function createFallbackScorePlan(normalizedProblem, visibleMarks = '') {
  const normalizedVisibleMarks = String(visibleMarks || '').trim()
  const matchedNumbers = Array.from(normalizedVisibleMarks.matchAll(/\d+(?:\.\d+)?/g))
    .map(match => Number(match[0]))
    .filter(Number.isFinite)
  const derivedTotalMarks = matchedNumbers.reduce((sum, value) => sum + value, 0)

  return {
    totalMarks: derivedTotalMarks,
    totalMarksSource: normalizedVisibleMarks ? 'problem' : 'estimated',
    reasoning: normalizedVisibleMarks
      ? `根據題面可見分數 ${normalizedVisibleMarks} 建立保底分數規劃。`
      : (normalizedProblem?.problemText ? '未能可靠識別題目分數，暫以估算模式保底。' : ''),
    subparts: [{ label: '整題', maxMarks: derivedTotalMarks, reasoning: normalizedVisibleMarks ? `由題面分數 ${normalizedVisibleMarks} 直接推定。` : '' }]
  }
}

function shouldSkipReviewScorePlan({ input, normalizedProblem }) {
  if (input?.mode !== 'simple') return false
  const visibleMarks = String(input?.problem?.visibleMarks || '').trim()
  if (visibleMarks) return true
  const problemText = String(normalizedProblem?.problemText || '')
  return /\d+(?:\.\d+)?\s*分|\(\s*\d+(?:\.\d+)?\s*分\s*\)|\[\s*\d+(?:\.\d+)?\s*分\s*\]/.test(problemText)
}

function projectScorePlanForPrompt(scorePlan) {
  if (!scorePlan) return ''
  return [
    `總分: ${scorePlan.totalMarks}`,
    `分數來源: ${scorePlan.totalMarksSource === 'problem' ? '題目標示' : '模型估算'}`,
    Array.isArray(scorePlan.subparts) && scorePlan.subparts.length > 0
      ? `分題滿分: ${scorePlan.subparts.map(item => `${item.label} ${item.maxMarks}`).join('；')}`
      : '',
    scorePlan.reasoning ? `分數規劃說明: ${scorePlan.reasoning}` : ''
  ].filter(Boolean).join('\n')
}

function looksLikeExtractionPlaceholder(text) {
  const normalized = String(text || '').trim().toLowerCase()
  if (!normalized) return false
  return [
    '只處理題目與學生作答的文字抽取',
    '只抽取學生作答步驟與式子',
    '尚未進行批改與錯因分析',
    '僅為文字與式子抄錄',
    'current task is only to extract text',
    'not to judge correctness',
    'use the extracted question content and student work for later marking',
    'student work transcription'
  ].some(fragment => normalized.includes(fragment))
}

function hasPseudoJudgementContent(result) {
  const texts = [
    result?.answerVerdict,
    result?.methodVerdict,
    result?.whyWrong,
    result?.scoreJudgement,
    result?.suggestedNextStep,
    ...(Array.isArray(result?.markingNotes) ? result.markingNotes : []),
    ...(Array.isArray(result?.scoreBreakdown) ? result.scoreBreakdown.map(item => item?.comment) : [])
  ]
  return texts.some(looksLikeExtractionPlaceholder)
}

function isSemanticallyEmptyJudgement(result) {
  const answerVerdict = String(result?.answerVerdict || '').trim()
  const methodVerdict = String(result?.methodVerdict || '').trim()
  const whyWrong = String(result?.whyWrong || '').trim()
  const scoreJudgement = String(result?.scoreJudgement || '').trim()
  const suggestedNextStep = String(result?.suggestedNextStep || '').trim()
  const referenceAnswer = String(result?.referenceAnswer || '').trim()
  const referenceReasoning = String(result?.referenceReasoning || '').trim()
  const markingNotes = Array.isArray(result?.markingNotes) ? result.markingNotes.filter(item => String(item || '').trim()) : []

  return (!answerVerdict && !methodVerdict && !whyWrong && !scoreJudgement && !suggestedNextStep && !referenceAnswer && !referenceReasoning && markingNotes.length === 0)
    || hasPseudoJudgementContent(result)
}

function isSemanticallyEmptyScoreResult(result) {
  const answerVerdict = String(result?.answerVerdict || '').trim()
  const methodVerdict = String(result?.methodVerdict || '').trim()
  const whyWrong = String(result?.whyWrong || '').trim()
  const scoreJudgement = String(result?.scoreJudgement || '').trim()
  const suggestedNextStep = String(result?.suggestedNextStep || '').trim()
  const referenceAnswer = String(result?.referenceAnswer || '').trim()
  const referenceReasoning = String(result?.referenceReasoning || '').trim()
  const notes = Array.isArray(result?.markingNotes) ? result.markingNotes.filter(item => String(item || '').trim()) : []
  const comments = Array.isArray(result?.scoreBreakdown)
    ? result.scoreBreakdown.map(item => String(item?.comment || '').trim()).filter(Boolean)
    : []
  const awarded = Number(result?.awardedTotalMarks) || 0
  const max = Number(result?.maxTotalMarks) || 0

  return (awarded === 0
    && max >= 0
    && !answerVerdict
    && !methodVerdict
    && !whyWrong
    && !scoreJudgement
    && !suggestedNextStep
    && !referenceAnswer
    && !referenceReasoning
    && notes.length === 0
    && comments.length === 0)
    || hasPseudoJudgementContent(result)
}

function buildJudgementSummary(judgement) {
  if (!judgement) return null
  return {
    answerVerdict: String(judgement?.answerVerdict || '').trim(),
    methodVerdict: String(judgement?.methodVerdict || '').trim(),
    whyWrong: String(judgement?.whyWrong || '').trim(),
    scoreJudgement: String(judgement?.scoreJudgement || '').trim(),
    suggestedNextStep: String(judgement?.suggestedNextStep || '').trim(),
    markingNotes: Array.isArray(judgement?.markingNotes) ? judgement.markingNotes.map(item => String(item || '').trim()).filter(Boolean) : []
  }
}

function extractReviewPageDiagnostics(question, session = null) {
  const reviewPages = Array.isArray(session?.reviewInput?.problem?.pages)
    ? session.reviewInput.problem.pages
    : (Array.isArray(question?.pages) ? question.pages : [])

  return {
    cropApplied: reviewPages.some(page => page?.cropApplied === true),
    cropFallback: reviewPages.some(page => page?.cropFallback === true),
    cropRegionHint: String(reviewPages.find(page => page?.cropRegionHint)?.cropRegionHint || question?.regionHint || '').trim(),
    reviewPageCount: reviewPages.length
  }
}

function buildReviewDiagnostics({ question, session = null, stageError = null }) {
  return {
    ...extractReviewPageDiagnostics(question, session),
    emptyJudgement: session ? isSemanticallyEmptyJudgement(session?.judgementResult) : false,
    emptyScore: session ? isSemanticallyEmptyScoreResult(session?.reviewResult) : false,
    referenceAnswerCorrupted: session ? isReferenceAnswerCorrupted(session?.referenceAnswerResult) : false,
    stage: stageError?.stage || '',
    errorType: stageError?.errorType || ''
  }
}

function enrichQuestionResultFromSession(baseResult, session = null, stageError = null) {
  return {
    ...baseResult,
    referenceAnswer: String(session?.referenceAnswerResult?.referenceAnswer || '').trim(),
    referenceReasoning: String(session?.referenceAnswerResult?.referenceReasoning || '').trim(),
    judgementSummary: buildJudgementSummary(session?.judgementResult),
    reviewDiagnostics: buildReviewDiagnostics({ question: baseResult, session, stageError })
  }
}

function isReferenceAnswerCorrupted(result) {
  const answer = String(result?.referenceAnswer || '').trim()
  const reasoning = String(result?.referenceReasoning || '').trim()
  const combined = `${answer}\n${reasoning}`

  if (!answer) return true
  if (/題目內容抽取|學生作答步驟|questionContent|problemContent|studentWork/.test(combined)) return true
  if (/^\s*\{[\s\S]*\}\s*$/.test(answer) && /questionContent|problemContent|studentWork/.test(answer)) return true

  const normalizedAnswer = answer.replace(/\s+/g, '')
  if (normalizedAnswer.length < 2) return true
  if (/^(請根據圖片|未能判讀|無法判斷|未提供|看不清|看不到)/.test(answer)) return true
  if (/^(本題|題目|學生|作答|已知|要求)/.test(answer) && !/[=≈\d()xya-zA-Z]/.test(answer)) return true

  return false
}

function createFallbackReviewExplanation(session) {
  const rr = session.reviewResult || {}
  return [
    '題意整理：',
    session.normalizedProblem?.problemText || '',
    '',
    '標準答案：',
    rr.referenceAnswer || '未能取得',
    '',
    '批改結論：',
    rr.answerVerdict || '未能取得',
    rr.methodVerdict ? `方法評價：${rr.methodVerdict}` : '',
    rr.whyWrong ? `錯因：${rr.whyWrong}` : '',
    rr.suggestedNextStep ? `建議：${rr.suggestedNextStep}` : '',
    session.diagramImage ? '可配合上方圖形理解題意與關鍵關係。' : ''
  ].filter(Boolean).join('\n')
}

async function createSharedReviewPreparation({ input, providerId, emit }) {
  const reviewInput = await createReviewContext({ input, providerId, emit })
  if (!reviewInput.problemText) {
    throw createReviewFailure('未能提取到可用題目內容', 'review_problem_missing')
  }

  if (!reviewInput.studentWorkText) {
    reviewInput.studentWorkText = createFallbackReviewInputFromQuestion(input.problem || {}).studentWorkText
  }

  if (!reviewInput.studentWorkText) {
    throw createReviewFailure('未能提取到可用學生作答內容', 'review_work_missing')
  }

  const normalizedProblem = validateNormalizedProblem({
    sourceType: input.problem?.type || 'text',
    problemText: reviewInput.problemText,
    extractedText: reviewInput.problemText,
    knownConditions: [],
    goal: '',
    requiresDiagram: false
  })

  emit(createEvent(SESSION_EVENT_TYPES.PROBLEM_NORMALIZED, normalizedProblem))
  const scorePlan = createFallbackScorePlan(normalizedProblem, input?.problem?.visibleMarks || '')
  return { reviewInput, normalizedProblem, scorePlan }
}

async function finalizeReviewSession({ sessionId, providerId, input, reviewInput, normalizedProblem, scorePlan, reviewResult, emit, referenceAnswer = null, judgement = null }) {
  emit(createEvent(SESSION_EVENT_TYPES.REVIEW_DONE, reviewResult))

  const judgeLike = projectReviewResultToJudgeLike(reviewResult)
  emit(createEvent(SESSION_EVENT_TYPES.FINAL_ANSWER_READY, judgeLike))

  let session = {
    sessionId,
    providerId,
    flowType: 'review',
    reviewMode: input.mode || 'hard',
    input: input.problem || { type: 'text', text: reviewInput.problemText },
    reviewInput,
    normalizedProblem,
    studentWorkText: reviewInput.studentWorkText,
    studentAnswer: reviewInput.studentAnswer,
    reviewResult,
    scorePlan,
    scoreBreakdown: reviewResult.scoreBreakdown || [],
    judgeResult: judgeLike,
    referenceAnswerResult: referenceAnswer,
    judgementResult: judgement,
    solverA: null,
    solverB: null,
    diagramImage: null,
    diagramPlan: null,
    finalExplanation: '',
    followupSummary: '',
    followupMessages: []
  }

  setSession(sessionId, session)

  if (reviewResult.diagramDecision === 'required') {
    try {
      session = await runDiagramFlow({ session, emit })
    } catch {
      // diagram failure is non-fatal for review
    }
  }

  session = await runReviewFinalExplanationFlow({ session, emit })
  return session
}

function createReferenceAnswerUserContent(reviewInput) {
  const problem = reviewInput?.problem || {}
  const pages = Array.isArray(problem.pages) ? problem.pages : []
  const mediaType = problem.mediaType || 'image/png'
  const items = []

  for (const page of pages) {
    const imageBase64 = page?.reviewImageBase64 || page?.imageBase64 || ''
    if (!imageBase64) continue
    items.push({
      type: 'text',
      text: `這是第 ${page.pageNumber || '?'} 頁的題目圖片，只可根據這一頁的本題內容直接求出標準答案。不得整理題目，不得描述圖片，不得提及學生作答。`
    })
    items.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: page?.mediaType || mediaType,
        data: imageBase64
      }
    })
  }

  if (items.length === 0 && problem.imageBase64) {
    items.push({
      type: 'text',
      text: '這是題目圖片。你必須直接解題並輸出標準答案，不得整理題目或描述圖片。'
    })
    items.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: problem.imageBase64
      }
    })
  }

  return items
}

async function runReferenceAnswerStage({ mode, providerId, emit, normalizedProblem, reviewInput, scorePlan, schedulerOptions = null }) {
  const runSingle = async (variant = 'single') => runStructuredStage({
    stageKey: variant === 'single' ? 'reference_answer' : `reference_answer_${String(variant).toLowerCase()}`,
    emit,
    request: createStructuredRequester(judgeSolutions),
    mainPrompt: {
      ...buildReferenceAnswerPrompt({ normalizedProblem, studentWorkText: reviewInput.studentWorkText, studentAnswer: reviewInput.studentAnswer, scorePlan, variant }),
      providerId,
      userContent: () => createReferenceAnswerUserContent(reviewInput)
    },
    buildRepairPrompt: options => ({ ...buildReviewRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 2400 }),
    validator: data => ({
      referenceAnswer: String(data?.referenceAnswer || '').trim(),
      referenceReasoning: String(data?.referenceReasoning || '').trim()
    }),
    repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
    failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
    modelCall: createModelCallConfig({
      scope: 'question_review',
      callRole: variant === 'single' ? 'reference_answer' : `reference_answer_${String(variant).toLowerCase()}`,
      providerId,
      stageKey: 'reference_answer',
      schedulerOptions
    })
  })

  emit(createEvent(SESSION_EVENT_TYPES.REFERENCE_ANSWER_STARTED, { mode }))

  if (mode !== 'hard') {
    const result = await runSingle('single')
    if (isReferenceAnswerCorrupted(result)) {
      throw createReviewFailure('參考答案階段輸出了題目/學生作答整理，而非真正標準答案', 'reference_answer_corrupted')
    }
    emit(createEvent(SESSION_EVENT_TYPES.REFERENCE_ANSWER_DONE, result))
    return result
  }

  const [answerA, answerB] = await Promise.all([runSingle('A'), runSingle('B')])
  const judgePrompt = {
    ...buildReferenceAnswerPrompt({ normalizedProblem, studentWorkText: reviewInput.studentWorkText, studentAnswer: reviewInput.studentAnswer, scorePlan, variant: 'judge' }),
    providerId,
    userContent: () => createReferenceAnswerUserContent(reviewInput),
    user() {
      return [
        buildReferenceAnswerPrompt({ normalizedProblem, studentWorkText: reviewInput.studentWorkText, studentAnswer: reviewInput.studentAnswer, scorePlan, variant: 'judge' }).user(),
        `候選答案 A: ${JSON.stringify(answerA)}`,
        `候選答案 B: ${JSON.stringify(answerB)}`
      ].join('\n\n')
    }
  }

  const judged = await runStructuredStage({
    stageKey: 'reference_answer_judge',
    emit,
    request: createStructuredRequester(judgeSolutions),
    mainPrompt: judgePrompt,
    buildRepairPrompt: options => ({ ...buildReviewRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 2400 }),
    validator: data => ({
      referenceAnswer: String(data?.referenceAnswer || '').trim(),
      referenceReasoning: String(data?.referenceReasoning || '').trim()
    }),
    repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
    failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
    modelCall: createModelCallConfig({
      scope: 'question_review',
      callRole: 'reference_answer_judge',
      providerId,
      stageKey: 'reference_answer_judge',
      schedulerOptions
    })
  })

  if (isReferenceAnswerCorrupted(judged)) {
    throw createReviewFailure('參考答案裁決階段輸出了題目/學生作答整理，而非真正標準答案', 'reference_answer_corrupted')
  }
  emit(createEvent(SESSION_EVENT_TYPES.REFERENCE_ANSWER_DONE, judged))
  return judged
}

async function runStudentJudgementStage({ providerId, emit, normalizedProblem, reviewInput, scorePlan, referenceAnswer, schedulerOptions = null }) {
  emit(createEvent(SESSION_EVENT_TYPES.STUDENT_JUDGEMENT_STARTED, {}))
  const judgement = await runStructuredStage({
    stageKey: 'student_judgement',
    emit,
    request: createStructuredRequester(judgeSolutions, delta => {
      emit(createEvent(SESSION_EVENT_TYPES.STUDENT_JUDGEMENT_DELTA, { delta }))
    }),
    mainPrompt: {
      ...buildStudentJudgementPrompt({
        normalizedProblem,
        studentWorkText: reviewInput.studentWorkText,
        studentAnswer: reviewInput.studentAnswer,
        scorePlan,
        referenceAnswer: referenceAnswer.referenceAnswer,
        referenceReasoning: referenceAnswer.referenceReasoning
      }),
      providerId,
      userContent: () => createReviewUserContent({
        problem: reviewInput.problem,
        studentWork: reviewInput.studentWork,
        studentAnswer: reviewInput.studentAnswer
      })
    },
    buildRepairPrompt: options => ({ ...buildReviewRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 2600 }),
    validator: data => ({
      answerVerdict: String(data?.answerVerdict || '').trim(),
      methodVerdict: String(data?.methodVerdict || '').trim(),
      whyWrong: String(data?.whyWrong || '').trim(),
      suggestedNextStep: String(data?.suggestedNextStep || '').trim(),
      referenceAnswer: String(data?.referenceAnswer || referenceAnswer.referenceAnswer || '').trim(),
      referenceReasoning: String(data?.referenceReasoning || referenceAnswer.referenceReasoning || '').trim(),
      scoreJudgement: String(data?.scoreJudgement || '').trim(),
      markingNotes: Array.isArray(data?.markingNotes) ? data.markingNotes.map(item => String(item || '').trim()).filter(Boolean) : []
    }),
    repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
    failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
    modelCall: createModelCallConfig({
      scope: 'question_review',
      callRole: 'student_judgement',
      providerId,
      stageKey: 'student_judgement',
      schedulerOptions
    })
  })
  emit(createEvent(SESSION_EVENT_TYPES.STUDENT_JUDGEMENT_DONE, judgement))
  if (isSemanticallyEmptyJudgement(judgement)) {
    const repairJudgement = {
      ...judgement,
      answerVerdict: 'unable_to_confirm',
      methodVerdict: 'unable_to_confirm',
      whyWrong: '模型未能從現有圖片輸出可用裁決，暫不能確認學生答案或方法是否正確。',
      suggestedNextStep: '請重新檢查此題圖片，並只根據可見作答補回批改結論。',
      scoreJudgement: '目前只能保守判為證據不足，需重新審視題目與學生作答圖片。'
    }
    emit(createEvent(SESSION_EVENT_TYPES.STUDENT_JUDGEMENT_DONE, repairJudgement))
    return repairJudgement
  }
  return judgement
}

async function runScoreJsStage({ providerId, emit, normalizedProblem, reviewInput, scorePlan, referenceAnswer, judgement, schedulerOptions = null }) {
  emit(createEvent(SESSION_EVENT_TYPES.SCORE_JS_STARTED, {}))
  const reviewResult = await runStructuredStage({
    stageKey: 'score_js',
    emit,
    request: createStructuredRequester(judgeSolutions, delta => {
      emit(createEvent(SESSION_EVENT_TYPES.SCORE_JS_DELTA, { delta }))
    }),
    mainPrompt: {
      ...buildScoreJsPrompt({
        normalizedProblem,
        studentWorkText: reviewInput.studentWorkText,
        studentAnswer: reviewInput.studentAnswer,
        scorePlan,
        referenceAnswer: referenceAnswer.referenceAnswer,
        referenceReasoning: referenceAnswer.referenceReasoning,
        judgement
      }),
      providerId,
      userContent: () => createReviewUserContent({
        problem: reviewInput.problem,
        studentWork: reviewInput.studentWork,
        studentAnswer: reviewInput.studentAnswer
      })
    },
    buildRepairPrompt: options => ({ ...buildReviewRepairPrompt(options), providerId, stream: false, maxCompletionTokens: 2800 }),
    validator: validateReviewResult,
    repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
    failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
    modelCall: createModelCallConfig({
      scope: 'question_review',
      callRole: 'score_js',
      providerId,
      stageKey: 'score_js',
      schedulerOptions
    })
  })
  emit(createEvent(SESSION_EVENT_TYPES.SCORE_JS_DONE, reviewResult))
  if (isSemanticallyEmptyScoreResult(reviewResult)) {
    const normalizedMaxMarks = Number(scorePlan?.totalMarks) > 0 ? Number(scorePlan.totalMarks) : Number(reviewResult?.maxTotalMarks) || 0
    const repairResult = validateReviewResult({
      ...reviewResult,
      isCorrect: false,
      answerVerdict: 'unable_to_confirm',
      methodVerdict: 'unable_to_confirm',
      whyWrong: '模型未能輸出足夠的最終評分說明，暫按保守原則標記為待人工覆核。',
      suggestedNextStep: '請重新檢查學生作答圖片與此題配分，補回可追溯的評分依據。',
      referenceAnswer: String(reviewResult?.referenceAnswer || referenceAnswer.referenceAnswer || '').trim(),
      referenceReasoning: String(reviewResult?.referenceReasoning || referenceAnswer.referenceReasoning || '').trim(),
      scoreJudgement: '目前只能確認此題需要人工覆核，暫不接受空白裁決作為正常完成結果。',
      markingNotes: Array.isArray(reviewResult?.markingNotes) ? reviewResult.markingNotes : ['待人工覆核'],
      scoreBreakdown: [{
        label: '整題',
        awardedMarks: 0,
        maxMarks: normalizedMaxMarks,
        comment: '模型未提供可用評分內容，暫列待人工覆核。'
      }],
      awardedTotalMarks: 0,
      maxTotalMarks: normalizedMaxMarks
    })
    emit(createEvent(SESSION_EVENT_TYPES.SCORE_JS_DONE, repairResult))
    return repairResult
  }
  return reviewResult
}

async function runReviewFlowInternal({ sessionId, input, providerId, emit, schedulerOptions = null }) {
  emit(createEvent(SESSION_EVENT_TYPES.REVIEW_STARTED, { mode: input.mode || 'hard' }))

  const { reviewInput, normalizedProblem, scorePlan } = await createSharedReviewPreparation({ input, providerId, emit })
  const referenceAnswer = await runReferenceAnswerStage({ mode: input.mode, providerId, emit, normalizedProblem, reviewInput, scorePlan, schedulerOptions })
  const judgement = await runStudentJudgementStage({ providerId, emit, normalizedProblem, reviewInput, scorePlan, referenceAnswer, schedulerOptions })
  const reviewResult = await runScoreJsStage({ providerId, emit, normalizedProblem, reviewInput, scorePlan, referenceAnswer, judgement, schedulerOptions })
  return finalizeReviewSession({ sessionId, providerId, input, reviewInput, normalizedProblem, scorePlan, reviewResult, emit, referenceAnswer, judgement })
}

function createPaperStageError({ paperId, questionId = '', stage, errorType, message, retryable = false, attempt = 1 }) {
  const error = new Error(message)
  error.paperId = paperId
  error.questionId = questionId
  error.stage = stage
  error.errorType = errorType
  error.retryable = retryable
  error.attempt = attempt
  return error
}

function createAcceptedPaperSession({ sessionId, providerId, pdfPath }) {
  return {
    sessionId,
    flowType: 'paper-review',
    providerId,
    pdfPath,
    renderedPdf: null,
    paperIndex: null,
    questions: [],
    questionResults: [],
    report: '',
    reportPending: true,
    status: 'accepted'
  }
}

function createPendingPaperQuestion(question, index) {
  return {
    questionId: `question_${index + 1}`,
    questionNumber: question.questionNumber,
    pageRange: question.pageRange || [],
    pages: [],
    confidence: question.confidence || 'medium',
    visibleMarks: question.visibleMarks || '',
    regionHint: question.regionHint || '',
    mode: shouldRunExpensiveReviewFlow(question) ? 'hard' : 'simple',
    topicTags: Array.isArray(question.topicTags)
      ? question.topicTags.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
      : [],
    routingReasoning: shouldRunExpensiveReviewFlow(question) ? '高難題：參考答案雙算驗證' : '標準圖片批改流程',
    status: 'pending',
    awardedTotalMarks: 0,
    maxTotalMarks: 0,
    scorePlan: null,
    scoreBreakdown: [],
    answerVerdict: '',
    methodVerdict: '',
    whyWrong: '',
    suggestedNextStep: '',
    error: null
  }
}

function createPendingPaperQuestionResult(question) {
  const pendingReviewInput = question?.reviewInput || null
  const pendingReviewPages = Array.isArray(pendingReviewInput?.problem?.pages)
    ? pendingReviewInput.problem.pages
    : (question.pages || [])

  return {
    questionId: question.questionId,
    questionNumber: question.questionNumber,
    pageRange: question.pageRange,
    pages: pendingReviewPages,
    confidence: question.confidence,
    visibleMarks: question.visibleMarks,
    regionHint: question.regionHint,
    mode: question.mode,
    topicTags: question.topicTags || [],
    routingReasoning: question.routingReasoning || '',
    status: 'pending',
    awardedTotalMarks: 0,
    maxTotalMarks: 0,
    scorePlan: null,
    scoreBreakdown: [],
    answerVerdict: '',
    methodVerdict: '',
    whyWrong: '',
    suggestedNextStep: '',
    error: null
  }
}

function markPaperQuestionRunning(sessionId, question, phase = 'question_review') {
  const runningReviewInput = question?.reviewInput || null
  const runningReviewPages = Array.isArray(runningReviewInput?.problem?.pages)
    ? runningReviewInput.problem.pages
    : (question.pages || [])

  return upsertPaperQuestionResult(sessionId, {
    questionId: question.questionId,
    questionNumber: question.questionNumber,
    pageRange: question.pageRange,
    pages: runningReviewPages,
    confidence: question.confidence,
    visibleMarks: question.visibleMarks,
    regionHint: question.regionHint,
    mode: question.mode,
    topicTags: question.topicTags || [],
    routingReasoning: question.routingReasoning || '',
    status: 'running',
    awardedTotalMarks: 0,
    maxTotalMarks: 0,
    scorePlan: null,
    scoreBreakdown: [],
    answerVerdict: '',
    methodVerdict: '',
    whyWrong: '',
    suggestedNextStep: '',
    error: null,
    activePhase: phase
  })
}

function createPendingQuickPaperSession({ sessionId, providerId, pdfPath, paperIndex }) {
  const questions = (paperIndex.questions || []).map(createPendingPaperQuestion)
    .sort((left, right) => Number(left.questionNumber || 0) - Number(right.questionNumber || 0))
  return {
    sessionId,
    flowType: 'paper-review',
    providerId,
    pdfPath,
    renderedPdf: null,
    paperIndex,
    questions,
    questionResults: questions,
    report: '',
    reportPending: true
  }
}

async function createQuestionPackages({ paperIndex, renderedPdf, existingQuestions = [] }) {
  const packages = []
  const existingQuestionMap = new Map((Array.isArray(existingQuestions) ? existingQuestions : []).map(item => [String(item.questionNumber), item]))

  for (const [index, question] of (paperIndex.questions || []).entries()) {
    const selectedPages = []

    for (const pageNumber of (question.pageRange || [])) {
      const page = renderedPdf.pages.find(item => item.pageNumber === pageNumber)
      if (!page) continue
      selectedPages.push(page)
    }

    const normalizedQuestionText = typeof question.normalizedQuestionText === 'string' ? question.normalizedQuestionText.trim() : ''
    const topicTags = Array.isArray(question.topicTags)
      ? question.topicTags.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
      : []

    const existingQuestion = existingQuestionMap.get(String(question.questionNumber))

    packages.push({
      questionId: existingQuestion?.questionId || `question_${index + 1}`,
      questionNumber: question.questionNumber,
      pageRange: question.pageRange || [],
      visibleMarks: question.visibleMarks || '',
      regionHint: question.regionHint || '',
      confidence: question.confidence || 'medium',
      samePageMultiQuestion: Boolean(question.samePageMultiQuestion),
      crossPage: Boolean(question.crossPage),
      pages: selectedPages,
      normalizedQuestionText,
      topicTags,
      mode: existingQuestion?.mode || (shouldRunExpensiveReviewFlow(question) ? 'hard' : 'simple'),
      routingReasoning: existingQuestion?.routingReasoning || (shouldRunExpensiveReviewFlow(question) ? '高難題：參考答案雙算驗證' : '標準圖片批改流程')
    })
  }

  return packages
}

function createQuestionGroups(questions) {
  const groups = []
  const used = new Set()
  const normalizeHint = hint => String(hint || '').trim().toLowerCase()
  const isTopHint = hint => /top|upper/.test(normalizeHint(hint))
  const isBottomHint = hint => /bottom|lower/.test(normalizeHint(hint))

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index]
    if (!question || used.has(question.questionId)) continue

    const nextQuestion = questions[index + 1]
    const currentNumber = Number(question.questionNumber)
    const nextNumber = Number(nextQuestion?.questionNumber)
    const questionPageStart = Number(question.pageRange?.[0])
    const questionPageEnd = Number(question.pageRange?.[question.pageRange.length - 1])
    const nextPageStart = Number(nextQuestion?.pageRange?.[0])
    const nextPageEnd = Number(nextQuestion?.pageRange?.[nextQuestion.pageRange.length - 1])
    const currentIsSinglePage = Array.isArray(question.pageRange)
      && question.pageRange.length === 2
      && questionPageStart === questionPageEnd
    const nextStartsOnSamePage = Array.isArray(nextQuestion?.pageRange)
      && nextQuestion.pageRange.length === 2
      && questionPageStart === nextPageStart
    const compatiblePageOverlap = currentIsSinglePage
      && nextStartsOnSamePage
      && Number.isFinite(questionPageStart)
    const compatibleRegionPair = ((isTopHint(question.regionHint) && isBottomHint(nextQuestion?.regionHint))
      || (isBottomHint(question.regionHint) && isTopHint(nextQuestion?.regionHint)))

    const canPair = nextQuestion
      && !used.has(nextQuestion.questionId)
      && question.samePageMultiQuestion
      && nextQuestion.samePageMultiQuestion
      && compatiblePageOverlap
      && Number.isFinite(currentNumber)
      && Number.isFinite(nextNumber)
      && nextNumber === currentNumber + 1
      && compatibleRegionPair

    if (canPair) {
      used.add(question.questionId)
      used.add(nextQuestion.questionId)
      const groupPageRange = [
        Math.min(questionPageStart, nextPageStart),
        Math.max(questionPageEnd, nextPageEnd)
      ]
      const groupPages = [...new Map([...question.pages, ...nextQuestion.pages].map(page => [page.pageNumber, page])).values()]
        .sort((left, right) => left.pageNumber - right.pageNumber)
      groups.push({
        groupId: `group_${groups.length + 1}`,
        groupType: 'same_page_pair',
        pageRange: groupPageRange,
        pages: groupPages,
        questions: [question, nextQuestion]
      })
      continue
    }

    used.add(question.questionId)
    groups.push({
      groupId: `group_${groups.length + 1}`,
      groupType: 'single',
      pageRange: question.pageRange || [],
      pages: question.pages || [],
      questions: [question]
    })
  }

  return groups
}

function shouldRunExpensiveReviewFlow(question) {
  if (!question) return false
  if (question.mode !== 'hard') return false
  if (question.crossPage) return true
  const pageCount = Array.isArray(question.pages) ? question.pages.length : 0
  if (pageCount > 1) return true
  const topicCount = Array.isArray(question.topicTags) ? question.topicTags.filter(Boolean).length : 0
  const problemText = String(question.normalizedQuestionText || '').trim()
  const visibleMarks = String(question.visibleMarks || '').trim()
  return topicCount >= 4 || problemText.length >= 120 || !visibleMarks
}

function createReviewPagePayload(page) {
  if (!page) return null
  const reviewImageBase64 = typeof page.reviewImageBase64 === 'string' && page.reviewImageBase64
    ? page.reviewImageBase64
    : ''
  const imageBase64 = reviewImageBase64 || page.imageBase64
  return {
    ...page,
    imageBase64,
    reviewImageBase64,
    selectedImageKind: reviewImageBase64 ? 'review' : 'default',
    selectedRenderWidth: reviewImageBase64 ? page.reviewRenderWidth : page.renderWidth,
    selectedRenderHeight: reviewImageBase64 ? page.reviewRenderHeight : page.renderHeight,
    selectedRenderMode: reviewImageBase64 ? (page.reviewRenderMode || page.renderMode) : page.renderMode
  }
}

async function createFocusedReviewPages(question) {
  const uniqueBasePages = Array.isArray(question.pages)
    ? Array.from(new Map(question.pages.map(page => [String(page?.pageNumber || '') || `${page?.imagePath || ''}:${page?.reviewImagePath || ''}`, page])).values())
    : []
  const needsCrop = question.samePageMultiQuestion && (question.regionHint === 'upper' || question.regionHint === 'lower')

  if (!needsCrop || uniqueBasePages.length === 0) {
    return uniqueBasePages.map(page => ({
      ...createReviewPagePayload(page),
      cropApplied: false,
      cropFallback: false,
      cropRegionHint: question.regionHint || ''
    })).filter(Boolean)
  }

  const primaryPage = uniqueBasePages[0]
  if (!primaryPage) return []

  const imagePath = primaryPage.reviewImagePath || primaryPage.imagePath
  if (!imagePath) {
    return [{
      ...createReviewPagePayload(primaryPage),
      cropApplied: false,
      cropFallback: true,
      cropRegionHint: question.regionHint
    }].filter(Boolean)
  }

  try {
    const cropped = await cropPageImage({
      imagePath,
      regionHint: question.regionHint,
      pageNumber: primaryPage.pageNumber
    })
    if (!cropped?.imageBase64) {
      return [{
        ...createReviewPagePayload(primaryPage),
        cropApplied: false,
        cropFallback: true,
        cropRegionHint: question.regionHint
      }].filter(Boolean)
    }

    return [{
      ...createReviewPagePayload(primaryPage),
      imageBase64: cropped.imageBase64,
      reviewImageBase64: cropped.imageBase64,
      mediaType: cropped.mediaType || primaryPage.mediaType || 'image/png',
      selectedImageKind: 'cropped',
      cropRegionHint: question.regionHint,
      cropApplied: true,
      cropFallback: false
    }]
  } catch {
    return [{
      ...createReviewPagePayload(primaryPage),
      cropApplied: false,
      cropFallback: true,
      cropRegionHint: question.regionHint
    }].filter(Boolean)
  }
}

async function createQuestionReviewInput(question) {
  const reviewPages = await createFocusedReviewPages(question)
  const pageSummary = reviewPages.length > 0
    ? reviewPages.map(page => `第 ${page.pageNumber} 頁`).join('；')
    : ''
  const fallbackReviewInput = createFallbackReviewInputFromQuestion(question)
  const problemText = question.normalizedQuestionText || [
    fallbackReviewInput.problemText,
    `你只需要處理第 ${question.questionNumber} 題。`,
    question.samePageMultiQuestion ? '同頁可能還有其他題目，請明確忽略與本題無關的題幹、作答、分數與圖形。' : '',
    question.regionHint ? `定位提示：本題大致位於 ${question.regionHint}。這只是輔助定位，不能把其他題目內容混入本題。` : '',
    pageSummary ? `相關頁面：${pageSummary}。` : '',
    '你必須直接查看題目圖片與學生作答圖片，不可只依賴文字摘要。'
  ].filter(Boolean).join('\n')

  const firstPage = reviewPages[0] || null
  const primaryImageBase64 = firstPage?.imageBase64 || ''
  const combinedMediaType = firstPage?.mediaType || 'image/png'

  return {
    problem: {
      type: 'image',
      text: problemText,
      imageBase64: primaryImageBase64,
      mediaType: combinedMediaType,
      pages: reviewPages,
      questionNumber: question.questionNumber,
      visibleMarks: question.visibleMarks,
      regionHint: question.regionHint,
      samePageMultiQuestion: question.samePageMultiQuestion
    },
    studentWork: {
      type: 'image',
      text: [
        fallbackReviewInput.studentWorkText,
        `這是第 ${question.questionNumber} 題的學生作答頁面，請只評估此題相關內容。`,
        question.samePageMultiQuestion ? '若同頁有其他題目或其他作答，全部忽略，只看第指定題號對應的學生作答。' : '',
        question.regionHint ? `定位提示：${question.regionHint}。` : '',
        pageSummary,
        '你必須直接查看學生作答圖片，不可只依賴文字摘要。'
      ].filter(Boolean).join('\n'),
      imageBase64: primaryImageBase64,
      mediaType: combinedMediaType,
      pages: reviewPages,
      questionNumber: question.questionNumber,
      visibleMarks: question.visibleMarks,
      regionHint: question.regionHint,
      samePageMultiQuestion: question.samePageMultiQuestion
    },
    studentAnswer: {
      provided: false,
      type: 'text',
      text: ''
    },
    mode: shouldRunExpensiveReviewFlow(question) ? 'hard' : 'simple'
  }
}

function attachQuestionReviewInput(question, reviewInput) {
  return {
    ...question,
    reviewInput,
    pages: Array.isArray(reviewInput?.problem?.pages) && reviewInput.problem.pages.length > 0
      ? reviewInput.problem.pages
      : (question.pages || [])
  }
}

function normalizeFinalMarks({ reviewResult = {}, scorePlan = null }) {
  const rawBreakdown = Array.isArray(reviewResult?.scoreBreakdown) ? reviewResult.scoreBreakdown : []
  let breakdown = rawBreakdown.map((item, index) => ({
    label: String(item?.label || (index === 0 ? '整題' : `part_${index + 1}`)).trim() || (index === 0 ? '整題' : `part_${index + 1}`),
    awardedMarks: Number(item?.awardedMarks) || 0,
    maxMarks: Number(item?.maxMarks) || 0,
    comment: String(item?.comment || '').trim()
  }))
  const breakdownAwarded = breakdown.reduce((sum, item) => sum + (Number(item?.awardedMarks) || 0), 0)
  const breakdownMax = breakdown.reduce((sum, item) => sum + (Number(item?.maxMarks) || 0), 0)

  let awardedTotalMarks = Number.isFinite(Number(reviewResult?.awardedTotalMarks))
    ? Number(reviewResult.awardedTotalMarks)
    : breakdownAwarded
  let maxTotalMarks = Number.isFinite(Number(reviewResult?.maxTotalMarks))
    ? Number(reviewResult.maxTotalMarks)
    : breakdownMax

  if (awardedTotalMarks === 0 && breakdownAwarded > 0) {
    awardedTotalMarks = breakdownAwarded
  }

  if (maxTotalMarks === 0) {
    if (breakdownMax > 0) maxTotalMarks = breakdownMax
    else if (Number(scorePlan?.totalMarks) > 0) maxTotalMarks = Number(scorePlan.totalMarks)
  }

  if (Number(scorePlan?.totalMarks) > 0 && maxTotalMarks < Number(scorePlan.totalMarks)) {
    maxTotalMarks = Number(scorePlan.totalMarks)
  }

  const answerVerdict = String(reviewResult?.answerVerdict || '').trim().toLowerCase()
  const methodVerdict = String(reviewResult?.methodVerdict || '').trim().toLowerCase()
  const suggestsSomeCredit = [
    answerVerdict === 'correct',
    methodVerdict === 'correct',
    /partially|minor|mostly|generally/.test(answerVerdict),
    /partially|minor|mostly|generally/.test(methodVerdict)
  ].some(Boolean)

  if (breakdown.length === 0 || breakdown.every(item => Number(item.maxMarks || 0) === 0)) {
    breakdown = [{
      label: '整題',
      awardedMarks: awardedTotalMarks,
      maxMarks: maxTotalMarks,
      comment: String(rawBreakdown[0]?.comment || '').trim()
    }]
  } else if (maxTotalMarks > 0 && breakdownMax === 0) {
    breakdown = breakdown.map((item, index) => index === 0
      ? {
          ...item,
          awardedMarks: awardedTotalMarks,
          maxMarks: maxTotalMarks
        }
      : item)
  }

  if (maxTotalMarks > 0 && awardedTotalMarks === 0 && suggestsSomeCredit && breakdown.some(item => Number(item.maxMarks || 0) > 0)) {
    const positiveAwarded = breakdown.reduce((sum, item) => sum + Math.max(0, Number(item.awardedMarks) || 0), 0)
    if (positiveAwarded > 0) {
      awardedTotalMarks = positiveAwarded
    }
  }

  return {
    awardedTotalMarks,
    maxTotalMarks,
    scoreBreakdown: breakdown
  }
}

function projectPaperQuestionResult({ question, session, stageError = null }) {
  if (stageError) {
    return enrichQuestionResultFromSession({
      questionId: question.questionId,
      questionNumber: question.questionNumber,
      pageRange: question.pageRange,
      pages: question.pages || [],
      confidence: question.confidence,
      visibleMarks: question.visibleMarks,
      regionHint: question.regionHint,
      mode: question.mode,
      topicTags: question.topicTags || [],
      routingReasoning: question.routingReasoning || '',
      status: 'failed',
      awardedTotalMarks: 0,
      maxTotalMarks: 0,
      scorePlan: null,
      scoreBreakdown: [],
      answerVerdict: '',
      methodVerdict: '',
      whyWrong: '',
      suggestedNextStep: '',
      error: {
        stage: stageError.stage,
        errorType: stageError.errorType,
        message: stageError.message,
        retryable: stageError.retryable,
        attempt: stageError.attempt
      }
    }, session, stageError)
  }

  const reviewResult = session?.reviewResult || {}
  const scorePlan = session?.scorePlan || null
  const normalizedMarks = normalizeFinalMarks({ reviewResult, scorePlan })
  return enrichQuestionResultFromSession({
    questionId: question.questionId,
    questionNumber: question.questionNumber,
    pageRange: question.pageRange,
    pages: question.pages || [],
    confidence: question.confidence,
    visibleMarks: question.visibleMarks,
    regionHint: question.regionHint,
    mode: question.mode,
    topicTags: question.topicTags || [],
    routingReasoning: question.routingReasoning || '',
    status: 'completed',
    awardedTotalMarks: normalizedMarks.awardedTotalMarks,
    maxTotalMarks: normalizedMarks.maxTotalMarks,
    scorePlan,
    scoreBreakdown: normalizedMarks.scoreBreakdown,
    answerVerdict: reviewResult.answerVerdict || '',
    methodVerdict: reviewResult.methodVerdict || '',
    whyWrong: reviewResult.whyWrong || '',
    suggestedNextStep: reviewResult.suggestedNextStep || '',
    error: null
  }, session)
}

function shouldAdoptRecheckResult(firstResult, secondResult) {
  if (!secondResult || secondResult.status !== 'completed') return false
  if (Number(secondResult.awardedTotalMarks || 0) > Number(firstResult?.awardedTotalMarks || 0)) return true

  const firstAnswerVerdict = String(firstResult?.answerVerdict || '').trim().toLowerCase()
  const secondAnswerVerdict = String(secondResult?.answerVerdict || '').trim().toLowerCase()
  const firstMethodVerdict = String(firstResult?.methodVerdict || '').trim().toLowerCase()
  const secondMethodVerdict = String(secondResult?.methodVerdict || '').trim().toLowerCase()

  return Number(secondResult.maxTotalMarks || 0) > 0
    && Number(secondResult.awardedTotalMarks || 0) === 0
    && (
      secondAnswerVerdict === 'correct'
      || secondMethodVerdict === 'correct'
      || /partially|minor|mostly|generally/.test(secondAnswerVerdict)
      || /partially|minor|mostly|generally/.test(secondMethodVerdict)
    )
    && secondAnswerVerdict !== firstAnswerVerdict
}

function mergePaperQuestionResults(currentResults, nextResults) {
  const merged = new Map()

  for (const item of Array.isArray(currentResults) ? currentResults : []) {
    if (!item?.questionId) continue
    merged.set(item.questionId, item)
  }

  for (const item of Array.isArray(nextResults) ? nextResults : []) {
    if (!item?.questionId) continue
    const previous = merged.get(item.questionId)
    merged.set(item.questionId, previous ? { ...previous, ...item } : item)
  }

  return Array.from(merged.values())
    .sort((left, right) => Number(left.questionNumber || 0) - Number(right.questionNumber || 0))
}

function upsertPaperQuestionResult(sessionId, questionResult, overrides = {}) {
  const currentSession = getSession(sessionId)
  if (!currentSession) return null

  const currentResults = Array.isArray(currentSession.questionResults) ? currentSession.questionResults : []
  const nextSession = {
    ...currentSession,
    ...overrides,
    questionResults: mergePaperQuestionResults(currentResults, [questionResult])
  }

  setSession(sessionId, nextSession)
  return nextSession
}

async function reviewQuestionPackage({ paperSessionId, question, providerId, emit }) {
  const schedulerOptions = createQuestionSchedulerOptions(question)
  const questionSessionId = `${paperSessionId}:${question.questionId}`
  const input = await createQuestionReviewInput(question)
  const preparedQuestion = attachQuestionReviewInput(question, input)

  emit(createEvent(SESSION_EVENT_TYPES.PAPER_QUESTION_REVIEW_STARTED, {
    questionId: question.questionId,
    questionNumber: question.questionNumber,
    mode: question.mode
  }))
  markPaperQuestionRunning(paperSessionId, preparedQuestion, 'question_review')

  try {
    const reviewSession = await runReviewFlowInternal({
      sessionId: questionSessionId,
      input,
      providerId,
      schedulerOptions,
      emit: event => emit(createEvent(event.type, {
        ...event.payload,
        paperSessionId,
        questionId: question.questionId,
        questionNumber: question.questionNumber
      }))
    })

    const result = projectPaperQuestionResult({ question: preparedQuestion, session: reviewSession })

    emit(createEvent(SESSION_EVENT_TYPES.PAPER_QUESTION_REVIEW_DONE, {
      questionId: question.questionId,
      questionNumber: question.questionNumber,
      awardedTotalMarks: result.awardedTotalMarks,
      maxTotalMarks: result.maxTotalMarks,
      mode: question.mode,
      scorePlan: result.scorePlan,
      scoreBreakdown: result.scoreBreakdown,
      pages: result.pages,
      answerVerdict: result.answerVerdict,
      methodVerdict: result.methodVerdict,
      whyWrong: result.whyWrong,
      suggestedNextStep: result.suggestedNextStep,
      referenceAnswer: reviewSession?.referenceAnswerResult?.referenceAnswer || '',
      referenceReasoning: reviewSession?.referenceAnswerResult?.referenceReasoning || ''
    }))
    upsertPaperQuestionResult(paperSessionId, result)
    return result
  } catch (error) {
    const stageError = createPaperStageError({
      paperId: paperSessionId,
      questionId: question.questionId,
      stage: error?.stage || 'question_review',
      errorType: error?.errorType || 'question_review_failed',
      message: error instanceof Error ? error.message : '逐題批改失敗',
      retryable: Boolean(error?.retryable),
      attempt: Number.isFinite(error?.attempt) ? error.attempt : 1
    })

    throw { stageError, result: projectPaperQuestionResult({ question: preparedQuestion, stageError }) }
  }
}

function buildFallbackPaperReport(questionResults) {
  const completed = questionResults.filter(item => item.status === 'completed')
  const totalScore = completed.reduce((sum, item) => sum + (item.awardedTotalMarks || 0), 0)
  const maxScore = completed.reduce((sum, item) => sum + (item.maxTotalMarks || 0), 0)

  return {
    totalScore,
    maxScore,
    questionSummaries: questionResults.map(item => ({
      questionNumber: item.questionNumber,
      status: item.status === 'completed' ? 'completed' : 'failed',
      awardedMarks: item.awardedTotalMarks || 0,
      maxMarks: item.maxTotalMarks || 0,
      summary: item.status === 'completed'
        ? [item.answerVerdict, item.methodVerdict].filter(Boolean).join('；')
        : (item.error?.message || '該題批改失敗'),
      weakTopics: item.status === 'completed' ? (item.topicTags || []) : [],
      mistakeTypes: item.status === 'completed'
        ? [item.whyWrong, item.suggestedNextStep].filter(Boolean)
        : [item.error?.errorType || 'failed']
    })),
    weakTopics: [],
    overallComment: completed.length === questionResults.length
      ? '已完成整卷逐題批改。'
      : '部分題目批改失敗，總結已按可用結果保守生成。',
    mistakePatterns: [],
    recommendations: []
  }
}

async function synthesizePaperReport({ paperIndex, questionResults, providerId, emit }) {
  emit(createEvent(SESSION_EVENT_TYPES.PAPER_REPORT_STARTED, {
    questionCount: questionResults.length,
    completedCount: questionResults.filter(item => item.status === 'completed').length
  }))

  const prompt = buildPaperReportPrompt({ paperIndex, questionResults })
  prompt.providerId = providerId
  prompt.stream = true

  emit(createEvent(SESSION_EVENT_TYPES.MODEL_CALL_STARTED, {
    scope: 'paper_report',
    callRole: 'paper_reporter',
    stageKey: 'paper_report',
    providerId,
    questionId: '',
    questionNumber: '',
    questionNumbers: [],
    groupId: '',
    attemptLabel: 'initial',
    mode: 'stream'
  }))

  let reportText = ''

  try {
    const response = await requestModel({
      providerId,
      system: prompt.system,
      user: prompt.user?.(),
      stream: true,
      maxCompletionTokens: prompt.maxCompletionTokens,
      onDelta(delta) {
        reportText += delta
        emit(createEvent(SESSION_EVENT_TYPES.MODEL_CALL_DELTA, {
          scope: 'paper_report',
          callRole: 'paper_reporter',
          stageKey: 'paper_report',
          providerId,
          questionId: '',
          questionNumber: '',
          questionNumbers: [],
          groupId: '',
          attemptLabel: 'initial',
          delta,
          text: reportText
        }))
      }
    })

    const finalText = (reportText || response?.text || '').trim()
    reportText = finalText
    emit(createEvent(SESSION_EVENT_TYPES.MODEL_CALL_DONE, {
      scope: 'paper_report',
      callRole: 'paper_reporter',
      stageKey: 'paper_report',
      providerId,
      questionId: '',
      questionNumber: '',
      questionNumbers: [],
      groupId: '',
      attemptLabel: 'initial',
      text: reportText
    }))
  } catch (error) {
    emit(createEvent(SESSION_EVENT_TYPES.MODEL_CALL_FAILED, {
      scope: 'paper_report',
      callRole: 'paper_reporter',
      stageKey: 'paper_report',
      providerId,
      questionId: '',
      questionNumber: '',
      questionNumbers: [],
      groupId: '',
      attemptLabel: 'initial',
      message: error instanceof Error ? error.message : '整卷總報告生成失敗'
    }))
    throw error
  }

  if (!reportText) {
    reportText = questionResults.length > 0
      ? `本次整卷批改已完成，共處理 ${questionResults.length} 題。整體結果請先參考下方逐題分數卡與模型輸出。`
      : '本次整卷批改未取得可用總報告內容。'
  }

  return reportText
}

export async function runPaperReviewFlow({ sessionId, pdfPath, providerId, emit }) {
  emit(createEvent(SESSION_EVENT_TYPES.SESSION_STARTED, { sessionId, sourceType: 'paper-review', mode: 'paper' }))
  emit(createEvent(SESSION_EVENT_TYPES.INPUT_RECEIVED, { sourceType: 'paper-review', pdfPath }))
  return runPaperReviewFlowInternal({ sessionId, pdfPath, providerId, emit })
}

async function runPaperReviewFlowInternal({ sessionId, pdfPath, providerId, emit }) {
  const paperStartedAt = Date.now()
  const phaseTimings = []
  emit(createEvent(SESSION_EVENT_TYPES.PAPER_REVIEW_STARTED, { sessionId, pdfPath }))

  const paperIndexProviderId = 'api1'
  const paperIndexModelConfig = getModelConfig(paperIndexProviderId)
  const usePdfInputForPaperIndex = Boolean(paperIndexModelConfig?.supportsPdfInput)

  if (!usePdfInputForPaperIndex) {
    throw new Error(`目前 API「${paperIndexModelConfig?.label || paperIndexProviderId || 'unknown'}」不支援 PDF 直接閱讀，請切換 API 後再試。`)
  }

  emit(createEvent(SESSION_EVENT_TYPES.PAPER_INDEX_STARTED, {
    inputMode: 'pdf'
  }))

  const renderStartedAt = Date.now()
  const renderedPdfPromise = renderPdfToImages(pdfPath)
  const paperIndexSource = {
    sourceType: 'pdf',
    pdfPath,
    fileName: pdfPath.split('/').pop() || 'paper.pdf'
  }

  const paperIndexPrompt = buildPaperIndexPrompt({ source: paperIndexSource })
  paperIndexPrompt.providerId = paperIndexProviderId

  const paperIndexStartedAt = Date.now()
  const paperIndex = await runStructuredStage({
    stageKey: 'paper_index',
    emit,
    request: createStructuredRequester(judgeSolutions),
    mainPrompt: paperIndexPrompt,
    buildRepairPrompt: options => {
      const repairPrompt = buildPaperIndexRepairPrompt(options)
      repairPrompt.providerId = paperIndexProviderId
      return repairPrompt
    },
    validator: validatePaperIndexResult,
    repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
    failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED,
    modelCall: createModelCallConfig({
      scope: 'paper_index',
      callRole: 'paper_indexer',
      providerId: paperIndexProviderId,
      stageKey: 'paper_index'
    })
  })

  const pendingPaperSession = createPendingQuickPaperSession({
    sessionId,
    providerId,
    pdfPath,
    paperIndex
  })

  const acceptedSession = getSession(sessionId)
  setSession(sessionId, {
    ...createAcceptedPaperSession({ sessionId, providerId, pdfPath }),
    ...acceptedSession,
    ...pendingPaperSession,
    status: 'index_ready'
  })

  emit(createEvent(SESSION_EVENT_TYPES.PAPER_INDEX_DONE, paperIndex))
  phaseTimings.push(emitPaperPhaseTiming(emit, 'paper_index', paperIndexStartedAt, {
    questionCount: Array.isArray(paperIndex?.questions) ? paperIndex.questions.length : 0
  }))

  const renderedPdf = await renderedPdfPromise
  emit(createEvent(SESSION_EVENT_TYPES.PAPER_PDF_RENDERED, {
    pageCount: renderedPdf.pages.length,
    renderMode: renderedPdf?.render?.mode || '',
    renderWidth: renderedPdf?.render?.widthPoints ? Math.max(1, Math.round(renderedPdf.render.widthPoints * (renderedPdf.render.scaleFactor || 0))) : renderedPdf?.pages?.[0]?.renderWidth || null,
    renderHeight: renderedPdf?.render?.heightPoints ? Math.max(1, Math.round(renderedPdf.render.heightPoints * (renderedPdf.render.scaleFactor || 0))) : renderedPdf?.pages?.[0]?.renderHeight || null,
    renderScaleFactor: renderedPdf?.render?.scaleFactor || null,
    reviewRenderWidth: renderedPdf?.render?.reviewWidth || renderedPdf?.pages?.[0]?.reviewRenderWidth || null,
    reviewRenderHeight: renderedPdf?.render?.reviewHeight || renderedPdf?.pages?.[0]?.reviewRenderHeight || null,
    reviewScaleFactor: renderedPdf?.render?.reviewScaleFactor || null,
    reviewTargetDpi: renderedPdf?.render?.reviewTargetDpi || null
  }))
  phaseTimings.push(emitPaperPhaseTiming(emit, 'pdf_render', renderStartedAt, {
    pageCount: renderedPdf.pages.length,
    renderMode: renderedPdf?.render?.mode || ''
  }))

  const questions = await createQuestionPackages({
    paperIndex,
    renderedPdf,
    existingQuestions: pendingPaperSession.questions
  })
  const questionGroups = createQuestionGroups(questions)
  const groupedQuestions = questionGroups.flatMap(group => group.questions)

  emit(createEvent(SESSION_EVENT_TYPES.PAPER_GROUPS_BUILT, {
    groups: questionGroups.map(group => ({
      groupId: group.groupId,
      groupType: group.groupType,
      pageRange: group.pageRange,
      questionIds: group.questions.map(question => question.questionId),
      questionNumbers: group.questions.map(question => question.questionNumber),
      crossPage: group.questions.map(question => ({
        questionId: question.questionId,
        questionNumber: question.questionNumber,
        crossPage: Boolean(question.crossPage),
        samePageMultiQuestion: Boolean(question.samePageMultiQuestion),
        regionHint: question.regionHint || ''
      }))
    }))
  }))

  const initialResults = groupedQuestions.map(createPendingPaperQuestionResult)
  setSession(sessionId, {
    ...getSession(sessionId),
    renderedPdf,
    paperIndex,
    questions,
    questionResults: initialResults,
    report: '',
    reportPending: true
  })

  const reviewStartedAt = Date.now()

  for (const group of questionGroups) {
    emit(createEvent(SESSION_EVENT_TYPES.PAPER_QUESTION_GROUP_STARTED, {
      groupId: group.groupId,
      groupType: group.groupType,
      questionIds: group.questions.map(item => item.questionId),
      questionNumbers: group.questions.map(item => item.questionNumber)
    }))
  }

  const questionConcurrency = Math.min(6, Math.max(1, groupedQuestions.length))
  const results = await runWithConcurrency(groupedQuestions, questionConcurrency, async question => {
    emit(createEvent(SESSION_EVENT_TYPES.PAPER_QUESTION_STARTED, {
      questionId: question.questionId,
      questionNumber: question.questionNumber,
      pageRange: question.pageRange,
      confidence: question.confidence,
      mode: question.mode
    }))
    markPaperQuestionRunning(sessionId, question, 'queued')

    try {
      return await reviewQuestionPackage({
        paperSessionId: sessionId,
        question,
        providerId,
        emit
      })
    } catch (wrappedError) {
      const fallbackResult = wrappedError?.result && wrappedError.result.questionId === question.questionId
        ? wrappedError.result
        : projectPaperQuestionResult({
          question,
          stageError: wrappedError?.stageError || createPaperStageError({
            paperId: sessionId,
            questionId: question.questionId,
            stage: 'question_review',
            errorType: 'question_review_failed',
            message: wrappedError instanceof Error ? wrappedError.message : '逐題批改失敗',
            retryable: false,
            attempt: 1
          })
        })

      upsertPaperQuestionResult(sessionId, fallbackResult)
      emit(createEvent(SESSION_EVENT_TYPES.PAPER_QUESTION_FAILED, {
        questionId: question.questionId,
        questionNumber: question.questionNumber,
        stage: fallbackResult.error?.stage || wrappedError?.stageError?.stage || 'question_review',
        errorType: fallbackResult.error?.errorType || wrappedError?.stageError?.errorType || 'question_review_failed',
        message: fallbackResult.error?.message || wrappedError?.stageError?.message || (wrappedError instanceof Error ? wrappedError.message : '逐題批改失敗'),
        retryable: Boolean(fallbackResult.error?.retryable || wrappedError?.stageError?.retryable),
        attempt: Number.isFinite(fallbackResult.error?.attempt) ? fallbackResult.error.attempt : (Number.isFinite(wrappedError?.stageError?.attempt) ? wrappedError.stageError.attempt : 1)
      }))
      return fallbackResult
    }
  })

  for (const group of questionGroups) {
    emit(createEvent(SESSION_EVENT_TYPES.PAPER_QUESTION_GROUP_DONE, {
      groupId: group.groupId,
      groupType: group.groupType,
      questionIds: group.questions.map(item => item.questionId),
      questionNumbers: group.questions.map(item => item.questionNumber)
    }))
  }

  phaseTimings.push(emitPaperPhaseTiming(emit, 'question_pipeline', reviewStartedAt, {
    groupCount: questionGroups.length,
    resultCount: results.length,
    questionConcurrency
  }))

  results.sort((left, right) => Number(left.questionNumber || 0) - Number(right.questionNumber || 0))

  const quickReport = createQuickPaperReport(results)
  const paperSession = {
    sessionId,
    flowType: 'paper-review',
    providerId,
    pdfPath,
    renderedPdf,
    paperIndex,
    questions,
    questionResults: results,
    report: quickReport,
    reportPending: true
  }

  setSession(sessionId, paperSession)
  emit(createEvent(SESSION_EVENT_TYPES.PAPER_REPORT_DONE, {
    text: quickReport,
    pending: true
  }))

  const reportStartedAt = Date.now()
  const report = await synthesizePaperReport({
    paperIndex,
    questionResults: results,
    providerId,
    emit
  })
  phaseTimings.push(emitPaperPhaseTiming(emit, 'paper_report', reportStartedAt, {
    textLength: String(report || '').length
  }))

  const completedPaperSession = {
    ...paperSession,
    report,
    reportPending: false
  }

  setSession(sessionId, completedPaperSession)
  emit(createEvent(SESSION_EVENT_TYPES.PAPER_REPORT_DONE, {
    text: report,
    pending: false
  }))
  const totalTiming = emitPaperPhaseTiming(emit, 'paper_total', paperStartedAt, {
    questionCount: results.length
  })
  phaseTimings.push(totalTiming)

  const finalSessionWithTimings = {
    ...completedPaperSession,
    phaseTimings,
    groupTimings: []
  }

  setSession(sessionId, finalSessionWithTimings)
  return finalSessionWithTimings
}

async function runReviewFinalExplanationFlow({ session, emit }) {
  emit(createEvent(SESSION_EVENT_TYPES.FINAL_EXPLANATION_STARTED, { mode: 'stream' }))

  const prompt = buildReviewFinalExplanationPrompt({
    normalizedProblem: session.normalizedProblem,
    reviewResult: session.reviewResult,
    studentWorkText: session.studentWorkText,
    studentAnswer: session.studentAnswer,
    diagramPlan: session.diagramPlan,
    hasDiagram: Boolean(session.diagramImage)
  })
  prompt.providerId = session.providerId
  prompt.stream = true
  prompt.maxCompletionTokens = 7000

  let finalExplanationText = ''
  let finalExplanationRawText = ''

  try {
    const response = await generateFinalExplanation(prompt, delta => {
      finalExplanationRawText += delta
      finalExplanationText += delta
      emit(createEvent(SESSION_EVENT_TYPES.FINAL_EXPLANATION_DELTA, {
        delta,
        rawText: finalExplanationRawText,
        text: normalizeExplanationText(finalExplanationText)
      }))
    })

    finalExplanationRawText = finalExplanationRawText || response.text || ''
    finalExplanationText = normalizeExplanationText(finalExplanationText || response.text)

    if (!finalExplanationText) {
      throw new Error('批改後講解為空')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '批改後講解生成失敗'
    emit(createEvent(SESSION_EVENT_TYPES.SESSION_ERROR, {
      message: `批改後講解生成失敗，已使用保底講解：${message}`
    }))
    finalExplanationText = createFallbackReviewExplanation(session)
  }

  const updatedSession = {
    ...session,
    finalExplanation: finalExplanationText
  }

  setSession(session.sessionId, updatedSession)
  emit(createEvent(SESSION_EVENT_TYPES.FINAL_EXPLANATION_DONE, {
    rawText: finalExplanationRawText,
    text: finalExplanationText
  }))

  return updatedSession
}

export async function runReviewFlow({ sessionId, input, providerId, emit }) {
  emit(createEvent(SESSION_EVENT_TYPES.SESSION_STARTED, { sessionId, sourceType: 'review', mode: input.mode || 'hard' }))
  emit(createEvent(SESSION_EVENT_TYPES.INPUT_RECEIVED, { sourceType: 'review', mode: input.mode || 'hard' }))
  return runReviewFlowInternal({ sessionId, input, providerId, emit })
}

export async function runReviewFollowupFlow({ session, question, emit }) {
  const projectedSession = projectReviewFollowupSession(session, question)
  const questionType = classifyReviewQuestion(question)

  emit(createEvent(SESSION_EVENT_TYPES.REVIEW_FOLLOWUP_STARTED, { question, questionType }))

  appendFollowupMessage(session.sessionId, {
    role: 'user',
    content: question
  })

  const prompt = buildReviewFollowupPrompt({ session: projectedSession, question })
  prompt.providerId = session.providerId
  prompt.stream = true
  prompt.maxCompletionTokens = 2200

  let answer = ''
  const response = await requestModel({
    providerId: prompt.providerId,
    system: prompt.system,
    user: prompt.user?.(),
    stream: true,
    maxCompletionTokens: prompt.maxCompletionTokens,
    onDelta(delta) {
      answer += delta
      emit(createEvent(SESSION_EVENT_TYPES.REVIEW_FOLLOWUP_DELTA, { delta, text: answer, questionType }))
    }
  })

  answer = (answer || response.text || '').trim()
  const updatedSession = appendFollowupMessage(session.sessionId, {
    role: 'assistant',
    content: answer
  }) || {
    ...projectedSession,
    followupMessages: [...projectedSession.followupMessages, { role: 'assistant', content: answer }].slice(-6)
  }

  const normalizedSession = {
    ...updatedSession,
    followupSummary: buildReviewFollowupSummary(updatedSession.followupMessages || [])
  }
  setSession(session.sessionId, normalizedSession)

  emit(createEvent(SESSION_EVENT_TYPES.REVIEW_FOLLOWUP_DONE, {
    answer,
    questionType,
    history: normalizedSession.followupMessages || [],
    summary: normalizedSession.followupSummary || ''
  }))
  return normalizedSession
}


async function runHardSolveFlow({ sessionId, input, providerId, emit }) {
  let { normalizedProblem, normalizedProblemPromise } = createNormalizationPromise({ input, providerId, emit })

  const solverABasePrompt = buildSolverPrompt({
    variant: 'A',
    sourceType: input.type,
    normalizedProblem,
    originalInput: input
  })
  const solverBBasePrompt = buildSolverPrompt({
    variant: 'B',
    sourceType: input.type,
    normalizedProblem,
    originalInput: input
  })
  solverABasePrompt.providerId = providerId
  solverBBasePrompt.providerId = providerId

  emit(createEvent(SESSION_EVENT_TYPES.SOLVER_A_STARTED, {}))
  emit(createEvent(SESSION_EVENT_TYPES.SOLVER_B_STARTED, {}))

  const [solverA, solverB, resolvedNormalizedProblem] = await Promise.all([
    runStructuredStage({
      stageKey: 'solver_a',
      emit,
      request: createStructuredRequester(solveProblem, delta => {
        emit(createEvent(SESSION_EVENT_TYPES.SOLVER_A_DELTA, { delta }))
      }),
      mainPrompt: solverABasePrompt,
      compactPrompt: {
        ...buildSolverPrompt({ variant: 'A', sourceType: input.type, normalizedProblem, originalInput: input, compact: true }),
        providerId,
        stream: true,
        maxCompletionTokens: 2600
      },
      buildRepairPrompt: options => {
        const repairPrompt = buildSolverRepairPrompt(options)
        repairPrompt.providerId = providerId
        repairPrompt.stream = false
        repairPrompt.maxCompletionTokens = options.compact ? 2600 : 3600
        return repairPrompt
      },
      validator: validateSolverResult,
      repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
      compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
      failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED
    }),
    runStructuredStage({
      stageKey: 'solver_b',
      emit,
      request: createStructuredRequester(solveProblem, delta => {
        emit(createEvent(SESSION_EVENT_TYPES.SOLVER_B_DELTA, { delta }))
      }),
      mainPrompt: solverBBasePrompt,
      compactPrompt: {
        ...buildSolverPrompt({ variant: 'B', sourceType: input.type, normalizedProblem, originalInput: input, compact: true }),
        providerId,
        stream: true,
        maxCompletionTokens: 2600
      },
      buildRepairPrompt: options => {
        const repairPrompt = buildSolverRepairPrompt(options)
        repairPrompt.providerId = providerId
        repairPrompt.stream = false
        repairPrompt.maxCompletionTokens = options.compact ? 2600 : 3600
        return repairPrompt
      },
      validator: validateSolverResult,
      repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
      compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
      failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED
    }),
    normalizedProblemPromise
  ])

  normalizedProblem = validateNormalizedProblem(resolvedNormalizedProblem)
  emit(createEvent(SESSION_EVENT_TYPES.PROBLEM_NORMALIZED, normalizedProblem))
  emit(createEvent(SESSION_EVENT_TYPES.SOLVER_A_DONE, solverA))
  emit(createEvent(SESSION_EVENT_TYPES.SOLVER_B_DONE, solverB))

  const judgePrompt = buildJudgePrompt({ normalizedProblem, solverA, solverB })
  judgePrompt.providerId = providerId
  emit(createEvent(SESSION_EVENT_TYPES.JUDGE_STARTED, {}))

  const judgeResult = await runStructuredStage({
    stageKey: 'judge',
    emit,
    request: createStructuredRequester(judgeSolutions, delta => {
      emit(createEvent(SESSION_EVENT_TYPES.JUDGE_DELTA, { delta }))
    }),
    mainPrompt: judgePrompt,
    compactPrompt: {
      ...buildJudgePrompt({ normalizedProblem, solverA, solverB, compact: true }),
      providerId,
      stream: true,
      maxCompletionTokens: 2600
    },
    buildRepairPrompt: options => {
      const repairPrompt = buildJudgeRepairPrompt(options)
      repairPrompt.providerId = providerId
      repairPrompt.stream = false
      repairPrompt.maxCompletionTokens = options.compact ? 2600 : 3600
      return repairPrompt
    },
    validator: validateJudgeResult,
    repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
    compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
    failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED
  })

  return finalizeSolveSession({
    sessionId,
    providerId,
    input,
    normalizedProblem,
    judgeResult,
    solverA,
    solverB,
    emit
  })
}

async function runSimpleSolveFlow({ sessionId, input, providerId, emit }) {
  const { normalizedProblemPromise } = createNormalizationPromise({ input, providerId, emit })
  const normalizedProblem = validateNormalizedProblem(await normalizedProblemPromise)
  emit(createEvent(SESSION_EVENT_TYPES.PROBLEM_NORMALIZED, normalizedProblem))

  const judgePrompt = buildSimpleJudgePrompt({ normalizedProblem })
  judgePrompt.providerId = providerId
  emit(createEvent(SESSION_EVENT_TYPES.JUDGE_STARTED, {}))

  const judgeResult = await runStructuredStage({
    stageKey: 'judge',
    emit,
    request: createStructuredRequester(judgeSolutions, delta => {
      emit(createEvent(SESSION_EVENT_TYPES.JUDGE_DELTA, { delta }))
    }),
    mainPrompt: judgePrompt,
    compactPrompt: {
      ...buildSimpleJudgePrompt({ normalizedProblem, compact: true }),
      providerId,
      stream: true,
      maxCompletionTokens: 2600
    },
    buildRepairPrompt: options => {
      const repairPrompt = buildJudgeRepairPrompt(options)
      repairPrompt.providerId = providerId
      repairPrompt.stream = false
      repairPrompt.maxCompletionTokens = options.compact ? 2600 : 3600
      return repairPrompt
    },
    validator: validateJudgeResult,
    repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
    compactRetryEvent: SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY,
    failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED
  })

  return finalizeSolveSession({
    sessionId,
    providerId,
    input,
    normalizedProblem,
    judgeResult,
    solverA: null,
    solverB: null,
    emit
  })
}

async function finalizeSolveSession({ sessionId, providerId, input, normalizedProblem, judgeResult, solverA, solverB, emit }) {
  emit(createEvent(SESSION_EVENT_TYPES.JUDGE_DONE, judgeResult))
  emit(createEvent(SESSION_EVENT_TYPES.FINAL_ANSWER_READY, judgeResult))

  let session = {
    sessionId,
    providerId,
    input,
    normalizedProblem,
    solverA,
    solverB,
    judgeResult,
    diagramImage: null,
    diagramPlan: null,
    finalExplanation: ''
  }

  setSession(sessionId, session)

  if (judgeResult.diagramDecision === 'required') {
    session = await runDiagramFlow({ session, emit })
  }

  session = await runFinalExplanationFlow({ session, emit })

  return session
}

export async function runSolveFlow({ sessionId, input, providerId, emit }) {
  emit(createEvent(SESSION_EVENT_TYPES.SESSION_STARTED, { sessionId, sourceType: input.type, mode: input.mode || 'hard' }))
  emit(createEvent(SESSION_EVENT_TYPES.INPUT_RECEIVED, { sourceType: input.type, mode: input.mode || 'hard' }))

  if (input.mode === 'simple') {
    return runSimpleSolveFlow({ sessionId, input, providerId, emit })
  }

  return runHardSolveFlow({ sessionId, input, providerId, emit })
}

export async function runFinalExplanationFlow({ session, emit }) {
  emit(createEvent(SESSION_EVENT_TYPES.FINAL_EXPLANATION_STARTED, {
    mode: 'stream'
  }))

  const prompt = buildFinalExplanationPrompt({
    normalizedProblem: session.normalizedProblem,
    judgeResult: session.judgeResult,
    solverA: session.solverA,
    solverB: session.solverB,
    diagramPlan: session.diagramPlan,
    hasDiagram: Boolean(session.diagramImage)
  })
  prompt.providerId = session.providerId
  prompt.stream = true
  prompt.maxCompletionTokens = 7000

  let finalExplanationText = ''
  let finalExplanationRawText = ''

  try {
    const response = await generateFinalExplanation(prompt, delta => {
      finalExplanationRawText += delta
      finalExplanationText += delta
      emit(createEvent(SESSION_EVENT_TYPES.FINAL_EXPLANATION_DELTA, {
        delta,
        rawText: finalExplanationRawText,
        text: normalizeExplanationText(finalExplanationText)
      }))
    })

    finalExplanationRawText = finalExplanationRawText || response.text || ''
    finalExplanationText = normalizeExplanationText(finalExplanationText || response.text)

    if (!finalExplanationText) {
      throw new Error('最終講解為空')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '最終講解生成失敗'
    emit(createEvent(SESSION_EVENT_TYPES.SESSION_ERROR, {
      message: `最終講解生成失敗，已使用保底講解：${message}`
    }))
    finalExplanationText = createFallbackFinalExplanation(session)
  }

  const updatedSession = {
    ...session,
    finalExplanation: finalExplanationText
  }

  setSession(session.sessionId, updatedSession)
  emit(createEvent(SESSION_EVENT_TYPES.FINAL_EXPLANATION_DONE, {
    rawText: finalExplanationRawText,
    text: finalExplanationText
  }))

  return updatedSession
}

export async function runDiagramFlow({ session, emit }) {
  emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_STARTED, {}))

  const maxAttempts = 3
  let previousAttempt = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_LLM_STARTED, { attempt }))

    const prompt = buildDiagramPlanPrompt({
      normalizedProblem: session.normalizedProblem,
      judgeResult: session.judgeResult,
      previousAttempt,
      originalInput: session.input
    })
    prompt.providerId = session.providerId

    const diagramCode = await runStructuredStage({
      stageKey: 'diagram_code',
      emit,
      request: createStructuredRequester(generateDiagramCode, delta => {
        emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_LLM_DELTA, { attempt, delta }))
      }),
      mainPrompt: prompt,
      buildRepairPrompt: options => {
        const repairPrompt = buildDiagramRepairPrompt(options)
        repairPrompt.providerId = session.providerId
        repairPrompt.stream = false
        repairPrompt.maxCompletionTokens = 3200
        return repairPrompt
      },
      validator: validateDiagramCodeResult,
      repairingEvent: SESSION_EVENT_TYPES.STAGE_REPAIRING,
      failedEvent: SESSION_EVENT_TYPES.STAGE_FAILED
    })

    const execution = await executePythonDiagram({
      pythonCode: diagramCode.pythonCode,
      canvasType: diagramCode.canvasType
    })

    if (execution.ok) {
      const updatedSession = {
        ...session,
        diagramImage: execution.imageDataUrl,
        diagramPlan: diagramCode
      }

      setSession(session.sessionId, updatedSession)
      emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_DONE, {
        imageDataUrl: execution.imageDataUrl,
        attempt,
        reasoningSummary: diagramCode.reasoningSummary
      }))

      return updatedSession
    }

    emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_ATTEMPT_FAILED, {
      attempt,
      error: execution.error
    }))

    previousAttempt = {
      pythonCode: diagramCode.pythonCode,
      error: execution.error
    }

    if (attempt < maxAttempts) {
      emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_RETRYING, {
        nextAttempt: attempt + 1
      }))
    }
  }

  emit(createEvent(SESSION_EVENT_TYPES.DIAGRAM_ERROR, {
    message: previousAttempt?.error || '作圖失敗'
  }))

  throw new Error(previousAttempt?.error || '作圖失敗')
}
