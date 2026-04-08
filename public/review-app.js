const FLOW_MODE = 'hard'

const form = document.querySelector('#review-form')
const followupForm = document.querySelector('#followup-form')
const providerSelect = document.querySelector('#provider-select')
const problemText = document.querySelector('#problem-text')
const problemImage = document.querySelector('#problem-image')
const workText = document.querySelector('#work-text')
const workImage = document.querySelector('#work-image')
const answerText = document.querySelector('#answer-text')
const answerImage = document.querySelector('#answer-image')
const reviewButton = document.querySelector('#review-button')
const diagramButton = document.querySelector('#diagram-button')
const followupButton = document.querySelector('#followup-button')
const timeline = document.querySelector('#timeline')
const analyzerAStream = document.querySelector('#review-analyzer-a-stream')
const analyzerBStream = document.querySelector('#review-analyzer-b-stream')
const reviewStream = document.querySelector('#review-stream')
const reviewResult = document.querySelector('#review-result')
const reviewSummary = document.querySelector('#review-summary')
const referenceAnswer = document.querySelector('#reference-answer')
const scorePlanOutput = document.querySelector('#score-plan')
const scoreBreakdownOutput = document.querySelector('#score-breakdown')
const diagramAdviceOutput = document.querySelector('#diagram-advice')
const diagramStreamOutput = document.querySelector('#diagram-stream')
const diagramStatusOutput = document.querySelector('#diagram-status')
const diagramContainer = document.querySelector('#diagram-container')
const finalExplanationStreamOutput = document.querySelector('#final-explanation-stream')
const finalExplanationRawOutput = document.querySelector('#final-explanation-raw')
const finalExplanationNormalizedOutput = document.querySelector('#final-explanation-normalized')
const finalExplanationRendered = document.querySelector('#final-explanation-rendered')
const followupHistory = document.querySelector('#followup-history')
const followupQuestion = document.querySelector('#followup-question')
const followupStream = document.querySelector('#followup-stream')

const TIMELINE_EVENTS = new Set([
  'events_connected', 'session_created', 'session_started', 'input_received', 'problem_normalized',
  'review_started', 'review_score_plan_started', 'review_score_plan_done',
  'review_analyzer_a_started', 'review_analyzer_b_started', 'review_analyzer_a_done', 'review_analyzer_b_done',
  'review_judge_started', 'review_done', 'review_score_breakdown_ready', 'final_answer_ready',
  'diagram_started', 'diagram_llm_started', 'diagram_attempt_failed', 'diagram_retrying', 'diagram_done', 'diagram_error',
  'final_explanation_started', 'final_explanation_done', 'review_followup_started', 'review_followup_done',
  'stage_repairing', 'stage_compact_retry', 'stage_failed', 'session_error'
])

const TIMELINE_LABELS = {
  events_connected: '事件流已連線', session_created: '會話已建立', session_started: '開始處理批改',
  input_received: '已收到輸入', problem_normalized: '題目標準化完成', review_started: '批改開始',
  review_score_plan_started: '分數規劃開始', review_score_plan_done: '分數規劃完成',
  review_analyzer_a_started: '分析 A 開始', review_analyzer_b_started: '分析 B 開始',
  review_analyzer_a_done: '分析 A 完成', review_analyzer_b_done: '分析 B 完成',
  review_judge_started: 'Review Judge 開始', review_done: '批改完成', review_score_breakdown_ready: '最終得分已產生',
  final_answer_ready: '標準答案已產生', diagram_started: '開始生成圖形', diagram_llm_started: '畫圖 AI 開始',
  diagram_attempt_failed: 'Python 執行失敗', diagram_retrying: '準備重試作圖', diagram_done: '圖形生成完成', diagram_error: '圖形生成失敗',
  final_explanation_started: '批改後講解開始', final_explanation_done: '批改後講解完成',
  review_followup_started: '追問開始', review_followup_done: '追問完成',
  stage_repairing: '模型重發中', stage_compact_retry: '精簡重發中', stage_failed: '階段失敗', session_error: '流程錯誤'
}

