const form = document.querySelector('#paper-review-form')
const providerSelect = document.querySelector('#provider-select')
const pdfFileInput = document.querySelector('#pdf-file')
const paperReviewButton = document.querySelector('#paper-review-button')
const timeline = document.querySelector('#timeline')
const rawEventsOutput = document.querySelector('#raw-events')
const paperIndexOutput = document.querySelector('#paper-index')
const paperGroupsOutput = document.querySelector('#paper-groups')
const paperQuestionsOutput = document.querySelector('#paper-questions')
const paperErrorsOutput = document.querySelector('#paper-errors')
const paperReportOutput = document.querySelector('#paper-report')
const paperIndexModelCalls = document.querySelector('#paper-index-model-calls')
const paperReportModelCalls = document.querySelector('#paper-report-model-calls')
const questionModelCalls = document.querySelector('#question-model-calls')
const paperQuestionScoreCards = document.querySelector('#paper-question-score-cards')
const paperScoreSummary = document.querySelector('#paper-score-summary')
const paperReportSummary = document.querySelector('#paper-report-summary')
const lightbox = document.querySelector('#image-lightbox')
const lightboxImage = document.querySelector('#image-lightbox-img')
const lightboxCloseButton = document.querySelector('#image-lightbox-close')

const TIMELINE_EVENTS = new Set([
  'events_connected',
  'session_created',
  'session_started',
  'input_received',
  'paper_review_started',
  'paper_index_started',
  'paper_index_done',
  'paper_phase_timing',
  'paper_pdf_rendered',
  'paper_groups_built',
  'paper_question_group_started',
  'paper_question_group_done',
  'paper_question_started',
  'paper_question_review_started',
  'reference_answer_started',
  'reference_answer_done',
  'student_judgement_started',
  'student_judgement_done',
  'score_js_started',
  'score_js_done',
  'paper_question_review_done',
  'paper_question_done',
  'paper_question_failed',
  'paper_report_started',
  'paper_report_done',
  'stage_repairing',
  'stage_compact_retry',
  'stage_failed',
  'session_error'
])

const TIMELINE_LABELS = {
  events_connected: '事件流已連線',
  session_created: '會話已建立',
  session_started: '整卷流程開始',
  input_received: '已收到 PDF 輸入',
  paper_review_started: '整卷批改啟動',
  paper_index_started: '開始 paper index',
  paper_index_done: 'paper index 完成',
  paper_phase_timing: '階段耗時',
  paper_pdf_rendered: 'PDF 已轉頁圖',
  paper_groups_built: '題目分組完成',
  paper_question_group_started: '題組開始',
  paper_question_group_done: '題組完成',
  paper_question_started: '題目開始',
  paper_question_review_started: '題目批改開始',
  reference_answer_started: '參考答案開始',
  reference_answer_done: '參考答案完成',
  student_judgement_started: '學生裁決開始',
  student_judgement_done: '學生裁決完成',
  score_js_started: 'JS 評分開始',
  score_js_done: 'JS 評分完成',
  paper_question_review_done: '題目批改完成',
  paper_question_done: '題目完成',
  paper_question_failed: '題目失敗',
  paper_report_started: '整卷報告開始',
  paper_report_done: '整卷報告完成',
  stage_repairing: '模型重發中',
  stage_compact_retry: '精簡重發中',
  stage_failed: '階段失敗',
  session_error: '流程錯誤'
}

const MAX_TIMELINE_ITEMS = 120
const MAX_RAW_EVENT_BLOCKS = 120
const MAX_RAW_EVENT_CHARS = 120000
const MAX_MODEL_TEXT_LENGTH = 24000
const MODEL_RENDER_THROTTLE_MS = 60
const RAW_EVENT_SKIP_NAMES = new Set(['model_call_delta'])
const SUMMARY_TEXT_LIMIT = 800

let eventSource = null
let currentSessionId = ''
const questionState = new Map()
const questionKeyByNumber = new Map()
const groupQuestionsById = new Map()
const modelCallState = new Map()
let timelineCount = 0
let rawEventBlocks = []
let rawEventQueue = []
let rawEventFlushScheduled = false
let timelineQueue = []
let timelineFlushScheduled = false
let questionRenderScheduled = false
let modelFlushScheduled = false

function normalizeQuestionNumber(value) {
  return String(value || '').trim()
}

function summarizePages(pages) {
  if (!Array.isArray(pages)) return []
  return pages.slice(0, 4).map(page => ({
    pageNumber: page?.pageNumber,
    mediaType: page?.mediaType,
    hasImageBase64: Boolean(page?.imageBase64),
    renderWidth: page?.renderWidth,
    renderHeight: page?.renderHeight,
    renderMode: page?.renderMode,
    reviewRenderWidth: page?.reviewRenderWidth,
    reviewRenderHeight: page?.reviewRenderHeight,
    reviewRenderMode: page?.reviewRenderMode,
    selectedImageKind: page?.selectedImageKind,
    selectedRenderWidth: page?.selectedRenderWidth,
    selectedRenderHeight: page?.selectedRenderHeight,
    selectedRenderMode: page?.selectedRenderMode
  }))
}

