const form = document.querySelector('#solve-form')
const providerSelect = document.querySelector('#provider-select')
const textInput = document.querySelector('#text-input')
const imageInput = document.querySelector('#image-input')
const solveButton = document.querySelector('#solve-button')
const diagramButton = document.querySelector('#diagram-button')
const timeline = document.querySelector('#timeline')
const judgeOutput = document.querySelector('#judge')
const judgeStreamOutput = document.querySelector('#judge-stream')
const diagramStreamOutput = document.querySelector('#diagram-stream')
const finalExplanationStreamOutput = document.querySelector('#final-explanation-stream')
const diagramStatusOutput = document.querySelector('#diagram-status')
const finalAnswerOutput = document.querySelector('#final-answer')
const diagramAdviceOutput = document.querySelector('#diagram-advice')
const finalExplanationRendered = document.querySelector('#final-explanation-rendered')
const finalExplanationRawOutput = document.querySelector('#final-explanation-raw')
const finalExplanationNormalizedOutput = document.querySelector('#final-explanation-normalized')
const diagramContainer = document.querySelector('#diagram-container')

const FLOW_MODE = 'simple'

const TIMELINE_EVENTS = new Set([
  'events_connected',
  'session_created',
  'session_started',
  'input_received',
  'problem_normalized',
  'judge_started',
  'judge_done',
  'final_answer_ready',
  'diagram_started',
  'diagram_llm_started',
  'diagram_attempt_failed',
  'diagram_retrying',
  'diagram_done',
  'diagram_error',
  'final_explanation_started',
  'final_explanation_done',
  'stage_repairing',
  'stage_compact_retry',
  'stage_failed',
  'session_error'
])

const TIMELINE_LABELS = {
  events_connected: '事件流已連線',
  session_created: '會話已建立',
  session_started: '開始處理題目',
  input_received: '已收到輸入',
  problem_normalized: '題目標準化完成',
  judge_started: 'Judge 開始',
  judge_done: 'Judge 完成',
  final_answer_ready: '最終答案已產生',
  diagram_started: '開始生成圖形',
  diagram_llm_started: '畫圖 AI 開始',
  diagram_attempt_failed: 'Python 執行失敗',
  diagram_retrying: '準備重試作圖',
  diagram_done: '圖形生成完成',
  diagram_error: '圖形生成失敗',
  final_explanation_started: '最終講解開始',
  final_explanation_done: '最終講解完成',
  stage_repairing: '模型重發中',
  stage_compact_retry: '精簡重發中',
  stage_failed: '階段失敗',
  session_error: '流程錯誤'
}

let currentSessionId = ''
let eventSource = null
let currentDiagramImageUrl = ''
let providerRegistry = { defaultProviderId: '', providers: [] }
let finalExplanationRenderTimer = null
let finalExplanationRawText = ''

function normalizeDisplayText(text) {
  if (typeof text !== 'string') return ''

  return text
    .replaceAll('\\r\\n', '\n')
    .replaceAll('\\n', '\n')
    .replaceAll(/\\quad/g, ' ')
    .replaceAll(/\\,/g, ' ')
    .replaceAll(/[ \t]+\n/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .replaceAll(/[ \t]{2,}/g, ' ')
    .trim()
}

function setFinalExplanationStatus(message) {
  finalExplanationStreamOutput.textContent = message
}

function formatDiagramAdvice(payload) {
  const decisionMap = {
    required: '需要畫圖，系統將自動生成。',
    optional: '可選畫圖，由你決定是否生成。',
    unnecessary: '通常不需要畫圖，但你仍可手動要求生成。'
  }

  return [
    payload.providerLabel ? `API: ${payload.providerLabel}` : '',
    `判定: ${payload.diagramDecision || 'optional'}`,
    `建議: ${decisionMap[payload.diagramDecision] || decisionMap.optional}`,
    payload.diagramReason ? `原因: ${payload.diagramReason}` : ''
  ].filter(Boolean).join('\n')
}

function appendTimeline(title, payload) {
  if (!TIMELINE_EVENTS.has(title)) return

  const item = document.createElement('div')
  item.className = 'timeline-item'

  const label = TIMELINE_LABELS[title] || title
  let detail = ''

  if (title === 'session_created' || title === 'events_connected') {
    detail = payload?.sessionId || ''
  } else if (title === 'session_error') {
    detail = payload?.message || ''
  } else if (title === 'stage_repairing' || title === 'stage_compact_retry' || title === 'stage_failed') {
    detail = [payload?.stage || '', payload?.message || ''].filter(Boolean).join('：')
  } else if (title === 'final_answer_ready') {
    detail = payload?.finalAnswer || ''
  }

  item.innerHTML = detail
    ? `<strong>${label}</strong><span>${detail}</span>`
    : `<strong>${label}</strong>`

  timeline.prepend(item)
}

function renderMath(container) {
  if (typeof window.renderMathInElement !== 'function') {
    return
  }

  window.renderMathInElement(container, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\(', right: '\\)', display: false },
      { left: '\\[', right: '\\]', display: true }
    ],
    throwOnError: false
  })
}