let currentSessionId = ''
let eventSource = null
let followupText = ''
let finalExplanationRenderTimer = null
let finalExplanationRawText = ''

function normalizeDisplayText(text) {
  if (typeof text !== 'string') return ''
  return text.replaceAll('\r\n', '\n').replaceAll('\n', '\n').replaceAll(/\\quad/g, ' ').replaceAll(/\\,/g, ' ').replaceAll(/[ \t]+\n/g, '\n').replaceAll(/\n{3,}/g, '\n\n').replaceAll(/[ \t]{2,}/g, ' ').trim()
}

function formatDiagramAdvice(payload) {
  const decisionMap = { required: '需要畫圖，系統將自動生成。', optional: '可選畫圖，由你決定是否生成。', unnecessary: '通常不需要畫圖，但你仍可手動要求生成。' }
  return [`判定: ${payload.diagramDecision || 'optional'}`, `建議: ${decisionMap[payload.diagramDecision] || decisionMap.optional}`, payload.diagramReason ? `原因: ${payload.diagramReason}` : ''].filter(Boolean).join('\n')
}

function formatScorePlan(payload) {
  return [`總分：${payload.totalMarks} 分`, `來源：${payload.totalMarksSource === 'problem' ? '題目標示' : '模型估算'}`, Array.isArray(payload.subparts) && payload.subparts.length > 0 ? `分題：\n- ${payload.subparts.map(item => `${item.label} ${item.maxMarks} 分`).join('\n- ')}` : '', payload.reasoning ? `說明：${payload.reasoning}` : ''].filter(Boolean).join('\n\n')
}

function formatScoreBreakdown(payload) {
  return [`總得分：${payload.awardedTotalMarks}/${payload.maxTotalMarks}`, Array.isArray(payload.scoreBreakdown) && payload.scoreBreakdown.length > 0 ? payload.scoreBreakdown.map(item => `${item.label}) ${item.awardedMarks}/${item.maxMarks}${item.comment ? `｜${item.comment}` : ''}`).join('\n') : ''].filter(Boolean).join('\n\n')
}

function appendTimeline(title, payload) {
  if (!TIMELINE_EVENTS.has(title)) return
  const item = document.createElement('div')
  item.className = 'timeline-item'
  const label = TIMELINE_LABELS[title] || title
  let detail = ''
  if (title === 'events_connected' || title === 'session_created') detail = payload?.sessionId || ''
  else if (title === 'session_error') detail = payload?.message || ''
  else if (title === 'stage_repairing' || title === 'stage_compact_retry' || title === 'stage_failed') detail = [payload?.stage || '', payload?.message || ''].filter(Boolean).join('：')
  else if (title === 'final_answer_ready') detail = payload?.finalAnswer || ''
  item.innerHTML = detail ? `<strong>${label}</strong><span>${detail}</span>` : `<strong>${label}</strong>`
  timeline.prepend(item)
}

function renderMath(container) {
  if (typeof window.renderMathInElement !== 'function') return
  window.renderMathInElement(container, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }], throwOnError: false })
}

function scheduleFinalExplanationRender(force = false) {
  if (force) { if (finalExplanationRenderTimer) { clearTimeout(finalExplanationRenderTimer); finalExplanationRenderTimer = null } renderMath(finalExplanationRendered); return }
  if (finalExplanationRenderTimer) clearTimeout(finalExplanationRenderTimer)
  finalExplanationRenderTimer = setTimeout(() => { finalExplanationRenderTimer = null; renderMath(finalExplanationRendered) }, 400)
}