function truncateText(value, limit = SUMMARY_TEXT_LIMIT) {
  const text = String(value || '')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}… [truncated ${text.length - limit} chars]`
}

function summarizeEventPayload(eventName, payload) {
  if (!payload || typeof payload !== 'object') return payload

  if (eventName === 'paper_index_done') {
    return {
      questionCount: Array.isArray(payload.questions) ? payload.questions.length : 0,
      summary: truncateText(payload.summary || '', 300),
      questions: Array.isArray(payload.questions)
        ? payload.questions.slice(0, 25).map(item => ({
            questionNumber: item.questionNumber,
            pageRange: item.pageRange,
            samePageMultiQuestion: Boolean(item.samePageMultiQuestion),
            crossPage: Boolean(item.crossPage),
            visibleMarks: item.visibleMarks,
            regionHint: item.regionHint,
            confidence: item.confidence
          }))
        : []
    }
  }

  if (eventName === 'paper_groups_built') {
    return {
      groupCount: Array.isArray(payload.groups) ? payload.groups.length : 0,
      groups: Array.isArray(payload.groups)
        ? payload.groups.map(group => ({
            groupId: group.groupId,
            groupType: group.groupType,
            pageRange: group.pageRange,
            questionNumbers: group.questionNumbers
          }))
        : []
    }
  }

  if (eventName === 'paper_report_done') {
    return {
      text: truncateText(payload?.text || payload || '', 500),
      pending: Boolean(payload?.pending)
    }
  }

  if (eventName === 'paper_question_review_done' || eventName === 'paper_question_done' || eventName === 'review_done') {
    return {
      ...payload,
      pages: summarizePages(payload.pages),
      answerVerdict: truncateText(payload.answerVerdict || '', 240),
      methodVerdict: truncateText(payload.methodVerdict || '', 240),
      whyWrong: truncateText(payload.whyWrong || '', 320),
      suggestedNextStep: truncateText(payload.suggestedNextStep || '', 240),
      referenceReasoning: truncateText(payload.referenceReasoning || '', 320),
      text: truncateText(payload.text || '', 320)
    }
  }

  if ('pages' in payload || 'text' in payload || 'referenceReasoning' in payload || 'whyWrong' in payload) {
    return {
      ...payload,
      pages: summarizePages(payload.pages),
      text: truncateText(payload.text || '', 320),
      referenceReasoning: truncateText(payload.referenceReasoning || '', 320),
      whyWrong: truncateText(payload.whyWrong || '', 320)
    }
  }

  return payload
}

function getQuestionKeyFromPatch(patch = {}) {
  const questionId = String(patch.questionId || '').trim()
  const questionNumber = normalizeQuestionNumber(patch.questionNumber)
  if (questionId) {
    if (questionNumber) {
      const previousKey = questionKeyByNumber.get(questionNumber)
      if (previousKey && previousKey !== questionId && questionState.has(previousKey)) {
        const previous = questionState.get(previousKey) || {}
        questionState.delete(previousKey)
        questionState.set(questionId, {
          ...previous,
          ...patch,
          questionId,
          questionNumber: questionNumber || previous.questionNumber || ''
        })
      }
      questionKeyByNumber.set(questionNumber, questionId)
    }
    return questionId
  }
  if (questionNumber && questionKeyByNumber.has(questionNumber)) {
    return questionKeyByNumber.get(questionNumber)
  }
  if (questionNumber) {
    const fallbackKey = `number:${questionNumber}`
    questionKeyByNumber.set(questionNumber, fallbackKey)
    return fallbackKey
  }
  return String(patch.__fallbackKey || `unknown:${questionState.size + 1}`)
}

function getSortedQuestions() {
  return Array.from(questionState.values()).sort((a, b) => Number(a.questionNumber || 0) - Number(b.questionNumber || 0))
}

function getQuestionNumbersForPayload(payload = {}) {
  const directNumbers = Array.isArray(payload.questionNumbers)
    ? payload.questionNumbers.map(normalizeQuestionNumber).filter(Boolean)
    : []
  if (directNumbers.length > 0) return directNumbers

  const singleNumber = normalizeQuestionNumber(payload.questionNumber)
  if (singleNumber) return [singleNumber]

  const groupId = String(payload.groupId || '').trim()
  if (groupId && groupQuestionsById.has(groupId)) {
    return groupQuestionsById.get(groupId)
  }

  return []
}

function flushTimeline() {
  const items = timelineQueue.splice(0)
  if (items.length === 0) return

  const fragment = document.createDocumentFragment()
  for (const item of items) {
    fragment.appendChild(item)
  }
  timeline.prepend(fragment)
  timelineCount += items.length

  while (timelineCount > MAX_TIMELINE_ITEMS && timeline.lastChild) {
    timeline.removeChild(timeline.lastChild)
    timelineCount -= 1
  }
}

function scheduleTimelineFlush() {
  if (timelineFlushScheduled) return
  timelineFlushScheduled = true
  requestAnimationFrame(() => {
    timelineFlushScheduled = false
    flushTimeline()
  })
}

function appendTimeline(title, payload) {
  if (!TIMELINE_EVENTS.has(title)) return
  const item = document.createElement('div')
  item.className = 'timeline-item'
  const label = TIMELINE_LABELS[title] || title
  let detail = ''

  if (title === 'events_connected' || title === 'session_created') {
    detail = payload?.sessionId || ''
  } else if (title === 'input_received') {
    detail = payload?.pdfPath || payload?.sourceType || ''
  } else if (title === 'paper_index_started') {
    detail = payload?.inputMode || ''
  } else if (title === 'paper_question_started' || title === 'paper_question_done' || title === 'paper_question_failed') {
    detail = [payload?.questionNumber ? `Q${payload.questionNumber}` : '', payload?.message || payload?.status || ''].filter(Boolean).join('｜')
  } else if (title === 'paper_question_group_started' || title === 'paper_question_group_done') {
    const phaseText = payload?.phase ? `｜${payload.phase}` : ''
    detail = `${Array.isArray(payload?.questionNumbers) ? payload.questionNumbers.join(', ') : ''}${phaseText}`
  } else if (title === 'paper_pdf_rendered') {
    detail = [
      payload?.pageCount ? `${payload.pageCount} pages` : '',
      Number.isFinite(payload?.reviewTargetDpi) ? `${payload.reviewTargetDpi} DPI` : '',
      (Number.isFinite(payload?.reviewRenderWidth) && Number.isFinite(payload?.reviewRenderHeight))
        ? `${payload.reviewRenderWidth}×${payload.reviewRenderHeight}`
        : ''
    ].filter(Boolean).join('｜')
  } else if (title === 'paper_phase_timing') {
    detail = [payload?.phase || '', Number.isFinite(payload?.durationMs) ? `${payload.durationMs}ms` : ''].filter(Boolean).join('｜')
  } else if (title === 'stage_repairing' || title === 'stage_compact_retry' || title === 'stage_failed') {
    detail = [payload?.stage || '', payload?.message || ''].filter(Boolean).join('：')
  } else if (title === 'session_error') {
    detail = payload?.message || ''
  }

  item.innerHTML = detail ? `<strong>${label}</strong><span>${detail}</span>` : `<strong>${label}</strong>`
  timelineQueue.push(item)
  scheduleTimelineFlush()
}

function flushRawEvents() {
  if (rawEventQueue.length === 0) return
  rawEventBlocks.push(...rawEventQueue)
  rawEventQueue = []

  if (rawEventBlocks.length > MAX_RAW_EVENT_BLOCKS) {
    rawEventBlocks = rawEventBlocks.slice(-MAX_RAW_EVENT_BLOCKS)
  }

  if (rawEventBlocks.length === 0) {
    rawEventsOutput.textContent = ''
    return
  }

  let text = `${rawEventBlocks.join('\n')}\n`
  if (text.length > MAX_RAW_EVENT_CHARS) {
    while (rawEventBlocks.length > 1 && text.length > MAX_RAW_EVENT_CHARS) {
      rawEventBlocks.shift()
      text = `${rawEventBlocks.join('\n')}\n`
    }
  }

  rawEventsOutput.textContent = text
  rawEventsOutput.scrollTop = rawEventsOutput.scrollHeight
}

function scheduleRawEventFlush() {
  if (rawEventFlushScheduled) return
  rawEventFlushScheduled = true
  requestAnimationFrame(() => {
    rawEventFlushScheduled = false
    flushRawEvents()
  })
}

function appendRawEvent(eventName, payload) {
  if (RAW_EVENT_SKIP_NAMES.has(eventName)) return
  const summarized = summarizeEventPayload(eventName, payload)
  const block = [`event: ${eventName}`, JSON.stringify(summarized, null, 2), ''].join('\n')
  rawEventQueue.push(block)
  scheduleRawEventFlush()
}

function openLightbox(src, alt) {
  if (!lightbox || !lightboxImage) return
  lightboxImage.src = src
  lightboxImage.alt = alt || '放大題目圖片'
  lightbox.hidden = false
}

function closeLightbox() {
  if (!lightbox || !lightboxImage) return
  lightbox.hidden = true
  lightboxImage.removeAttribute('src')
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function createPdfPreview(question) {
  const firstPage = Array.isArray(question.pages) ? question.pages[0] : null
  if (!firstPage?.imageBase64) return '<p class="empty">尚未取得題目圖片</p>'
  const mediaType = firstPage.mediaType || 'image/png'
  const src = `data:${mediaType};base64,${firstPage.imageBase64}`
  const alt = `Q${question.questionNumber || '?'} PDF preview`
  return `<img class="paper-score-image" data-preview-src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" src="${escapeHtml(src)}" />`
}