function scheduleFinalExplanationRender(force = false) {
  if (force) {
    if (finalExplanationRenderTimer) {
      clearTimeout(finalExplanationRenderTimer)
      finalExplanationRenderTimer = null
    }
    renderMath(finalExplanationRendered)
    return
  }

  if (finalExplanationRenderTimer) {
    clearTimeout(finalExplanationRenderTimer)
  }

  finalExplanationRenderTimer = setTimeout(() => {
    finalExplanationRenderTimer = null
    renderMath(finalExplanationRendered)
  }, 400)
}

function renderFinalExplanationText(text, options = {}) {
  const rawDisplayText = normalizeDisplayText(options.rawText ?? text)
  const normalizedDisplayText = normalizeDisplayText(text)
  finalExplanationRawOutput.textContent = rawDisplayText || '尚未生成最終講解'
  finalExplanationNormalizedOutput.textContent = normalizedDisplayText || '尚未生成正規化文本'
  finalExplanationRendered.innerHTML = ''

  const body = document.createElement('div')
  body.className = 'explanation-text'
  body.textContent = normalizedDisplayText
  finalExplanationRendered.appendChild(body)

  scheduleFinalExplanationRender(Boolean(options.final))
}

function resetView() {
  finalExplanationRenderTimer = null
  finalExplanationRawText = ''
  timeline.innerHTML = ''
  judgeOutput.textContent = ''
  judgeStreamOutput.textContent = ''
  diagramStreamOutput.textContent = ''
  finalExplanationStreamOutput.textContent = '本階段採用穩定模式，等待完整講解返回。'
  diagramStatusOutput.textContent = ''
  finalAnswerOutput.textContent = ''
  diagramAdviceOutput.textContent = ''
  currentDiagramImageUrl = ''
  finalExplanationRawOutput.textContent = '尚未生成最終講解'
  finalExplanationNormalizedOutput.textContent = '尚未生成正規化文本'
  finalExplanationRendered.innerHTML = '<p class="empty">尚未生成最終講解</p>'
  diagramContainer.innerHTML = '<p class="empty">尚未生成圖形</p>'
  diagramButton.disabled = true
  diagramButton.textContent = '生成圖形'
}

async function loadProviders() {
  const response = await fetch('/api/providers')
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || '無法載入 API 提供者列表')
  }

  providerRegistry = data
  providerSelect.innerHTML = ''

  data.providers.forEach(provider => {
    const option = document.createElement('option')
    option.value = provider.id
    option.textContent = `${provider.label}｜${provider.modelHint}`
    providerSelect.appendChild(option)
  })

  providerSelect.value = data.defaultProviderId || data.providers[0]?.id || ''
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve({
        base64,
        mediaType: file.type || 'image/png'
      })
    }
    reader.onerror = () => reject(new Error('圖片讀取失敗'))
    reader.readAsDataURL(file)
  })
}