function renderFinalExplanationText(text, options = {}) {
  const rawDisplayText = normalizeDisplayText(options.rawText ?? text)
  const normalizedDisplayText = normalizeDisplayText(text)
  finalExplanationRawOutput.textContent = rawDisplayText || '尚未生成講解'
  finalExplanationNormalizedOutput.textContent = normalizedDisplayText || '尚未生成正規化文本'
  finalExplanationRendered.innerHTML = ''
  const body = document.createElement('div')
  body.className = 'explanation-text'
  body.textContent = normalizedDisplayText
  finalExplanationRendered.appendChild(body)
  scheduleFinalExplanationRender(Boolean(options.final))
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { const result = typeof reader.result === 'string' ? reader.result : ''; const base64 = result.includes(',') ? result.split(',')[1] : result; resolve({ base64, mediaType: file.type || 'image/png' }) }
    reader.onerror = () => reject(new Error('圖片讀取失敗'))
    reader.readAsDataURL(file)
  })
}

async function loadProviders() {
  const response = await fetch('/api/providers')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '無法載入 API 提供者列表')
  providerSelect.innerHTML = ''
  data.providers.forEach(provider => { const option = document.createElement('option'); option.value = provider.id; option.textContent = `${provider.label}｜${provider.modelHint}`; providerSelect.appendChild(option) })
  providerSelect.value = data.defaultProviderId || data.providers[0]?.id || ''
}

function closeEvents() { if (eventSource) { eventSource.close(); eventSource = null } }

function resetView() {
  finalExplanationRenderTimer = null; finalExplanationRawText = ''
  timeline.innerHTML = ''; analyzerAStream.textContent = ''; analyzerBStream.textContent = ''; reviewStream.textContent = ''; reviewResult.textContent = ''; reviewSummary.textContent = ''; referenceAnswer.textContent = ''
  scorePlanOutput.textContent = '尚未生成分數規劃'; scoreBreakdownOutput.textContent = '尚未生成最終得分'
  diagramAdviceOutput.textContent = ''; diagramStreamOutput.textContent = ''; diagramStatusOutput.textContent = ''
  diagramContainer.innerHTML = '<p class="empty">尚未生成圖形</p>'
  finalExplanationStreamOutput.textContent = '等待批改完成後生成講解。'; finalExplanationRawOutput.textContent = '尚未生成講解'; finalExplanationNormalizedOutput.textContent = '尚未生成正規化文本'; finalExplanationRendered.innerHTML = '<p class="empty">尚未生成講解</p>'
  followupHistory.innerHTML = ''; followupStream.textContent = '尚未開始追問'; followupText = ''; followupButton.disabled = true
  if (diagramButton) { diagramButton.disabled = true; diagramButton.textContent = '生成圖形' }
}

function renderReviewSummary(payload) {
  reviewSummary.textContent = [`答案判定：${payload.answerVerdict || ''}`, `方法判定：${payload.methodVerdict || ''}`, payload.whyWrong ? `錯因：${payload.whyWrong}` : '', Array.isArray(payload.mistakeSteps) && payload.mistakeSteps.length > 0 ? `出錯步驟：\n- ${payload.mistakeSteps.join('\n- ')}` : '', payload.suggestedNextStep ? `建議下一步：${payload.suggestedNextStep}` : ''].filter(Boolean).join('\n\n')
  referenceAnswer.textContent = [payload.referenceAnswer ? `標準答案：${payload.referenceAnswer}` : '', payload.referenceReasoning ? `標準解題理由：${payload.referenceReasoning}` : '', payload.scoreJudgement ? `評分說明：${payload.scoreJudgement}` : '', Array.isArray(payload.markingNotes) && payload.markingNotes.length > 0 ? `得分 / 失分點：\n- ${payload.markingNotes.join('\n- ')}` : '', payload.followupHint ? `可追問方向：${payload.followupHint}` : ''].filter(Boolean).join('\n\n')
  diagramAdviceOutput.textContent = formatDiagramAdvice(payload)
}

function appendChat(role, content) {
  const item = document.createElement('div'); item.className = `chat-item ${role}`
  const title = document.createElement('strong'); title.textContent = role === 'assistant' ? '助手' : '用戶'
  const body = document.createElement('div'); body.className = 'chat-bubble'; body.textContent = content || ''
  item.append(title, body); followupHistory.appendChild(item)
}

