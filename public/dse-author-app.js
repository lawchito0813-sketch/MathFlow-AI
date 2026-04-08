const providerSelect = document.querySelector('#provider-select')
const modeSelect = document.querySelector('#mode-select')
const questionTypeField = document.querySelector('#question-type-field')
const questionTypeSelect = document.querySelector('#question-type-select')
const paperTypeSelect = document.querySelector('#paper-type-select')
const languageSelect = document.querySelector('#language-select')
const difficultySelect = document.querySelector('#difficulty-select')
const questionCountField = document.querySelector('#question-count-field')
const questionCountLabel = document.querySelector('#question-count-label')
const questionCountInput = document.querySelector('#question-count-input')
const marksField = document.querySelector('#marks-field')
const marksInput = document.querySelector('#marks-input')
const topicsInput = document.querySelector('#topics-input')
const avoidTopicsInput = document.querySelector('#avoid-topics-input')
const diagramSelect = document.querySelector('#diagram-select')
const realWorldCheckbox = document.querySelector('#real-world-checkbox')
const teacherGoalInput = document.querySelector('#teacher-goal-input')
const constraintsInput = document.querySelector('#constraints-input')
const generateButton = document.querySelector('#generate-button')
const bootstrapFollowupInput = document.querySelector('#author-followup-input')
const timeline = document.querySelector('#timeline')
const authorChatHistory = document.querySelector('#author-chat-history')
const authorPendingIndicator = document.querySelector('#author-pending-indicator')
const authorFollowupForm = document.querySelector('#author-followup-form')
const authorFollowupInput = document.querySelector('#author-followup-input-inline')
const authorInlineSendButton = document.querySelector('#author-inline-send-button')
const authorFollowupButton = document.querySelector('#author-followup-button')
const authorDraftList = document.querySelector('#author-draft-list')
const draftSectionTitle = document.querySelector('#draft-section-title')
const draftSectionNote = document.querySelector('#draft-section-note')
const form = document.querySelector('#author-form')
const rawEventsOutput = document.querySelector('#raw-events')
const authorModelCalls = document.querySelector('#author-model-calls')
const authorToolCalls = document.querySelector('#author-tool-calls')
const downloadPaperTextButton = document.querySelector('#download-paper-text-button')
const downloadPaperJsonButton = document.querySelector('#download-paper-json-button')
const openSettingsButton = document.querySelector('#open-settings-button')
const closeSettingsButton = document.querySelector('#close-settings-button')
const settingsModal = document.querySelector('#settings-modal')
const openActivityButton = document.querySelector('#open-activity-button')
const closeActivityButton = document.querySelector('#close-activity-button')
const activityModal = document.querySelector('#activity-modal')
const sessionPill = document.querySelector('#dse-session-pill')
const workbenchLayout = document.querySelector('#dse-workbench-layout')
const workbenchSplitter = document.querySelector('#dse-splitter')
const verticalLayout = document.querySelector('#dse-vertical-layout')
const horizontalSplitter = document.querySelector('#dse-horizontal-splitter')

const renderedTranscriptKeys = new Set()
const renderedTimelineKeys = new Set()

const TIMELINE_LABELS = {
  events_connected: '事件流已連線',
  session_created: '會話已建立',
  session_started: '出題流程開始',
  input_received: '已收到老師需求',
  author_intake_started: '需求整理開始',
  author_intake_done: '需求整理完成',
  author_followup_requested: '主 agent 需要補充資訊',
  author_blueprint_started: '藍圖生成開始',
  author_blueprint_done: '藍圖生成完成',
  author_question_started: '開始生成題目',
  author_question_done: '題目生成完成',
  author_verification_started: '答案驗算開始',
  author_verification_done: '答案驗算完成',
  author_paper_compiled: '整卷摘要完成',
  author_session_ready: '草稿已可編輯',
  author_agent_turn_started: 'Agent 新一輪決策',
  author_agent_message: 'Agent 訊息',
  author_agent_action_selected: 'Agent 已選動作',
  author_tool_call_started: '工具呼叫開始',
  author_tool_call_done: '工具呼叫完成',
  author_tool_call_failed: '工具呼叫失敗',
  author_subagent_started: '子 agent 啟動',
  author_subagent_done: '子 agent 完成',
  author_verification_conflict: '驗算 / 評分衝突',
  author_question_task_queued: '題目任務已排隊',
  author_question_task_started: '題目任務開始',
  author_question_task_stage_done: '題目階段完成',
  author_question_task_merged: '題目內容已合併',
  author_question_task_failed: '題目任務失敗',
  author_waiting_teacher: '等待老師回覆',
  author_run_finished: '本輪完成',
  session_error: '流程錯誤',
  final_explanation_done: '老師總結完成'
}

const TIMELINE_EVENTS_TO_RENDER = new Set([
  'session_started',
  'input_received',
  'author_followup_requested',
  'author_agent_action_selected',
  'author_tool_call_started',
  'author_tool_call_done',
  'author_tool_call_failed',
  'author_subagent_started',
  'author_subagent_done',
  'author_subagent_failed',
  'author_verification_conflict',
  'author_run_finished',
  'session_error'
])

const TRANSCRIPT_EVENT_TYPES = new Set([
  'author_agent_message',
  'author_waiting_teacher',
  'author_subagent_started',
  'author_subagent_done',
  'author_subagent_failed',
  'author_tool_call_started',
  'author_tool_call_done',
  'author_tool_call_failed',
  'author_verification_conflict',
  'session_error',
  'final_explanation_done'
])

let currentSessionId = ''
let eventSource = null
let conversation = []
let currentDrafts = []
const modelCallState = new Map()
const toolCallState = new Map()
let exportedArtifact = null
let modelFlushScheduled = false
let isRunActive = false
const MODEL_RENDER_THROTTLE_MS = 80
const MAX_RAW_EVENT_LINES = 120
const pendingUiEvents = []
const DSE_PANE_WIDTH_STORAGE_KEY = 'dse-workbench-left-pane-width'
const DSE_PANE_MIN_WIDTH = 320
const DSE_PANE_MAX_RATIO = 0.7
const DSE_SPLIT_BREAKPOINT = 1100
const DSE_VERTICAL_PANE_HEIGHT_STORAGE_KEY = 'dse-workbench-top-pane-height'
const DSE_SUMMARY_PANE_HEIGHT_STORAGE_KEY = 'dse-workbench-summary-pane-height'
const DSE_TOP_PANE_MIN_HEIGHT = 240
const DSE_SUMMARY_PANE_MIN_HEIGHT = 32
let uiFlushScheduled = false
let activePaneResize = null
let activeVerticalResize = null

function toggleModal(modal, shouldOpen) {
  if (!modal) return
  modal.hidden = !shouldOpen
  document.body.classList.toggle('dse-modal-open', shouldOpen)
}