function closeEvents() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
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
      resolve()
    }

    eventSource.onerror = () => {
      if (!opened) {
        finalAnswerOutput.textContent = '事件流連線失敗'
      }
    }

    const bind = (eventName, handler) => {
      eventSource.addEventListener(eventName, event => {
        const payload = JSON.parse(event.data)
        appendTimeline(eventName, payload)
        handler(payload)
      })
    }

    bind('session_started', () => {})
    bind('input_received', () => {})
    bind('judge_started', () => {})
    bind('diagram_started', () => {})
    bind('final_explanation_started', payload => {
      finalExplanationRawText = ''
      finalExplanationRawOutput.textContent = '最終講解生成中...'
      finalExplanationNormalizedOutput.textContent = '正規化文本生成中...'
      finalExplanationRendered.innerHTML = '<p class="empty">最終講解生成中...</p>'
      setFinalExplanationStatus(payload?.mode === 'stable'
        ? '本階段採用穩定模式，等待完整講解返回。'
        : '最終講解流式生成中。')
    })

    bind('problem_normalized', payload => {
      finalAnswerOutput.textContent = `標準化題目：\n${JSON.stringify(payload, null, 2)}`
    })

    bind('judge_delta', payload => {
      judgeStreamOutput.textContent += payload.delta || ''
    })

    bind('judge_done', payload => {
      judgeOutput.textContent = JSON.stringify(payload, null, 2)
      diagramAdviceOutput.textContent = formatDiagramAdvice(payload)
    })

    bind('diagram_llm_delta', payload => {
      diagramStreamOutput.textContent += payload.delta || ''
    })

    bind('final_explanation_delta', payload => {
      if (payload?.delta) {
        finalExplanationRawText = payload.rawText || `${finalExplanationRawText}${payload.delta}`
        renderFinalExplanationText(payload.text || finalExplanationRawText, {
          rawText: finalExplanationRawText
        })
        setFinalExplanationStatus('最終講解流式生成中。')
      }
    })

    bind('stage_repairing', payload => {
      const message = `[${payload.stage}] 正在要求模型完整重發\n${payload.message || ''}`
      finalAnswerOutput.textContent = message
    })

    bind('stage_compact_retry', payload => {
      const message = `[${payload.stage}] 正在要求模型精簡重發\n${payload.message || ''}`
      finalAnswerOutput.textContent = message
    })

    bind('stage_failed', payload => {
      const message = `[${payload.stage}] ${payload.fallback ? '已使用保底結果' : '多次重發後仍失敗'}\n${payload.message || ''}`
      finalAnswerOutput.textContent = message
    })

    bind('diagram_attempt_failed', payload => {
      diagramStatusOutput.textContent += `\n[嘗試 ${payload.attempt}] Python 執行失敗\n${payload.error}\n`
    })

    bind('diagram_retrying', payload => {
      diagramStatusOutput.textContent += `\n準備第 ${payload.nextAttempt} 次重試\n`
    })

    bind('final_answer_ready', payload => {
      finalAnswerOutput.textContent = JSON.stringify(payload, null, 2)
      diagramAdviceOutput.textContent = formatDiagramAdvice(payload)

      if (payload.diagramDecision === 'required') {
        diagramButton.disabled = true
        diagramButton.textContent = '自動生成中'
      } else {
        diagramButton.disabled = false
        diagramButton.textContent = '生成圖形'
      }
    })

    bind('final_explanation_done', payload => {
      finalExplanationRawText = payload?.rawText || finalExplanationRawText
      renderFinalExplanationText(payload?.text || finalExplanationRawText, {
        rawText: finalExplanationRawText,
        final: true
      })
      setFinalExplanationStatus('最終講解已完成，以上為正式學生版講解。')
    })

    bind('diagram_done', payload => {
      diagramButton.textContent = '生成圖形'
      diagramStatusOutput.textContent += `\n[嘗試 ${payload.attempt}] 圖形生成成功\n`
      currentDiagramImageUrl = payload.imageDataUrl
      diagramContainer.innerHTML = ''
      const image = document.createElement('img')
      image.src = payload.imageDataUrl
      image.alt = '數學題示意圖'
      diagramContainer.appendChild(image)
    })

    bind('diagram_error', payload => {
      diagramButton.disabled = false
      diagramButton.textContent = '生成圖形'
      diagramStatusOutput.textContent += `\n作圖最終失敗\n${payload.message || ''}\n`
    })

    bind('session_error', payload => {
      if (payload?.message) {
        finalAnswerOutput.textContent = payload.message
      }
    })
  })
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  resetView()

  const text = textInput.value.trim()
  const file = imageInput.files?.[0]

  if (!text && !file) {
    finalAnswerOutput.textContent = '請輸入文字題或選擇圖片。'
    return
  }

  if (text && file) {
    finalAnswerOutput.textContent = '文字與圖片只能二選一。'
    return
  }

  solveButton.disabled = true

  try {
    const solvePayload = text
      ? { text }
      : await (async () => {
          const image = await readFileAsBase64(file)
          return {
            imageBase64: image.base64,
            mediaType: image.mediaType
          }
        })()

    currentSessionId = crypto.randomUUID()
    await connectEvents(currentSessionId)
    appendTimeline('session_created', { sessionId: currentSessionId })

    const response = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        providerId: providerSelect.value,
        mode: FLOW_MODE,
        ...solvePayload
      })
    })

    const result = await response.json()
    if (!response.ok) {
      throw new Error(result.error || '解題請求失敗')
    }
  } catch (error) {
    finalAnswerOutput.textContent = error instanceof Error ? error.message : '解題失敗'
    closeEvents()
  } finally {
    solveButton.disabled = false
  }
})

diagramButton.addEventListener('click', async () => {
  if (!currentSessionId) return

  diagramButton.disabled = true

  try {
    const response = await fetch('/api/diagram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId })
    })

    const result = await response.json()
    if (!response.ok) {
      throw new Error(result.error || '圖形生成失敗')
    }
  } catch (error) {
    diagramButton.disabled = false
    finalAnswerOutput.textContent = error instanceof Error ? error.message : '圖形生成失敗'
  }
})

loadProviders().catch(error => {
  finalAnswerOutput.textContent = error instanceof Error ? error.message : '載入 API 提供者失敗'
})