function connectEvents(sessionId) {
  closeEvents()
  return new Promise(resolve => {
    let opened = false
    eventSource = new EventSource(`/api/events?sessionId=${encodeURIComponent(sessionId)}`)
    eventSource.onopen = () => { if (opened) return; opened = true; appendTimeline('events_connected', { sessionId }); resolve() }
    eventSource.onerror = () => { if (!opened) reviewSummary.textContent = '事件流連線失敗' }
    const bind = (eventName, handler) => eventSource.addEventListener(eventName, event => { const payload = JSON.parse(event.data); appendTimeline(eventName, payload); handler(payload) })
    bind('problem_normalized', payload => { reviewResult.textContent = `標準化題目：\n${JSON.stringify(payload, null, 2)}` })
    bind('review_score_plan_done', payload => { scorePlanOutput.textContent = formatScorePlan(payload) })
    bind('review_analyzer_a_delta', payload => { analyzerAStream.textContent += payload.delta || '' })
    bind('review_analyzer_b_delta', payload => { analyzerBStream.textContent += payload.delta || '' })
    bind('review_judge_delta', payload => { reviewStream.textContent += payload.delta || '' })
    bind('review_done', payload => { reviewResult.textContent = JSON.stringify(payload, null, 2); renderReviewSummary(payload); followupButton.disabled = false; if (diagramButton && payload.diagramDecision !== 'required') diagramButton.disabled = false })
    bind('review_score_breakdown_ready', payload => { scoreBreakdownOutput.textContent = formatScoreBreakdown(payload) })
    bind('final_answer_ready', payload => { if (payload?.finalAnswer) reviewSummary.textContent += `\n\n標準答案：${payload.finalAnswer}` })
    bind('diagram_started', () => {}); bind('diagram_llm_started', () => {})
    bind('diagram_llm_delta', payload => { diagramStreamOutput.textContent += payload.delta || '' })
    bind('diagram_attempt_failed', payload => { diagramStatusOutput.textContent += `[嘗試 ${payload.attempt}] 失敗：${payload.error || ''}\n` })
    bind('diagram_retrying', payload => { diagramStatusOutput.textContent += `準備第 ${payload.nextAttempt} 次嘗試...\n` })
    bind('diagram_done', payload => { if (payload.imageDataUrl) { diagramContainer.innerHTML = ''; const img = document.createElement('img'); img.src = payload.imageDataUrl; img.alt = '題目圖形'; img.style.maxWidth = '100%'; diagramContainer.appendChild(img) } if (diagramButton) { diagramButton.disabled = true; diagramButton.textContent = '圖形已生成' } })
    bind('diagram_error', payload => { diagramStatusOutput.textContent += `圖形生成失敗：${payload.message || ''}\n`; if (diagramButton) diagramButton.disabled = false })
    bind('final_explanation_started', payload => { finalExplanationRawText = ''; finalExplanationRawOutput.textContent = '講解生成中...'; finalExplanationNormalizedOutput.textContent = '正規化文本生成中...'; finalExplanationRendered.innerHTML = '<p class="empty">講解生成中...</p>'; finalExplanationStreamOutput.textContent = payload?.mode === 'stable' ? '穩定模式，等待完整講解返回。' : '批改後講解流式生成中。' })
    bind('final_explanation_delta', payload => { if (payload?.delta) { finalExplanationRawText = payload.rawText || `${finalExplanationRawText}${payload.delta}`; renderFinalExplanationText(payload.text || finalExplanationRawText, { rawText: finalExplanationRawText }); finalExplanationStreamOutput.textContent = '批改後講解流式生成中。' } })
    bind('final_explanation_done', payload => { renderFinalExplanationText(payload.text || '', { rawText: payload.rawText || '', final: true }); finalExplanationStreamOutput.textContent = '批改後講解已完成。' })
    bind('review_followup_started', () => { followupText = ''; followupStream.textContent = '追問回答生成中...' })
    bind('review_followup_delta', payload => { followupText = payload.text || `${followupText}${payload.delta || ''}`; followupStream.textContent = followupText })
    bind('review_followup_done', payload => { followupStream.textContent = payload.answer || ''; followupHistory.innerHTML = ''; (payload.history || []).forEach(item => appendChat(item.role, item.content)) })
    bind('stage_repairing', payload => { reviewSummary.textContent = `[${payload.stage}] 正在要求模型完整重發\n${payload.message || ''}` })
    bind('stage_compact_retry', payload => { reviewSummary.textContent = `[${payload.stage}] 正在要求模型精簡重發\n${payload.message || ''}` })
    bind('stage_failed', payload => { reviewSummary.textContent = `[${payload.stage}] ${payload.fallback ? '已使用保底結果' : '多次重發後仍失敗'}\n${payload.message || ''}` })
    bind('session_error', payload => { reviewSummary.textContent = payload?.message || '流程錯誤' })
  })
}