function setupModalInteractions() {
  openSettingsButton?.addEventListener('click', () => toggleModal(settingsModal, true))
  closeSettingsButton?.addEventListener('click', () => toggleModal(settingsModal, false))
  openActivityButton?.addEventListener('click', () => toggleModal(activityModal, true))
  closeActivityButton?.addEventListener('click', () => toggleModal(activityModal, false))

  document.querySelectorAll('[data-close-modal]').forEach(node => {
    node.addEventListener('click', () => {
      const type = node.getAttribute('data-close-modal')
      if (type === 'settings') toggleModal(settingsModal, false)
      if (type === 'activity') toggleModal(activityModal, false)
    })
  })

  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    toggleModal(settingsModal, false)
    toggleModal(activityModal, false)
  })
}

function normalizeCsv(text) {
  return String(text || '').split(',').map(item => item.trim()).filter(Boolean)
}

function clampPaneWidth(width) {
  const containerWidth = workbenchLayout?.clientWidth || 0
  if (!containerWidth) return Math.max(DSE_PANE_MIN_WIDTH, width)
  const maxWidth = Math.max(DSE_PANE_MIN_WIDTH, Math.floor(containerWidth * DSE_PANE_MAX_RATIO))
  return Math.min(Math.max(width, DSE_PANE_MIN_WIDTH), maxWidth)
}

function isSplitLayoutEnabled() {
  return Boolean(workbenchLayout) && window.innerWidth > DSE_SPLIT_BREAKPOINT
}

function clampVerticalPaneHeight(height) {
  const containerHeight = verticalLayout?.clientHeight || 0
  if (!containerHeight) return Math.max(DSE_TOP_PANE_MIN_HEIGHT, height)
  const maxHeight = Math.max(DSE_TOP_PANE_MIN_HEIGHT, containerHeight - DSE_SUMMARY_PANE_MIN_HEIGHT - 8)
  return Math.min(Math.max(height, DSE_TOP_PANE_MIN_HEIGHT), maxHeight)
}

function applyVerticalPaneHeight(height, { persist = false } = {}) {
  if (!verticalLayout || !isSplitLayoutEnabled()) {
    if (verticalLayout) {
      verticalLayout.style.removeProperty('--dse-top-pane-height')
      verticalLayout.style.removeProperty('--dse-summary-pane-height')
    }
    return
  }
  const nextHeight = clampVerticalPaneHeight(height)
  const containerHeight = verticalLayout.clientHeight || 0
  const summaryHeight = Math.max(DSE_SUMMARY_PANE_MIN_HEIGHT, containerHeight - nextHeight - 8)
  verticalLayout.style.setProperty('--dse-top-pane-height', `${nextHeight}px`)
  verticalLayout.style.setProperty('--dse-summary-pane-height', `${summaryHeight}px`)
  if (persist) {
    window.localStorage.setItem(DSE_VERTICAL_PANE_HEIGHT_STORAGE_KEY, String(nextHeight))
    window.localStorage.setItem(DSE_SUMMARY_PANE_HEIGHT_STORAGE_KEY, String(summaryHeight))
  }
}

function restoreVerticalPaneHeight() {
  if (!verticalLayout) return
  if (!isSplitLayoutEnabled()) {
    verticalLayout.style.removeProperty('--dse-top-pane-height')
    verticalLayout.style.removeProperty('--dse-summary-pane-height')
    return
  }
  const savedTopHeight = Number(window.localStorage.getItem(DSE_VERTICAL_PANE_HEIGHT_STORAGE_KEY) || 0)
  const savedSummaryHeight = Number(window.localStorage.getItem(DSE_SUMMARY_PANE_HEIGHT_STORAGE_KEY) || 0)
  const containerHeight = verticalLayout.clientHeight || 0
  const fallbackSummaryHeight = DSE_SUMMARY_PANE_MIN_HEIGHT
  const fallbackTopHeight = Math.max(DSE_TOP_PANE_MIN_HEIGHT, containerHeight - fallbackSummaryHeight - 8)
  const preferredTopHeight = savedTopHeight > 0 ? savedTopHeight : (savedSummaryHeight > 0 ? containerHeight - savedSummaryHeight - 8 : fallbackTopHeight)
  applyVerticalPaneHeight(preferredTopHeight)
}

function stopVerticalResize() {
  if (!activeVerticalResize) return
  window.removeEventListener('pointermove', activeVerticalResize.handlePointerMove)
  window.removeEventListener('pointerup', activeVerticalResize.handlePointerUp)
  document.body.classList.remove('dse-is-resizing-y')
  activeVerticalResize = null
}

function startVerticalResize(event) {
  if (!isSplitLayoutEnabled() || !verticalLayout || !horizontalSplitter) return
  event.preventDefault()
  event.stopPropagation()
  if (typeof horizontalSplitter.setPointerCapture === 'function') {
    try {
      horizontalSplitter.setPointerCapture(event.pointerId)
    } catch {}
  }

  const layoutRect = verticalLayout.getBoundingClientRect()
  const handlePointerMove = moveEvent => {
    const nextHeight = moveEvent.clientY - layoutRect.top
    applyVerticalPaneHeight(nextHeight)
  }
  const handlePointerUp = moveEvent => {
    const nextHeight = moveEvent.clientY - layoutRect.top
    applyVerticalPaneHeight(nextHeight, { persist: true })
    stopVerticalResize()
  }

  activeVerticalResize = { handlePointerMove, handlePointerUp }
  document.body.classList.add('dse-is-resizing-y')
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
}

function setupVerticalSplitPane() {
  return
}

function applyWorkbenchPaneWidth(width, { persist = false } = {}) {
  if (!workbenchLayout || !isSplitLayoutEnabled()) {
    if (workbenchLayout) workbenchLayout.style.removeProperty('--dse-left-pane-width')
    return
  }
  const nextWidth = clampPaneWidth(width)
  workbenchLayout.style.setProperty('--dse-left-pane-width', `${nextWidth}px`)
  if (persist) {
    window.localStorage.setItem(DSE_PANE_WIDTH_STORAGE_KEY, String(nextWidth))
  }
}

function restoreWorkbenchPaneWidth() {
  if (!workbenchLayout) return
  if (!isSplitLayoutEnabled()) {
    workbenchLayout.style.removeProperty('--dse-left-pane-width')
    return
  }
  const savedWidth = Number(window.localStorage.getItem(DSE_PANE_WIDTH_STORAGE_KEY) || 0)
  const fallbackWidth = Math.max(DSE_PANE_MIN_WIDTH, Math.round(workbenchLayout.clientWidth * 0.36) || 420)
  applyWorkbenchPaneWidth(savedWidth > 0 ? savedWidth : fallbackWidth)
}

function stopWorkbenchResize() {
  if (!activePaneResize) return
  window.removeEventListener('pointermove', activePaneResize.handlePointerMove)
  window.removeEventListener('pointerup', activePaneResize.handlePointerUp)
  document.body.classList.remove('dse-is-resizing')
  activePaneResize = null
}