function createScorePlanHtml(question) {
  const plan = question.scorePlan || {
    totalMarks: question.maxTotalMarks ?? 0,
    totalMarksSource: question.visibleMarks ? 'problem' : 'derived',
    reasoning: question.visibleMarks ? `根據題面可見分數 ${question.visibleMarks}` : '',
    subparts: []
  }
  const subparts = Array.isArray(plan.subparts) && plan.subparts.length > 0
    ? `<ul>${plan.subparts.map(item => `<li>${item.label || '整題'}：${item.maxMarks ?? 0} 分${item.reasoning ? `｜${item.reasoning}` : ''}</li>`).join('')}</ul>`
    : '<p>未提供分題規劃</p>'
  return `
    <p>總分：${plan.totalMarks ?? question.maxTotalMarks ?? 0}</p>
    <p>來源：${plan.totalMarksSource === 'problem' ? '題目標示' : (plan.totalMarksSource || '模型估算')}</p>
    ${subparts}
    ${plan.reasoning ? `<p>${plan.reasoning}</p>` : ''}
  `
}

function renderScoreSummary(questions) {
  if (!paperScoreSummary) return
  if (questions.length === 0) {
    paperScoreSummary.innerHTML = '<p class="empty">尚未生成逐題總表</p>'
    return
  }

  const totalAwarded = questions.reduce((sum, item) => sum + (item.awardedTotalMarks ?? 0), 0)
  const totalMax = questions.reduce((sum, item) => sum + (item.maxTotalMarks ?? item.scorePlan?.totalMarks ?? 0), 0)

  paperScoreSummary.innerHTML = `
    <table class="paper-score-summary-table">
      <thead>
        <tr>
          <th>題號</th>
          <th>題目分</th>
          <th>得分</th>
          <th>狀態</th>
        </tr>
      </thead>
      <tbody>
        ${questions.map(question => `
          <tr>
            <td>Q${question.questionNumber || '?'}</td>
            <td>${question.maxTotalMarks ?? question.scorePlan?.totalMarks ?? 0}</td>
            <td>${question.awardedTotalMarks ?? 0}</td>
            <td>${question.status || question.stage || 'pending'}</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td>總分</td>
          <td>${totalMax}</td>
          <td>${totalAwarded}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  `
}

function createScoreBreakdownHtml(question) {
  if (!Array.isArray(question.scoreBreakdown) || question.scoreBreakdown.length === 0) {
    return `<p>得分：${question.awardedTotalMarks ?? 0}/${question.maxTotalMarks ?? 0}</p><p class="empty">尚未生成最終得分 breakdown</p>`
  }

  return `
    <p>得分：${question.awardedTotalMarks ?? 0}/${question.maxTotalMarks ?? 0}</p>
    <ul>${question.scoreBreakdown.map(item => `<li>${item.label || '整題'}：${item.awardedMarks ?? 0}/${item.maxMarks ?? 0}${item.comment ? `｜${item.comment}` : ''}</li>`).join('')}</ul>
  `
}

function renderQuestionState() {
  const questions = getSortedQuestions()
  paperQuestionsOutput.textContent = questions.length === 0 ? '尚未開始逐題處理' : JSON.stringify(questions.map(item => ({
    questionId: item.questionId,
    questionNumber: item.questionNumber,
    visibleMarks: item.visibleMarks || '',
    mode: item.mode || '',
    awardedTotalMarks: item.awardedTotalMarks ?? 0,
    maxTotalMarks: item.maxTotalMarks ?? 0,
    status: item.status || '',
    pageRange: item.pageRange || [],
    pageCount: Array.isArray(item.pages) ? item.pages.length : 0,
    hasPreview: Array.isArray(item.pages) ? item.pages.some(page => Boolean(page?.imageBase64)) : false
  })), null, 2)
}

function renderQuestionScoreCards() {
  const questions = getSortedQuestions()
  if (questions.length === 0) {
    if (paperScoreSummary) paperScoreSummary.innerHTML = '<p class="empty">尚未生成逐題總表</p>'
    paperQuestionScoreCards.innerHTML = '<p class="empty">尚未建立逐題分數卡</p>'
    return
  }

  renderScoreSummary(questions)
  paperQuestionScoreCards.innerHTML = ''
  const fragment = document.createDocumentFragment()

  for (const question of questions) {
    const card = document.createElement('article')
    card.className = 'paper-score-card paper-score-card-full'
    card.innerHTML = `
      <div class="paper-score-card-head">
        <div>
          <h3>Q${question.questionNumber || '?'}</h3>
          <p>${question.visibleMarks || '未標示分數'}${question.mode ? `｜${question.mode}` : ''}</p>
          ${Array.isArray(question.topicTags) && question.topicTags.length > 0 ? `<p>${question.topicTags.join(' · ')}</p>` : ''}
        </div>
        <div>
          <strong>${question.awardedTotalMarks ?? 0}/${question.maxTotalMarks ?? question.scorePlan?.totalMarks ?? 0}</strong>
        </div>
      </div>
      <div class="paper-score-card-layout">
        <section>
          <h4>題目圖片</h4>
          ${createPdfPreview(question)}
        </section>
        <section>
          <h4>題目分數規劃</h4>
          ${createScorePlanHtml(question)}
        </section>
        <section>
          <h4>最終得分 breakdown</h4>
          ${createScoreBreakdownHtml(question)}
        </section>
      </div>
      ${(question.answerVerdict || question.methodVerdict || question.whyWrong)
        ? `<div class="paper-score-notes">
            ${question.answerVerdict ? `<p><strong>答案判定：</strong>${question.answerVerdict}</p>` : ''}
            ${question.methodVerdict ? `<p><strong>方法判定：</strong>${question.methodVerdict}</p>` : ''}
            ${question.whyWrong ? `<p><strong>失分原因：</strong>${question.whyWrong}</p>` : ''}
          </div>`
        : ''}
    `
    fragment.appendChild(card)
  }

  paperQuestionScoreCards.appendChild(fragment)
}

function scheduleQuestionRender() {
  if (questionRenderScheduled) return
  questionRenderScheduled = true
  requestAnimationFrame(() => {
    questionRenderScheduled = false
    renderQuestionState()
    renderQuestionScoreCards()
  })
}

function normalizeQuestionNumbers(question = {}) {
  const scoreBreakdown = Array.isArray(question.scoreBreakdown) ? question.scoreBreakdown : []
  const breakdownAwarded = scoreBreakdown.reduce((sum, item) => sum + (Number(item?.awardedMarks) || 0), 0)
  const breakdownMax = scoreBreakdown.reduce((sum, item) => sum + (Number(item?.maxMarks) || 0), 0)

  let awardedTotalMarks = question.awardedTotalMarks
  let maxTotalMarks = question.maxTotalMarks

  if ((awardedTotalMarks ?? 0) === 0 && breakdownAwarded > 0) {
    awardedTotalMarks = breakdownAwarded
  }

  if ((maxTotalMarks ?? 0) === 0) {
    if (breakdownMax > 0) maxTotalMarks = breakdownMax
    else if ((question.scorePlan?.totalMarks ?? 0) > 0) maxTotalMarks = question.scorePlan.totalMarks
  }

  return {
    awardedTotalMarks: awardedTotalMarks ?? 0,
    maxTotalMarks: maxTotalMarks ?? (question.scorePlan?.totalMarks ?? 0)
  }
}

function updateQuestionState(patch) {
  const key = getQuestionKeyFromPatch(patch)
  const previous = questionState.get(key) || {}
  const normalizedNumbers = normalizeQuestionNumbers({
    ...previous,
    ...patch,
    scorePlan: patch.scorePlan || previous.scorePlan || null,
    scoreBreakdown: Array.isArray(patch.scoreBreakdown) && patch.scoreBreakdown.length > 0 ? patch.scoreBreakdown : (previous.scoreBreakdown || [])
  })
  const merged = {
    ...previous,
    ...patch,
    questionId: patch.questionId || previous.questionId || (key.startsWith('number:') ? '' : key),
    questionNumber: patch.questionNumber || previous.questionNumber || '',
    pages: Array.isArray(patch.pages) ? patch.pages : (previous.pages || []),
    pageRange: patch.pageRange || previous.pageRange || [],
    topicTags: patch.topicTags || previous.topicTags || [],
    scorePlan: patch.scorePlan || previous.scorePlan || null,
    scoreBreakdown: Array.isArray(patch.scoreBreakdown) && patch.scoreBreakdown.length > 0 ? patch.scoreBreakdown : (previous.scoreBreakdown || []),
    awardedTotalMarks: normalizedNumbers.awardedTotalMarks,
    maxTotalMarks: normalizedNumbers.maxTotalMarks
  }
  questionState.set(key, merged)
  scheduleQuestionRender()
}

function primeQuestionCardsFromIndex(payload) {
  const questions = Array.isArray(payload?.questions) ? payload.questions : []
  for (const item of questions) {
    updateQuestionState({
      questionNumber: normalizeQuestionNumber(item.questionNumber),
      visibleMarks: item.visibleMarks || '',
      pageRange: item.pageRange || [],
      confidence: item.confidence || '',
      __fallbackKey: `index:${item.questionNumber}`
    })
    ensureQuestionSection(item.questionNumber)
  }
}

function primeQuestionCardsFromGroups(payload) {
  const groups = Array.isArray(payload?.groups) ? payload.groups : []
  for (const group of groups) {
    const pageRange = group.pageRange || []
    const questionNumbers = Array.isArray(group.questionNumbers)
      ? group.questionNumbers.map(normalizeQuestionNumber).filter(Boolean)
      : []
    if (group.groupId && questionNumbers.length > 0) {
      groupQuestionsById.set(group.groupId, questionNumbers)
    }
    for (const [index, questionNumber] of questionNumbers.entries()) {
      updateQuestionState({
        questionNumber,
        pageRange,
        __fallbackKey: `group:${group.groupId}:${index}`
      })
      ensureQuestionSection(questionNumber)
    }
  }
}

function getModelCallKey(payload) {
  return [
    payload?.scope || '',
    payload?.questionId || '',
    payload?.questionNumber || '',
    payload?.groupId || '',
    payload?.callRole || '',
    payload?.attemptLabel || 'initial'
  ].join('::')
}

function getModelCallTitle(payload) {
  const questionNumbers = getQuestionNumbersForPayload(payload)
  const questionLabel = questionNumbers.length > 0 ? `Q${questionNumbers.join(',Q')}` : ''
  const base = questionLabel || payload?.callRole || payload?.scope || 'model'
  const titledBase = questionLabel && payload?.callRole ? `${questionLabel}｜${payload.callRole}` : base
  return payload?.attemptLabel && payload.attemptLabel !== 'initial' ? `${titledBase}｜${payload.attemptLabel}` : titledBase
}

function ensureQuestionSection(questionNumber) {
  const key = String(questionNumber || 'unknown')
  let section = questionModelCalls.querySelector(`[data-question-section="${key}"]`)
  if (section) return section.querySelector('.paper-model-list')

  section = document.createElement('section')
  section.className = 'paper-question-section'
  section.dataset.questionSection = key
  section.innerHTML = `<h4>${questionNumber ? `Q${questionNumber}` : '未指派題目'}</h4><div class="paper-model-list"></div>`
  questionModelCalls.appendChild(section)
  return section.querySelector('.paper-model-list')
}

function ensureModelCallCard(payload) {
  const key = getModelCallKey(payload)
  let state = modelCallState.get(key)
  if (state) return state

  const card = document.createElement('article')
  card.className = 'paper-model-card'
  card.dataset.modelCallKey = key
  card.innerHTML = `
    <div class="paper-model-card-head">
      <strong>${getModelCallTitle(payload)}</strong>
      <span class="paper-model-meta">${payload.scope || ''}</span>
    </div>
    <div class="paper-model-status">等待開始</div>
    <pre class="output stream-output"></pre>
  `

  if (payload.scope === 'paper_index') paperIndexModelCalls.appendChild(card)
  else if (payload.scope === 'paper_report' || payload.scope === 'paper_summary') paperReportModelCalls.appendChild(card)
  else {
    const questionNumbers = getQuestionNumbersForPayload(payload)
    const targetQuestionNumber = questionNumbers[0] || payload.questionNumber
    ensureQuestionSection(targetQuestionNumber).appendChild(card)
  }

  state = {
    card,
    status: card.querySelector('.paper-model-status'),
    output: card.querySelector('pre'),
    text: '',
    dirty: false,
    lastRenderAt: 0,
    phase: 'idle'
  }
  modelCallState.set(key, state)
  return state
}

function flushModelCallRenders(force = false) {
  const now = Date.now()
  for (const state of modelCallState.values()) {
    if (!state.dirty) continue
    if (!force && state.phase === 'delta' && now - state.lastRenderAt < MODEL_RENDER_THROTTLE_MS) continue
    state.output.textContent = state.text || (state.phase === 'done' ? '（空輸出）' : '')
    state.dirty = false
    state.lastRenderAt = now
  }

  if (Array.from(modelCallState.values()).some(state => state.dirty)) {
    scheduleModelCallFlush()
  }
}

function scheduleModelCallFlush(force = false) {
  if (force) {
    flushModelCallRenders(true)
    return
  }
  if (modelFlushScheduled) return
  modelFlushScheduled = true
  requestAnimationFrame(() => {
    modelFlushScheduled = false
    flushModelCallRenders(false)
  })
}

function updateModelCall(payload, phase) {
  if (payload?.questionNumber || payload?.questionId) {
    updateQuestionState({
      questionId: payload.questionId,
      questionNumber: payload.questionNumber
    })
  }

  const state = ensureModelCallCard(payload)
  state.phase = phase
  if (phase === 'started') {
    state.status.textContent = `進行中｜${payload.mode || 'stream'}`
  } else if (phase === 'delta') {
    state.text = payload.text || `${state.text}${payload.delta || ''}`
    state.status.textContent = `串流中｜${payload.attemptLabel || 'initial'}`
    state.dirty = true
    scheduleModelCallFlush(false)
  } else if (phase === 'done') {
    state.text = payload.text || state.text
    state.status.textContent = `完成｜${payload.attemptLabel || 'initial'}${Number.isFinite(payload.durationMs) ? `｜${payload.durationMs}ms` : ''}`
    state.dirty = true
    scheduleModelCallFlush(true)
  } else if (phase === 'failed') {
    state.status.textContent = `失敗｜${payload.message || ''}${Number.isFinite(payload.durationMs) ? `｜${payload.durationMs}ms` : ''}`
  }
}

function renderPaperReport(payload) {
  const text = typeof payload === 'string' ? payload : (payload?.text || '')
  const pending = Boolean(payload && typeof payload === 'object' && payload.pending)
  const pendingLabel = pending ? '<p><em>完整總評生成中…</em></p>' : ''
  paperReportOutput.textContent = text || '尚未生成整卷報告'
  paperReportSummary.innerHTML = text
    ? `${pendingLabel}<div class="paper-report-text">${text.replace(/\n/g, '<br>')}</div>`
    : '<p class="empty">尚未生成整卷報告</p>'
}

function resetView() {
  timeline.innerHTML = ''
  rawEventsOutput.textContent = ''
  paperIndexOutput.textContent = ''
  paperGroupsOutput.textContent = ''
  paperQuestionsOutput.textContent = '尚未開始逐題處理'
  paperErrorsOutput.textContent = ''
  paperReportOutput.textContent = ''
  paperIndexModelCalls.innerHTML = ''
  paperReportModelCalls.innerHTML = ''
  questionModelCalls.innerHTML = ''
  if (paperScoreSummary) paperScoreSummary.innerHTML = '<p class="empty">尚未生成逐題總表</p>'
  paperQuestionScoreCards.innerHTML = '<p class="empty">尚未建立逐題分數卡</p>'
  paperReportSummary.innerHTML = '<p class="empty">尚未生成整卷報告</p>'
  questionState.clear()
  questionKeyByNumber.clear()
  groupQuestionsById.clear()
  modelCallState.clear()
  timelineCount = 0
  rawEventBlocks = []
  rawEventQueue = []
  rawEventFlushScheduled = false
  timelineQueue = []
  timelineFlushScheduled = false
  questionRenderScheduled = false
  modelFlushScheduled = false
  closeLightbox()
}

function closeEvents() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

async function loadProviders() {
  const response = await fetch('/api/providers')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '無法載入 API 提供者列表')

  providerSelect.innerHTML = ''
  data.providers.forEach(provider => {
    const option = document.createElement('option')
    option.value = provider.id
    option.textContent = `${provider.label}｜${provider.modelHint}`
    providerSelect.appendChild(option)
  })

  providerSelect.value = data.defaultProviderId || data.providers[0]?.id || ''
}

function connectEvents(sessionId) {
  closeEvents()
  return new Promise(resolve => {
    let opened = false
    eventSource = new EventSource(`/api/events?sessionId=${encodeURIComponent(sessionId)}`)

    eventSource.onopen = () => {
      if (opened) return
      opened = true
      appendTimeline('events_connected', { sessionId })
      appendRawEvent('events_connected', { sessionId })
      resolve()
    }

    eventSource.onerror = () => {
      if (!opened) paperErrorsOutput.textContent = '事件流連線失敗'
    }

    const bind = eventName => {
      eventSource.addEventListener(eventName, event => {
        const payload = JSON.parse(event.data)
        appendTimeline(eventName, payload)
        appendRawEvent(eventName, payload)

        if (eventName === 'paper_index_done') {
          paperIndexOutput.textContent = JSON.stringify(payload, null, 2)
          primeQuestionCardsFromIndex(payload)
        }
        if (eventName === 'paper_groups_built') {
          paperGroupsOutput.textContent = JSON.stringify(payload, null, 2)
          primeQuestionCardsFromGroups(payload)
        }
        if (eventName === 'paper_report_done') renderPaperReport(payload)

        if (eventName === 'stage_repairing' || eventName === 'stage_compact_retry' || eventName === 'stage_failed' || eventName === 'session_error') {
          paperErrorsOutput.textContent += `${eventName}\n${JSON.stringify(payload, null, 2)}\n\n`
        }

        if (eventName === 'paper_question_started') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, pageRange: payload.pageRange, confidence: payload.confidence, stage: 'started', mode: payload.mode })
        if (eventName === 'paper_question_review_started') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, stage: 'review_started', mode: payload.mode })
        if (eventName === 'reference_answer_started') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, stage: 'reference_answer_started' })
        if (eventName === 'reference_answer_done') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, referenceAnswer: payload.referenceAnswer, referenceReasoning: payload.referenceReasoning, stage: 'reference_answer_done' })
        if (eventName === 'student_judgement_started') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, stage: 'student_judgement_started' })
        if (eventName === 'student_judgement_done') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, answerVerdict: payload.answerVerdict, methodVerdict: payload.methodVerdict, whyWrong: payload.whyWrong, suggestedNextStep: payload.suggestedNextStep, stage: 'student_judgement_done' })
        if (eventName === 'score_js_started') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, stage: 'score_js_started' })
        if (eventName === 'score_js_done') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, scoreBreakdown: payload.scoreBreakdown || [], awardedTotalMarks: payload.awardedTotalMarks, maxTotalMarks: payload.maxTotalMarks, answerVerdict: payload.answerVerdict, methodVerdict: payload.methodVerdict, whyWrong: payload.whyWrong, suggestedNextStep: payload.suggestedNextStep, stage: 'score_js_done' })
        if (eventName === 'paper_question_review_done') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, status: 'completed', stage: 'review_done', awardedTotalMarks: payload.awardedTotalMarks, maxTotalMarks: payload.maxTotalMarks, mode: payload.mode, scorePlan: payload.scorePlan || null, scoreBreakdown: payload.scoreBreakdown || [], pages: payload.pages || [], answerVerdict: payload.answerVerdict, methodVerdict: payload.methodVerdict, whyWrong: payload.whyWrong, suggestedNextStep: payload.suggestedNextStep, referenceAnswer: payload.referenceAnswer, referenceReasoning: payload.referenceReasoning })
        if (eventName === 'paper_question_done') {
          updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, status: payload.status, awardedTotalMarks: payload.awardedTotalMarks, maxTotalMarks: payload.maxTotalMarks, mode: payload.mode, stage: 'done', scorePlan: payload.scorePlan || null, scoreBreakdown: payload.scoreBreakdown || [], pages: payload.pages || [], answerVerdict: payload.answerVerdict, methodVerdict: payload.methodVerdict, whyWrong: payload.whyWrong, suggestedNextStep: payload.suggestedNextStep })
          const allCards = Array.from(questionState.values())
          const allDone = allCards.length > 0 && allCards.every(item => item.status === 'completed')
          if (allDone) {
            appendTimeline('paper_questions_completed', { questionCount: allCards.length })
            appendRawEvent('paper_questions_completed', { questionCount: allCards.length })
            if (paperReportSummary.innerHTML.includes('完整總評生成中')) {
              paperReportSummary.innerHTML = `<p><strong>逐題批改已全部完成。</strong></p>${paperReportSummary.innerHTML}`
            }
          }
        }
        if (eventName === 'review_score_plan_done') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, scorePlan: payload })
        if (eventName === 'review_done') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, scoreBreakdown: payload.scoreBreakdown || [], awardedTotalMarks: payload.awardedTotalMarks, maxTotalMarks: payload.maxTotalMarks, answerVerdict: payload.answerVerdict, methodVerdict: payload.methodVerdict, whyWrong: payload.whyWrong, suggestedNextStep: payload.suggestedNextStep })
        if (eventName === 'paper_question_failed') updateQuestionState({ questionId: payload.questionId, questionNumber: payload.questionNumber, stage: 'failed', errorType: payload.errorType, message: payload.message, retryable: payload.retryable, attempt: payload.attempt })
        if (eventName === 'model_call_started') updateModelCall(payload, 'started')
        if (eventName === 'model_call_delta') updateModelCall(payload, 'delta')
        if (eventName === 'model_call_done') updateModelCall(payload, 'done')
        if (eventName === 'model_call_failed') updateModelCall(payload, 'failed')
      })
    }

    ;[
      'session_started', 'input_received', 'paper_review_started', 'paper_index_started', 'paper_index_done', 'paper_pdf_rendered', 'paper_groups_built',
      'paper_question_group_started', 'paper_question_group_done', 'paper_question_started', 'paper_question_review_started',
      'reference_answer_started', 'reference_answer_done', 'student_judgement_started', 'student_judgement_done', 'score_js_started', 'score_js_done',
      'paper_question_review_done', 'paper_question_done', 'paper_question_failed', 'paper_report_started', 'paper_report_done',
      'model_call_started', 'model_call_delta', 'model_call_done', 'model_call_failed',
      'stage_repairing', 'stage_compact_retry', 'stage_failed', 'session_error'
    ].forEach(bind)
  })
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  resetView()
  paperReviewButton.disabled = true

  try {
    const pdfFile = pdfFileInput.files?.[0]
    if (!pdfFile) throw new Error('請先上傳 PDF 檔案')
    if (!pdfFile.name.toLowerCase().endsWith('.pdf')) throw new Error('只支援 PDF 檔案')

    currentSessionId = crypto.randomUUID()
    appendTimeline('session_created', { sessionId: currentSessionId })
    appendRawEvent('session_created', { sessionId: currentSessionId })
    await connectEvents(currentSessionId)

    const formData = new FormData()
    formData.append('pdf', pdfFile)
    formData.append('sessionId', currentSessionId)
    formData.append('providerId', providerSelect.value)

    appendRawEvent('api_request:/api/paper-review', {
      sessionId: currentSessionId,
      providerId: providerSelect.value,
      fileName: pdfFile.name,
      fileSize: pdfFile.size,
      contentType: pdfFile.type || 'application/pdf'
    })

    const response = await fetch('/api/paper-review', {
      method: 'POST',
      body: formData
    })
    const result = await response.json()
    appendRawEvent('api_response:/api/paper-review', result)
    if (!response.ok) throw new Error(result.error || '整卷批改請求失敗')
  } catch (error) {
    paperErrorsOutput.textContent = error instanceof Error ? error.message : '整卷批改失敗'
    closeEvents()
  } finally {
    paperReviewButton.disabled = false
  }
})

loadProviders().catch(error => {
  paperErrorsOutput.textContent = error instanceof Error ? error.message : '載入 API 提供者失敗'
})

paperQuestionScoreCards.addEventListener('click', event => {
  const target = event.target instanceof HTMLElement ? event.target.closest('.paper-score-image') : null
  if (!(target instanceof HTMLImageElement)) return
  openLightbox(target.dataset.previewSrc || target.src, target.alt)
})

lightboxCloseButton?.addEventListener('click', () => {
  closeLightbox()
})

lightbox?.addEventListener('click', event => {
  if (event.target === lightbox) closeLightbox()
})

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && lightbox && !lightbox.hidden) {
    closeLightbox()
  }
})