async function buildRequestBody() {
  const problemTextValue = problemText.value.trim(); const workTextValue = workText.value.trim(); const answerTextValue = answerText.value.trim()
  const problemImageFile = problemImage.files?.[0]; const workImageFile = workImage.files?.[0]; const answerImageFile = answerImage.files?.[0]
  if (!problemTextValue && !problemImageFile) throw new Error('請提供題目文字或題目圖片')
  if (problemTextValue && problemImageFile) throw new Error('題目文字與題目圖片只能二選一')
  if (!workTextValue && !workImageFile) throw new Error('請提供學生解題過程文字或圖片')
  if (workTextValue && workImageFile) throw new Error('學生解題過程文字與圖片只能二選一')
  if (answerTextValue && answerImageFile) throw new Error('學生答案文字與圖片只能二選一')
  const body = { sessionId: currentSessionId, providerId: providerSelect.value, mode: FLOW_MODE }
  if (problemTextValue) body.problemText = problemTextValue
  else { const image = await readFileAsBase64(problemImageFile); body.problemImageBase64 = image.base64; body.problemMediaType = image.mediaType }
  if (workTextValue) body.workText = workTextValue
  else { const image = await readFileAsBase64(workImageFile); body.workImageBase64 = image.base64; body.workMediaType = image.mediaType }
  if (answerTextValue) body.answerText = answerTextValue
  else if (answerImageFile) { const image = await readFileAsBase64(answerImageFile); body.answerImageBase64 = image.base64; body.answerMediaType = image.mediaType }
  return body
}

form.addEventListener('submit', async event => {
  event.preventDefault(); resetView(); reviewButton.disabled = true
  try {
    currentSessionId = crypto.randomUUID(); await connectEvents(currentSessionId); appendTimeline('session_created', { sessionId: currentSessionId })
    const body = await buildRequestBody()
    const response = await fetch('/api/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '批改請求失敗')
  } catch (error) { reviewSummary.textContent = error instanceof Error ? error.message : '批改失敗'; closeEvents() }
  finally { reviewButton.disabled = false }
})

if (diagramButton) {
  diagramButton.addEventListener('click', async () => {
    if (!currentSessionId) return; diagramButton.disabled = true; diagramButton.textContent = '生成中...'
    try {
      const response = await fetch('/api/diagram', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: currentSessionId }) })
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '作圖失敗')
    } catch (error) { diagramStatusOutput.textContent = error instanceof Error ? error.message : '作圖失敗'; diagramButton.disabled = false; diagramButton.textContent = '生成圖形' }
  })
}

followupForm.addEventListener('submit', async event => {
  event.preventDefault(); if (!currentSessionId) return
  const question = followupQuestion.value.trim(); if (!question) return
  followupButton.disabled = true; appendChat('user', question); followupQuestion.value = ''
  try {
    const response = await fetch('/api/review/followup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: currentSessionId, question }) })
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '追問失敗')
  } catch (error) { followupStream.textContent = error instanceof Error ? error.message : '追問失敗' }
  finally { followupButton.disabled = false }
})

loadProviders().catch(error => { reviewSummary.textContent = error instanceof Error ? error.message : '載入 API 提供者失敗' })