function startWorkbenchResize(event) {
  if (!isSplitLayoutEnabled() || !workbenchLayout || !workbenchSplitter) return
  event.preventDefault()
  event.stopPropagation()
  if (typeof workbenchSplitter.setPointerCapture === 'function') {
    try {
      workbenchSplitter.setPointerCapture(event.pointerId)
    } catch {}
  }

  const layoutRect = workbenchLayout.getBoundingClientRect()
  const handlePointerMove = moveEvent => {
    const nextWidth = moveEvent.clientX - layoutRect.left
    applyWorkbenchPaneWidth(nextWidth)
  }
  const handlePointerUp = moveEvent => {
    const nextWidth = moveEvent.clientX - layoutRect.left
    applyWorkbenchPaneWidth(nextWidth, { persist: true })
    stopWorkbenchResize()
  }

  activePaneResize = { handlePointerMove, handlePointerUp }
  document.body.classList.add('dse-is-resizing')
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
}

function setupWorkbenchSplitPane() {
  if (!workbenchLayout || !workbenchSplitter) return
  restoreWorkbenchPaneWidth()
  workbenchSplitter.addEventListener('pointerdown', startWorkbenchResize)
  window.addEventListener('resize', restoreWorkbenchPaneWidth)
}

function buildEventKey(eventName, payload) {
  return [
    eventName,
    payload?.messageId || '',
    payload?.toolCallId || '',
    payload?.questionNumber || '',
    payload?.toolName || '',
    payload?.subagent || '',
    payload?.action || '',
    payload?.question || '',
    payload?.content || '',
    payload?.message || ''
  ].join('::')
}

function buildNormalizedTextKey(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function buildTranscriptDedupeKey(eventName, payload) {
  const normalizedQuestion = buildNormalizedTextKey(payload?.question)
  const normalizedContent = buildNormalizedTextKey(payload?.content)
  const normalizedMessage = buildNormalizedTextKey(payload?.message)

  if (eventName === 'author_waiting_teacher') {
    return ['waiting-teacher', normalizedQuestion || normalizedMessage].join('::')
  }

  if (eventName === 'author_agent_action_selected') {
    if ((payload?.action || '') === 'ask_teacher') {
      return ['agent-action-ask-teacher', normalizedQuestion || normalizedMessage || normalizedContent].join('::')
    }
    return [
      'agent-action',
      payload?.action || '',
      payload?.toolName || '',
      payload?.subagent || '',
      payload?.questionNumber || '',
      normalizedMessage || normalizedContent
    ].join('::')
  }

  if (eventName === 'author_agent_message') {
    return [
      'agent-message',
      payload?.role || '',
      payload?.kind || '',
      normalizedContent || normalizedMessage
    ].join('::')
  }

  if (eventName === 'author_subagent_started' || eventName === 'author_subagent_done' || eventName === 'author_subagent_failed') {
    return [eventName, payload?.subagent || '', payload?.toolName || '', payload?.questionNumber || '', normalizedMessage].join('::')
  }

  if (eventName === 'author_verification_conflict') {
    return [eventName, payload?.questionNumber || '', normalizedMessage || normalizedContent].join('::')
  }

  if (eventName === 'session_error' || eventName === 'final_explanation_done') {
    return [eventName, normalizedMessage || normalizedContent || buildNormalizedTextKey(payload?.text)].join('::')
  }

  return buildEventKey(eventName, payload)
}

function setSessionPill(text) {
  if (!sessionPill) return
  const statusMap = {
    未開始: 'idle',
    starting: 'starting',
    connected: 'connected',
    active: 'active',
    thinking: 'thinking',
    waiting_teacher: 'waiting',
    ready: 'ready',
    error: 'error'
  }
  sessionPill.textContent = statusMap[text] || text || 'idle'
}

function setDraftStatus(text) {
  if (draftSectionTitle) {
    draftSectionTitle.textContent = text || '生成草稿'
  }
}

function setPendingIndicator(isVisible, text = '主 Agent 正在處理…') {
  if (!authorPendingIndicator) return
  authorPendingIndicator.hidden = !isVisible
  authorPendingIndicator.textContent = text
  authorPendingIndicator.dataset.active = isVisible ? 'true' : 'false'
}

function appendPendingAssistantEntry(message) {
  if (!authorChatHistory) return

  const item = document.createElement('article')
  item.className = 'dse-message assistant'

  const head = document.createElement('div')
  head.className = 'dse-message-head'

  const title = document.createElement('span')
  title.className = 'dse-message-title'
  title.textContent = '主 Agent'

  const meta = document.createElement('span')
  meta.className = 'dse-message-meta'
  meta.textContent = 'processing'

  const status = document.createElement('span')
  status.className = 'dse-message-status'
  status.textContent = 'thinking'

  head.append(title, meta, status)

  const body = document.createElement('div')
  body.className = 'dse-message-body'
  body.textContent = message || '正在處理你的要求…'

  item.append(head, body)
  authorChatHistory.appendChild(item)
  authorChatHistory.scrollTop = authorChatHistory.scrollHeight
}

function setFieldVisibility(field, isVisible) {
  if (!field) return
  field.hidden = !isVisible
}

function syncModeForm() {
  const mode = modeSelect?.value || 'single'
  const isPaperMode = mode === 'paper'
  const isSingleMode = mode === 'single'

  setFieldVisibility(questionTypeField, !isPaperMode)
  setFieldVisibility(marksField, !isPaperMode)

  if (questionCountField) {
    setFieldVisibility(questionCountField, true)
    if (questionCountLabel) {
      questionCountLabel.textContent = isPaperMode ? '整卷題量（由藍圖決定）' : (isSingleMode ? '題量（固定 1）' : '題量')
    }
  }

  if (questionCountInput) {
    if (isSingleMode) {
      questionCountInput.value = '1'
      questionCountInput.disabled = true
    } else if (isPaperMode) {
      questionCountInput.value = '0'
      questionCountInput.disabled = true
    } else {
      questionCountInput.disabled = false
      if (Number(questionCountInput.value || 0) < 1) {
        questionCountInput.value = '2'
      }
    }
  }

  if (draftSectionTitle) {
    draftSectionTitle.textContent = isPaperMode ? '整卷草稿 / 進度' : '生成草稿'
  }

  if (draftSectionNote) {
    draftSectionNote.textContent = isPaperMode
      ? '整卷模式會先建立整卷藍圖與題目任務，再顯示各題進度；未完成前不會把單題結果當作整卷完成。'
      : '單題 / 題組模式會在這裡顯示逐題草稿。'
  }
}

function buildTimelineDetail(eventName, payload) {
  if (eventName === 'author_tool_call_started' || eventName === 'author_tool_call_done' || eventName === 'author_tool_call_failed') {
    return payload?.toolName || ''
  }
  if (eventName === 'author_subagent_started' || eventName === 'author_subagent_done' || eventName === 'author_subagent_failed') {
    return payload?.subagent || ''
  }
  if (eventName === 'author_agent_action_selected') {
    return payload?.action || payload?.summary || ''
  }
  if (payload?.questionNumber) return `Q${payload.questionNumber}`
  return payload?.message || payload?.sessionId || ''
}

function appendTimeline(eventName, payload) {
  if (!TIMELINE_EVENTS_TO_RENDER.has(eventName)) return
  const key = buildEventKey(eventName, payload)
  if (renderedTimelineKeys.has(key)) return
  renderedTimelineKeys.add(key)

  const item = document.createElement('div')
  item.className = 'timeline-item'
  const label = TIMELINE_LABELS[eventName] || eventName
  const detail = buildTimelineDetail(eventName, payload)
  item.innerHTML = detail ? `<strong>${label}</strong><span>${detail}</span>` : `<strong>${label}</strong>`
  timeline.prepend(item)
}

function appendRawEvent(eventName, payload) {
  const nextLine = `${new Date().toLocaleTimeString()} ${eventName}\n${JSON.stringify(payload, null, 2)}`
  const existing = rawEventsOutput.textContent ? rawEventsOutput.textContent.split('\n\n').filter(Boolean) : []
  existing.unshift(nextLine)
  rawEventsOutput.textContent = existing.slice(0, MAX_RAW_EVENT_LINES).join('\n\n')
}

function flushUiEvents() {
  uiFlushScheduled = false
  const events = pendingUiEvents.splice(0, pendingUiEvents.length)
  for (const { eventName, payload } of events) {
    appendTimeline(eventName, payload)
    appendRawEvent(eventName, payload)
    appendEventToTranscript(eventName, payload)
  }
}

function scheduleUiEvent(eventName, payload) {
  pendingUiEvents.push({ eventName, payload })
  if (uiFlushScheduled) return
  uiFlushScheduled = true
  requestAnimationFrame(flushUiEvents)
}

function appendTranscriptEntry({ entryType = 'assistant', title = '', meta = '', status = '', body = '', dedupeKey = '' }) {
  if (!body) return
  if (dedupeKey) {
    if (renderedTranscriptKeys.has(dedupeKey)) return
    renderedTranscriptKeys.add(dedupeKey)
  }

  const item = document.createElement('article')
  item.className = `dse-message ${entryType}`

  const head = document.createElement('div')
  head.className = 'dse-message-head'

  const titleEl = document.createElement('div')
  titleEl.className = 'dse-message-title'
  titleEl.textContent = title
  head.appendChild(titleEl)

  if (meta) {
    const metaEl = document.createElement('div')
    metaEl.className = 'dse-message-meta'
    metaEl.textContent = meta
    head.appendChild(metaEl)
  }

  if (status) {
    const statusEl = document.createElement('div')
    statusEl.className = 'dse-message-status'
    statusEl.textContent = status
    head.appendChild(statusEl)
  }

  const bodyEl = document.createElement('div')
  bodyEl.className = 'dse-message-body'
  bodyEl.textContent = body

  item.append(head, bodyEl)
  authorChatHistory.appendChild(item)
  authorChatHistory.scrollTop = authorChatHistory.scrollHeight
}

function getToolTranscriptKey(payload, phase) {
  return [
    'tool-transcript',
    phase,
    payload?.toolCallId || '',
    payload?.toolName || '',
    payload?.questionNumber || '',
    payload?.startedAt || payload?.timestamp || ''
  ].join('::')
}

function appendToolTranscript(payload, phase) {
  const body = phase === 'started'
    ? JSON.stringify(payload.input || {}, null, 2) || '{}'
    : (payload.resultSummary || payload.message || JSON.stringify(payload, null, 2))

  const wrapper = document.createElement('article')
  wrapper.className = 'dse-message tool'

  const toolBlock = document.createElement('div')
  toolBlock.className = 'dse-tool-block'
  const head = document.createElement('div')
  head.className = 'dse-tool-block-head'
  head.innerHTML = `
    <div class="dse-tool-name">${payload.toolName || 'tool'}</div>
    <div class="dse-tool-badge">${phase === 'started' ? 'running' : phase === 'done' ? 'done' : 'failed'}</div>
  `
  const pre = document.createElement('pre')
  pre.className = 'output stream-output'
  pre.textContent = body
  toolBlock.append(head, pre)
  wrapper.appendChild(toolBlock)
  authorChatHistory.appendChild(wrapper)
  authorChatHistory.scrollTop = authorChatHistory.scrollHeight
}

function appendEventToTranscript(eventName, payload) {
  if (!TRANSCRIPT_EVENT_TYPES.has(eventName)) return
  if (eventName === 'author_followup_requested' || eventName === 'author_waiting_teacher' || eventName === 'author_run_finished' || eventName === 'author_session_ready' || eventName === 'author_tool_call_started' || eventName === 'author_tool_call_done' || eventName === 'author_tool_call_failed' || eventName === 'author_subagent_started' || eventName === 'author_subagent_done' || eventName === 'author_subagent_failed' || eventName === 'session_error') {
    setPendingIndicator(false)
  }
  const key = buildTranscriptDedupeKey(eventName, payload)

  if (eventName === 'author_waiting_teacher' || eventName === 'author_followup_requested') {
    appendTranscriptEntry({
      entryType: 'assistant',
      title: '主 Agent',
      meta: 'needs input',
      status: 'waiting',
      body: payload.question || '等待老師補充',
      dedupeKey: buildNormalizedTextKey(payload.question || key)
    })
    return
  }

  if (eventName === 'author_agent_message' && payload?.content) {
    const normalizedContent = buildNormalizedTextKey(payload.content)
    const normalizedQuestion = buildNormalizedTextKey(payload.question || payload.message)
    if (payload.role === 'assistant' && normalizedContent && renderedTranscriptKeys.has(normalizedContent)) {
      return
    }
    if (payload.role === 'assistant' && normalizedContent === normalizedQuestion) {
      return
    }
    appendTranscriptEntry({
      entryType: payload.kind === 'subagent' ? 'subagent' : (payload.role === 'user' ? 'user' : 'assistant'),
      title: payload.role === 'user' ? '老師' : (payload.kind === 'subagent' ? '子 Agent' : '主 Agent'),
      meta: payload.kind || '',
      body: payload.content,
      dedupeKey: key
    })
    return
  }

  if (eventName === 'author_subagent_started') {
    appendTranscriptEntry({
      entryType: 'subagent',
      title: '子 Agent',
      meta: payload.subagent || '',
      status: 'running',
      body: payload.message || `已委派 ${payload.subagent || 'subagent'}`,
      dedupeKey: key
    })
    return
  }

  if (eventName === 'author_subagent_done') {
    appendTranscriptEntry({
      entryType: 'subagent',
      title: '子 Agent',
      meta: payload.subagent || '',
      status: 'done',
      body: payload.message || `${payload.subagent || 'subagent'} 已完成`,
      dedupeKey: key
    })
    return
  }

  if (eventName === 'author_subagent_failed') {
    appendTranscriptEntry({
      entryType: 'subagent',
      title: '子 Agent',
      meta: payload.subagent || '',
      status: 'failed',
      body: payload.message || `${payload.subagent || 'subagent'} 失敗`,
      dedupeKey: key
    })
    return
  }

  if (eventName === 'author_tool_call_started') {
    const toolKey = getToolTranscriptKey(payload, 'started')
    if (renderedTranscriptKeys.has(toolKey)) return
    renderedTranscriptKeys.add(toolKey)
    appendToolTranscript(payload, 'started')
    return
  }

  if (eventName === 'author_tool_call_done') {
    const toolKey = getToolTranscriptKey(payload, 'done')
    if (renderedTranscriptKeys.has(toolKey)) return
    renderedTranscriptKeys.add(toolKey)
    appendToolTranscript(payload, 'done')
    return
  }

  if (eventName === 'author_tool_call_failed') {
    const toolKey = getToolTranscriptKey(payload, 'failed')
    if (renderedTranscriptKeys.has(toolKey)) return
    renderedTranscriptKeys.add(toolKey)
    appendToolTranscript(payload, 'failed')
    return
  }

  if (eventName === 'author_verification_conflict') {
    appendTranscriptEntry({
      entryType: 'system',
      title: 'Verifier',
      meta: payload.questionNumber ? `Q${payload.questionNumber}` : '',
      status: 'conflict',
      body: payload.message || JSON.stringify(payload, null, 2),
      dedupeKey: key
    })
    return
  }

  if (eventName === 'session_error') {
    appendTranscriptEntry({
      entryType: 'system',
      title: 'Runtime error',
      status: 'failed',
      body: payload.message || '流程錯誤',
      dedupeKey: key
    })
    return
  }

  if (eventName === 'final_explanation_done') {
    appendTranscriptEntry({
      entryType: 'assistant',
      title: '主 Agent',
      meta: 'final explanation',
      status: 'done',
      body: payload.text || '',
      dedupeKey: key
    })
  }
}

function getModelCallKey(payload) {
  return [payload.scope || 'generic', payload.stageKey || '', payload.questionNumber || '', payload.callRole || 'model', payload.attemptLabel || 'initial'].join('::')
}

function ensureModelCallCard(payload) {
  const key = getModelCallKey(payload)
  let card = modelCallState.get(key)
  if (card) return card
  const element = document.createElement('article')
  element.className = 'paper-model-card'
  element.innerHTML = `
    <div class="paper-model-card-head">
      <strong>${payload.callRole || 'model'}</strong>
      <span class="paper-model-meta">${payload.stageKey || payload.scope || ''}</span>
    </div>
    <div class="paper-model-status">等待開始</div>
    <pre class="output stream-output"></pre>
  `
  authorModelCalls.appendChild(element)
  card = {
    root: element,
    status: element.querySelector('.paper-model-status'),
    output: element.querySelector('pre'),
    text: '',
    dirty: false,
    lastRenderAt: 0,
    phase: 'idle'
  }
  modelCallState.set(key, card)
  return card
}

function flushModelCallRenders(force = false) {
  const now = Date.now()
  for (const card of modelCallState.values()) {
    if (!card.dirty) continue
    if (!force && card.phase === 'delta' && now - (card.lastRenderAt || 0) < MODEL_RENDER_THROTTLE_MS) continue
    card.output.textContent = card.text || (card.phase === 'done' ? '（空輸出）' : '')
    card.dirty = false
    card.lastRenderAt = now
  }
  if (Array.from(modelCallState.values()).some(card => card.dirty)) {
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
  const card = ensureModelCallCard(payload)
  card.root.dataset.phase = phase
  card.phase = phase
  if (phase === 'started') {
    card.status.textContent = `進行中｜${payload.mode || 'stream'}`
    return
  }
  if (phase === 'delta') {
    card.text = payload.text || `${card.text}${payload.delta || ''}`
    card.status.textContent = `串流中｜${payload.attemptLabel || 'initial'}`
    card.dirty = true
    scheduleModelCallFlush(false)
    return
  }
  if (phase === 'done') {
    card.text = payload.text || card.text
    card.status.textContent = `完成｜${payload.attemptLabel || 'initial'}`
    card.dirty = true
    scheduleModelCallFlush(true)
    return
  }
  if (phase === 'failed') {
    card.status.textContent = `失敗｜${payload.message || ''}`
  }
}

function ensureToolCallCard(payload) {
  const key = `${payload.toolCallId || ''}::${payload.toolName || 'tool'}::${payload.startedAt || payload.timestamp || ''}`
  let card = toolCallState.get(key)
  if (card) return card
  const element = document.createElement('article')
  element.className = 'paper-model-card'
  element.innerHTML = `
    <div class="paper-model-card-head">
      <strong>${payload.toolName || 'tool'}</strong>
      <span class="paper-model-meta">tool</span>
    </div>
    <div class="paper-model-status">${payload.status || 'started'}</div>
    <pre class="output stream-output"></pre>
  `
  authorToolCalls.prepend(element)
  card = {
    root: element,
    status: element.querySelector('.paper-model-status'),
    output: element.querySelector('pre')
  }
  toolCallState.set(key, card)
  return card
}

function updateToolCall(payload, phase) {
  const card = ensureToolCallCard(payload)
  card.root.dataset.phase = phase
  if (phase === 'started') {
    card.status.textContent = '進行中'
    card.output.textContent = JSON.stringify(payload.input || {}, null, 2)
    return
  }
  if (phase === 'done') {
    card.status.textContent = '完成'
    card.output.textContent = payload.resultSummary || JSON.stringify(payload, null, 2)
    return
  }
  if (phase === 'failed') {
    card.status.textContent = '失敗'
    card.output.textContent = payload.message || JSON.stringify(payload, null, 2)
  }
}

function closeEvents() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

function resetView() {
  timeline.innerHTML = ''
  authorChatHistory.innerHTML = ''
  setDraftStatus('生成草稿')
  authorDraftList.innerHTML = ''
  rawEventsOutput.textContent = ''
  authorModelCalls.innerHTML = ''
  authorToolCalls.innerHTML = ''
  exportedArtifact = null
  conversation = []
  currentDrafts = []
  modelCallState.clear()
  toolCallState.clear()
  renderedTranscriptKeys.clear()
  renderedTimelineKeys.clear()
  pendingUiEvents.length = 0
  uiFlushScheduled = false
  isRunActive = false
  setPendingIndicator(false)
  authorFollowupButton.disabled = false
  if (authorInlineSendButton) authorInlineSendButton.disabled = false
  setSessionPill('未開始')
}

function appendDiagramTranscript(question) {
  if (!question?.diagramImage) return
  const key = `diagram-image::${question.questionNumber || ''}::${question.diagramImage.slice(0, 64)}`
  if (renderedTranscriptKeys.has(key)) return
  renderedTranscriptKeys.add(key)

  const item = document.createElement('article')
  item.className = 'dse-message assistant'

  const head = document.createElement('div')
  head.className = 'dse-message-head'
  const title = document.createElement('span')
  title.className = 'dse-message-title'
  title.textContent = '主 Agent'
  const meta = document.createElement('span')
  meta.className = 'dse-message-meta'
  meta.textContent = question.questionNumber ? `Q${question.questionNumber} diagram` : 'diagram'
  head.append(title, meta)

  const body = document.createElement('div')
  body.className = 'dse-message-body'
  const image = document.createElement('img')
  image.src = question.diagramImage
  image.alt = `Q${question.questionNumber || ''} diagram`
  image.className = 'inline-diagram'
  body.appendChild(image)

  item.append(head, body)
  authorChatHistory.appendChild(item)
  authorChatHistory.scrollTop = authorChatHistory.scrollHeight
}

function createPaperOverviewCard(question, index) {
  const wrapper = document.createElement('section')
  wrapper.className = 'paper-question-section'
  wrapper.dataset.questionNumber = question.questionNumber || `${index + 1}`

  const title = document.createElement('h3')
  title.textContent = `${question.questionNumber || index + 1}. ${question.title || '未命名題目'}`

  const summary = document.createElement('pre')
  summary.className = 'output'
  summary.textContent = [
    question.paperSection ? `Section：${question.paperSection}` : '',
    question.questionType ? `題型：${question.questionType}` : '',
    question.difficultyBand ? `難度：${question.difficultyBand}` : '',
    (question.topicTags || []).length ? `課題：${question.topicTags.join(' / ')}` : '',
    question.marks ? `分數：${question.marks}` : '',
    question.questionTextZh || question.questionTextEn || ''
  ].filter(Boolean).join('\n\n') || '尚未生成內容'

  wrapper.append(title, summary)
  return wrapper
}

function createDraftCard(question, index) {
  const wrapper = document.createElement('section')
  wrapper.className = 'paper-question-section'
  wrapper.dataset.questionNumber = question.questionNumber || `${index + 1}`

  const title = document.createElement('h3')
  title.textContent = `${question.questionNumber || index + 1}. ${question.title || '未命名題目'}`

  const meta = document.createElement('pre')
  meta.className = 'output'
  meta.textContent = [
    `題型：${question.questionType || ''}`,
    `難度：${question.difficultyBand || ''}`,
    `課題：${(question.topicTags || []).join(' / ')}`,
    question.mergeStatus ? `合併狀態：${question.mergeStatus}` : '',
    (question.parserWarnings || []).length ? `Parser warnings：${question.parserWarnings.join(' | ')}` : '',
    `驗算答案：${question.verification?.finalAnswer || question.answer || (question.questionTextZh || question.questionTextEn || question.draftText ? '生成中…' : '')}`,
    `Mark scheme 檢查：${question.markAssessment?.summary || (!question.markingScheme ? '評分指引生成中…' : (question.markAssessment?.isValid === false ? '需要調整' : '未檢查'))}`
  ].filter(Boolean).join('\n')

  const metaHead = document.createElement('div')
  metaHead.className = 'dse-draft-meta'
  const diagramBadge = document.createElement('div')
  diagramBadge.className = 'dse-inline-badge'
  diagramBadge.textContent = question.diagramPlan ? '已有 diagram draft' : (question.needsDiagram === 'required' ? '需要 diagram' : 'diagram optional')
  metaHead.append(title, diagramBadge)

  const questionZh = document.createElement('textarea')
  questionZh.rows = 6
  questionZh.value = question.questionTextZh || ''

  const questionEn = document.createElement('textarea')
  questionEn.rows = 6
  questionEn.value = question.questionTextEn || ''

  const rawDraft = document.createElement('textarea')
  rawDraft.rows = 6
  rawDraft.value = question.draftText || ''

  const rawSolution = document.createElement('textarea')
  rawSolution.rows = 8
  rawSolution.value = question.solutionText || ''

  const answer = document.createElement('textarea')
  answer.rows = 2
  answer.value = question.answer || (question.questionTextZh || question.questionTextEn ? '答案生成中…' : '')

  const working = document.createElement('textarea')
  working.rows = 6
  working.value = question.working || (question.questionTextZh || question.questionTextEn ? '解題過程生成中…' : '')

  const marking = document.createElement('textarea')
  marking.rows = 8
  marking.value = question.markingScheme || (question.questionTextZh || question.questionTextEn ? '評分指引生成中…' : '')

  const options = document.createElement('textarea')
  options.rows = 4
  options.value = (question.options || []).join('\n')

  const diagram = document.createElement('textarea')
  diagram.rows = 2
  diagram.value = question.diagramInstructions || ''

  const buttonRow = document.createElement('div')
  buttonRow.className = 'dse-draft-actions'

  const revalidateButton = document.createElement('button')
  revalidateButton.type = 'button'
  revalidateButton.textContent = '再次驗算'
  revalidateButton.addEventListener('click', async () => {
    revalidateButton.disabled = true
    try {
      const payload = {
        sessionId: currentSessionId,
        draft: {
          questionNumber: question.questionNumber,
          title: title.textContent.replace(/^\d+\.\s*/, ''),
          questionTextZh: questionZh.value,
          questionTextEn: questionEn.value,
          answer: answer.value,
          working: working.value,
          markingScheme: marking.value,
          options: options.value.split('\n').map(item => item.trim()).filter(Boolean),
          needsDiagram: question.needsDiagram || 'optional',
          diagramInstructions: diagram.value
        }
      }
      const response = await fetch('/api/dse-author/revalidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '再次驗算失敗')
      await refreshSession()
    } catch (error) {
      appendTranscriptEntry({
        entryType: 'system',
        title: '系統',
        body: error instanceof Error ? error.message : '再次驗算失敗',
        dedupeKey: `revalidate-error::${question.questionNumber || index}::${Date.now()}`
      })
    } finally {
      revalidateButton.disabled = false
    }
  })

  const exportButton = document.createElement('button')
  exportButton.type = 'button'
  exportButton.textContent = '下載本題 TXT'
  exportButton.addEventListener('click', () => {
    downloadBlob(`question-${question.questionNumber || index + 1}.txt`, buildQuestionExportText({
      ...question,
      questionTextZh: questionZh.value,
      questionTextEn: questionEn.value,
      answer: answer.value,
      working: working.value,
      markingScheme: marking.value,
      options: options.value.split('\n').map(item => item.trim()).filter(Boolean)
    }))
  })

  const diagramButton = document.createElement('button')
  diagramButton.type = 'button'
  diagramButton.textContent = '補 diagram'
  diagramButton.addEventListener('click', async () => {
    if (!currentSessionId) return
    diagramButton.disabled = true
    try {
      const message = `請為第 ${question.questionNumber} 題補一個 diagram。要求：${diagram.value || question.diagramInstructions || '依題意產生。'}`
      const response = await fetch('/api/dse-author/followup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, message })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '補圖失敗')
      await refreshSession()
    } catch (error) {
      appendTranscriptEntry({
        entryType: 'system',
        title: '系統',
        body: error instanceof Error ? error.message : '補圖失敗',
        dedupeKey: `diagram-error::${question.questionNumber || index}::${Date.now()}`
      })
    } finally {
      diagramButton.disabled = false
    }
  })

  buttonRow.append(revalidateButton, diagramButton, exportButton)

  wrapper.append(metaHead, meta)
  if (question.draftText) wrapper.append(buildLabeledBlock('Raw draft text', rawDraft))
  if (question.solutionText) wrapper.append(buildLabeledBlock('Raw solution / marking text', rawSolution))
  wrapper.append(buildLabeledBlock('中文題目', questionZh))
  wrapper.append(buildLabeledBlock('English version', questionEn))
  if ((question.options || []).length > 0 || question.questionType === 'mc') {
    wrapper.append(buildLabeledBlock('MC Options', options))
  }
  wrapper.append(buildLabeledBlock('答案', answer))
  wrapper.append(buildLabeledBlock('解題過程', working))
  wrapper.append(buildLabeledBlock('評分指引', marking))
  wrapper.append(buildLabeledBlock('圖形說明', diagram))
  const diagramPreview = renderDiagramPreview(question)
  if (diagramPreview) {
    wrapper.append(diagramPreview)
  }
  wrapper.append(buttonRow)
  return wrapper
}

function downloadBlob(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function renderDiagramPreview(question) {
  if (!question.diagramPlan && !question.diagramImage) return null
  const diagramPreview = document.createElement('div')
  diagramPreview.className = 'dse-diagram-preview'
  const previewTitle = document.createElement('strong')
  previewTitle.textContent = 'Diagram draft'
  diagramPreview.append(previewTitle)

  if (question.diagramImage) {
    const image = document.createElement('img')
    image.src = question.diagramImage
    image.alt = `Q${question.questionNumber || ''} diagram`
    image.className = 'inline-diagram'
    diagramPreview.appendChild(image)
  }

  if (question.diagramPlan) {
    const previewBody = document.createElement('pre')
    previewBody.className = 'output'
    previewBody.textContent = JSON.stringify(question.diagramPlan, null, 2)
    diagramPreview.appendChild(previewBody)
  }

  return diagramPreview
}

function buildQuestionExportText(question) {
  return [
    `${question.questionNumber || ''}. ${question.title || ''}`,
    '',
    question.questionTextZh || question.questionTextEn || '',
    question.answer ? `答案：${question.answer}` : '',
    question.working ? `解題：\n${question.working}` : '',
    question.markingScheme ? `評分：\n${question.markingScheme}` : ''
  ].filter(Boolean).join('\n\n')
}

function buildLabeledBlock(label, element) {
  const wrapper = document.createElement('label')
  wrapper.className = 'field'
  const span = document.createElement('span')
  span.textContent = label
  wrapper.append(span, element)
  return wrapper
}

function renderDrafts() {
  authorDraftList.innerHTML = ''
  const isPaperMode = (modeSelect?.value || 'single') === 'paper'
  currentDrafts.forEach((question, index) => {
    authorDraftList.appendChild(isPaperMode ? createPaperOverviewCard(question, index) : createDraftCard(question, index))
    appendDiagramTranscript(question)
  })
  if (isPaperMode && currentDrafts.length === 0) {
    const empty = document.createElement('pre')
    empty.className = 'output'
    empty.textContent = '整卷模式會先顯示整卷任務進度；如已有已生成題目，這裡會列出各題 overview。'
    authorDraftList.appendChild(empty)
  }
}

function buildPaperProgressSummary(data, questionTasks, exportedArtifact) {
  const total = questionTasks.length
  const verified = questionTasks.filter(task => task?.stages?.verify === 'done').length

  if (total > 0) {
    const firstTask = questionTasks[0]
    return `進度 ${verified}/${total}｜Q${firstTask.questionNumber} d:${firstTask.stages?.draft || 'pending'} s:${firstTask.stages?.solution || 'pending'} v:${firstTask.stages?.verify || 'pending'}`
  }

  if (exportedArtifact?.generatedAt) {
    return `已匯出｜${exportedArtifact.generatedAt}`
  }

  return '尚未生成'
}

async function refreshSession() {
  if (!currentSessionId) return
  const response = await fetch(`/api/dse-author/session?sessionId=${encodeURIComponent(currentSessionId)}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '無法讀取會話')
  currentDrafts = Array.isArray(data.generatedQuestions) ? data.generatedQuestions : []
  const questionTasks = Array.isArray(data.questionTasks) ? data.questionTasks : []
  exportedArtifact = data.exportArtifact || null
  renderDrafts()
  setDraftStatus(buildPaperProgressSummary(data, questionTasks, exportedArtifact) || '生成草稿')
  setSessionPill(data.agentState?.status || 'active')
  ;(data.toolCalls || []).forEach(toolCall => updateToolCall(toolCall, toolCall.status === 'failed' ? 'failed' : toolCall.status === 'done' ? 'done' : 'started'))
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
      setSessionPill('connected')
      resolve()
    }
    eventSource.onerror = () => {
      if (!opened) setDraftStatus('事件流連線失敗')
    }
    const bind = name => {
      eventSource.addEventListener(name, async event => {
        const payload = JSON.parse(event.data)
        scheduleUiEvent(name, payload)

        if (name === 'author_agent_turn_started' || name === 'author_tool_call_started' || name === 'author_subagent_started') {
          isRunActive = true
          authorFollowupButton.disabled = true
          if (authorInlineSendButton) authorInlineSendButton.disabled = true
        }

        if (name === 'author_followup_requested') {
          if (payload?.question) {
            if (authorInlineSendButton) authorInlineSendButton.disabled = false
            setSessionPill('waiting_teacher')
          }
        }
        if (name === 'author_agent_turn_started') setSessionPill('thinking')
        if (name === 'author_waiting_teacher') {
          isRunActive = false
          authorFollowupButton.disabled = false
          if (authorInlineSendButton) authorInlineSendButton.disabled = false
          setSessionPill('waiting_teacher')
        }
        if (name === 'author_run_finished' || name === 'author_session_ready') {
          isRunActive = false
          authorFollowupButton.disabled = false
          if (authorInlineSendButton) authorInlineSendButton.disabled = false
          setSessionPill('ready')
          await refreshSession()
        }
        if (name === 'author_tool_call_done') {
          await refreshSession()
        }
        if (name === 'session_error') {
          isRunActive = false
          setDraftStatus(payload.message || '流程錯誤')
          setSessionPill('error')
          authorFollowupButton.disabled = false
          if (authorInlineSendButton) authorInlineSendButton.disabled = false
        }
        if (name === 'model_call_started') updateModelCall(payload, 'started')
        if (name === 'model_call_delta') updateModelCall(payload, 'delta')
        if (name === 'model_call_done') updateModelCall(payload, 'done')
        if (name === 'model_call_failed') updateModelCall(payload, 'failed')
        if (name === 'author_tool_call_started') updateToolCall(payload, 'started')
        if (name === 'author_tool_call_done') updateToolCall(payload, 'done')
        if (name === 'author_tool_call_failed') updateToolCall(payload, 'failed')
      })
    }

    ;[
      'session_started', 'input_received', 'author_intake_started', 'author_intake_done', 'author_followup_requested',
      'author_blueprint_started', 'author_blueprint_done', 'author_question_started', 'author_question_done',
      'author_verification_started', 'author_verification_done', 'author_paper_compiled', 'author_session_ready',
      'author_agent_turn_started', 'author_agent_message', 'author_agent_action_selected', 'author_tool_call_started',
      'author_tool_call_done', 'author_tool_call_failed', 'author_subagent_started', 'author_subagent_done',
      'author_subagent_failed', 'author_verification_conflict', 'author_waiting_teacher', 'author_question_task_queued',
      'author_question_task_started', 'author_question_task_stage_done', 'author_question_task_merged', 'author_question_task_failed', 'author_run_finished',
      'model_call_started', 'model_call_delta', 'model_call_done', 'model_call_failed', 'final_explanation_done', 'session_error'
    ].forEach(bind)
  })
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
  providerSelect.value = 'api1'
}

function buildBootstrapRequestBody(messageOverride = '') {
  const bootstrapMessage = String(messageOverride || bootstrapFollowupInput?.value || '').trim()
  const teacherGoal = teacherGoalInput.value.trim() || bootstrapMessage || '請開始規劃 DSE 出題工作。'
  const requestBody = {
    providerId: providerSelect.value || 'api1',
    mode: modeSelect.value,
    questionType: questionTypeSelect.value,
    paperType: paperTypeSelect.value,
    language: languageSelect.value,
    difficultyBand: difficultySelect.value,
    mustHaveQuestionCount: Number(questionCountInput.value) || 1,
    marksPerQuestion: Number(marksInput.value) || 4,
    topicCoverage: normalizeCsv(topicsInput.value),
    avoidTopics: normalizeCsv(avoidTopicsInput.value),
    needsDiagram: diagramSelect.value,
    useRealWorldContext: realWorldCheckbox.checked,
    teacherGoal,
    customConstraints: constraintsInput.value.trim(),
    conversation: bootstrapMessage ? [] : []
  }
  return requestBody
}

function buildRequestBody() {
  return {
    providerId: providerSelect.value || 'api1',
    mode: modeSelect.value,
    questionType: questionTypeSelect.value,
    paperType: paperTypeSelect.value,
    language: languageSelect.value,
    difficultyBand: difficultySelect.value,
    mustHaveQuestionCount: Number(questionCountInput.value) || 1,
    marksPerQuestion: Number(marksInput.value) || 4,
    topicCoverage: normalizeCsv(topicsInput.value),
    avoidTopics: normalizeCsv(avoidTopicsInput.value),
    needsDiagram: diagramSelect.value,
    useRealWorldContext: realWorldCheckbox.checked,
    teacherGoal: teacherGoalInput.value.trim(),
    customConstraints: constraintsInput.value.trim(),
    conversation
  }
}

async function ensureSessionStarted(initialMessage = '') {
  if (currentSessionId) return currentSessionId
  currentSessionId = crypto.randomUUID()
  await connectEvents(currentSessionId)
  appendTimeline('session_created', { sessionId: currentSessionId })
  appendRawEvent('session_created', { sessionId: currentSessionId })
  setSessionPill('starting')

  const bootstrapMessage = String(initialMessage || '').trim()
  if (bootstrapMessage) {
    appendTranscriptEntry({
      entryType: 'user',
      title: '老師',
      body: bootstrapMessage,
      dedupeKey: `bootstrap-user::${bootstrapMessage}`
    })
  }

  const response = await fetch('/api/dse-author/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: currentSessionId, ...buildBootstrapRequestBody(initialMessage) })
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '出題失敗')
  if (bootstrapFollowupInput) bootstrapFollowupInput.value = ''
  toggleModal(settingsModal, false)
  return currentSessionId
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  generateButton.disabled = true
  isRunActive = true
  try {
    resetView()
    await ensureSessionStarted(String(bootstrapFollowupInput?.value || '').trim())
  } catch (error) {
    setDraftStatus(error instanceof Error ? error.message : '出題失敗')
    setSessionPill('error')
    closeEvents()
    currentSessionId = ''
  } finally {
    generateButton.disabled = false
  }
})

authorFollowupForm.addEventListener('submit', async event => {
  event.preventDefault()
  const message = authorFollowupInput.value.trim()
  if (!message) return
  if (isRunActive) return
  authorInlineSendButton.disabled = true
  try {
    if (!currentSessionId) {
      resetView()
      await ensureSessionStarted(message)
      return
    }
    appendTranscriptEntry({
      entryType: 'user',
      title: '老師',
      body: message,
      dedupeKey: `user-followup::${message}::${Date.now()}`
    })
    conversation.push({ role: 'user', content: message })
    authorFollowupInput.value = ''
    authorFollowupButton.disabled = true
    setSessionPill('thinking')
    setPendingIndicator(true, '主 Agent 正在處理…')
    await new Promise(resolve => setTimeout(resolve, 120))
    const response = await fetch('/api/dse-author/followup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, message })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || '補充失敗')
  } catch (error) {
    setPendingIndicator(false)
    appendTranscriptEntry({
      entryType: 'system',
      title: '系統',
      body: error instanceof Error ? error.message : '補充失敗',
      dedupeKey: `followup-error::${Date.now()}`
    })
    authorFollowupButton.disabled = false
    setSessionPill(currentSessionId ? 'ready' : 'error')
  } finally {
    authorInlineSendButton.disabled = false
  }
})

if (downloadPaperTextButton) {
  downloadPaperTextButton.addEventListener('click', () => {
    const content = exportedArtifact?.text || currentDrafts.map(buildQuestionExportText).join('\n\n----------------\n\n') || '尚未生成內容'
    downloadBlob(`dse-paper-${currentSessionId || 'draft'}.txt`, content)
  })
}

if (downloadPaperJsonButton) {
  downloadPaperJsonButton.addEventListener('click', () => {
    downloadBlob(`dse-paper-${currentSessionId || 'draft'}.json`, JSON.stringify({ sessionId: currentSessionId, generatedQuestions: currentDrafts, exportArtifact: exportedArtifact }, null, 2), 'application/json;charset=utf-8')
  })
}

modeSelect.addEventListener('change', () => {
  syncModeForm()
  renderDrafts()
})
setupModalInteractions()
setupWorkbenchSplitPane()
setupVerticalSplitPane()
syncModeForm()

loadProviders().catch(error => {
  setDraftStatus(error instanceof Error ? error.message : '無法載入 API 提供者列表')
  setSessionPill('error')
})

