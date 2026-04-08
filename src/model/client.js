import OpenAI, { AzureOpenAI } from 'openai'
import { createReadStream, readFile, writeFile, unlink } from 'node:fs'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureModelConfig } from './config.js'

const readFileAsync = promisify(readFile)
const writeFileAsync = promisify(writeFile)
const unlinkAsync = promisify(unlink)
const execFileAsync = promisify(execFile)
const uploadedPdfFileIds = new Map()

function hasPdfFileInput(userContent) {
  return Array.isArray(userContent)
    && userContent.some(item => item?.type === 'file' && item.mimeType === 'application/pdf' && item.filePath)
}

async function uploadPdfFile(client, item, config) {
  const cacheKey = `${item.filePath || ''}:${item.fileName || ''}`
  if (uploadedPdfFileIds.has(cacheKey)) {
    return uploadedPdfFileIds.get(cacheKey)
  }

  const file = await client.files.create({
    file: createReadStream(item.filePath),
    purpose: config.providerType === 'azure-openai' ? 'assistants' : 'user_data'
  })

  uploadedPdfFileIds.set(cacheKey, file.id)
  return file.id
}

async function createResponsesInput(client, user, userContent, config) {
  const content = []

  if (typeof user === 'string' && user.trim()) {
    content.push({ type: 'input_text', text: user })
  }

  if (Array.isArray(userContent)) {
    for (const item of userContent) {
      if (item?.type === 'text') {
        content.push({ type: 'input_text', text: item.text || '' })
        continue
      }

      if (item?.type === 'image' && item.source?.type === 'base64') {
        content.push({
          type: 'input_image',
          image_url: `data:${item.source.media_type || 'image/png'};base64,${item.source.data}`,
          detail: 'auto'
        })
        continue
      }

      if (item?.type === 'file' && item.mimeType === 'application/pdf' && item.filePath) {
        const fileId = await uploadPdfFile(client, item, config)
        content.push({
          type: 'input_file',
          ...(config.providerType === 'openai-compatible' && item.fileName ? { filename: item.fileName || 'paper.pdf' } : {}),
          file_id: fileId
        })
      }
    }
  }

  return [{ role: 'user', content }]
}

function toChatContent(user, userContent) {
  if (Array.isArray(userContent)) {
    return userContent.map(item => {
      if (item.type === 'text') {
        return {
          type: 'text',
          text: item.text || ''
        }
      }

      if (item.type === 'image' && item.source?.type === 'base64') {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${item.source.media_type || 'image/png'};base64,${item.source.data}`
          }
        }
      }

      if (item.type === 'file' && item.mimeType === 'application/pdf') {
        return {
          type: 'text',
          text: [
            `PDF_FILE_PATH: ${item.filePath || ''}`,
            `PDF_FILE_NAME: ${item.fileName || 'paper.pdf'}`,
            '請把這個 PDF 當成整份文件閱讀。'
          ].join('\n')
        }
      }

      return null
    }).filter(Boolean)
  }

  if (typeof userContent === 'string') {
    return userContent
  }

  return user || ''
}

async function toGeminiParts(user, userContent) {
  const parts = []

  if (typeof user === 'string' && user.trim()) {
    parts.push({ text: user })
  }

  if (!Array.isArray(userContent)) {
    if (typeof userContent === 'string' && userContent.trim()) {
      parts.push({ text: userContent })
    }
    return parts
  }

  for (const item of userContent) {
    if (item?.type === 'text') {
      parts.push({ text: item.text || '' })
      continue
    }

    if (item?.type === 'image' && item.source?.type === 'base64') {
      parts.push({
        inlineData: {
          mimeType: item.source.media_type || 'image/png',
          data: item.source.data || ''
        }
      })
      continue
    }

    if (item?.type === 'file' && item.mimeType === 'application/pdf' && item.filePath) {
      const pdfBuffer = await readFileAsync(item.filePath)
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBuffer.toString('base64')
        }
      })
    }
  }

  return parts
}

async function requestGeminiApi({ config, body, stream, onDelta }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`
  const payloadPath = join(tmpdir(), `gemini-request-${randomUUID()}.json`)

  try {
    await writeFileAsync(payloadPath, JSON.stringify(body), 'utf8')
    const { stdout } = await execFileAsync('curl', [
      '--http1.1',
      '-sS',
      '--max-time', '300',
      '-H', 'Content-Type: application/json',
      '-X', 'POST',
      endpoint,
      '--data-binary', `@${payloadPath}`
    ], {
      env: {
        ...process.env,
        https_proxy: process.env.https_proxy || 'http://127.0.0.1:7890',
        http_proxy: process.env.http_proxy || 'http://127.0.0.1:7890',
        all_proxy: process.env.all_proxy || 'socks5://127.0.0.1:7890'
      },
      maxBuffer: 50 * 1024 * 1024
    })

    const payload = JSON.parse(stdout || '{}')
    if (!stream) {
      return payload
    }

    const text = extractGeminiText(payload)
    if (text) onDelta?.(text)
    return [payload]
  } finally {
    await unlinkAsync(payloadPath).catch(() => {})
  }
}

function extractGeminiText(payload) {
  return (payload?.candidates || [])
    .flatMap(candidate => candidate?.content?.parts || [])
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('')
}

function createClient(providerId) {
  const config = ensureModelConfig(providerId)

  if (config.providerType === 'azure-openai') {
    return {
      client: new AzureOpenAI({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        deployment: config.deployment,
        apiVersion: config.apiVersion
      }),
      config
    }
  }

  if (config.providerType === 'gemini') {
    return {
      client: null,
      config
    }
  }

  return {
    client: new OpenAI({
      apiKey: config.apiKey,
      baseURL: `${config.baseUrl.replace(/\/$/, '')}/v1`
    }),
    config
  }
}

function getPdfSupportErrorMessage(config) {
  return `目前 API「${config.label || config.id || 'unknown'}」不支援 PDF 直接閱讀，請切換 API 後再試。`
}

function normalizeTextContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') {
          return item.text
        }
        return ''
      })
      .join('')
  }

  return ''
}

function isRetryableError(error) {
  const status = error?.status
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetries(task) {
  let lastError = null

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (!isRetryableError(error) || attempt === 3) {
        throw error
      }
      await sleep(600 * attempt)
    }
  }

  throw lastError
}

function getMaxCompletionTokens(promptConfig, fallback) {
  if (typeof promptConfig?.maxCompletionTokens === 'number' && Number.isFinite(promptConfig.maxCompletionTokens)) {
    return promptConfig.maxCompletionTokens
  }
  return fallback
}

async function withScheduler(task, options = {}) {
  const scheduler = globalThis.__AI_SCHEDULER__
  if (!scheduler?.schedule || options?.bypassScheduler) {
    return task()
  }
  return scheduler.schedule(task)
}

function requestModelDebugLabel(system = '') {
  const text = String(system || '')
  if (text.includes('修復上一版裁決 JSON')) return 'judge_repair'
  if (text.includes('數學裁決助手')) return 'judge_main'
  if (text.includes('HKDSE Math Core marking scheme assessor')) return 'mark_assessment'
  if (text.includes('審核給定題目的評分指引')) return 'mark_review'
  if (text.includes('DSE 出題系統的老師版說明助手')) return 'teacher_summary'
  return 'other'
}

async function requestGeminiModel({ config, system, user, userContent, stream, onDelta, maxCompletionTokens, schedulerOptions = null }) {
  const parts = await toGeminiParts(user, userContent)
  const body = {
    systemInstruction: system ? {
      parts: [{ text: system }]
    } : undefined,
    generationConfig: {
      maxOutputTokens: Math.max(maxCompletionTokens, 4096),
      temperature: 0.2
    },
    contents: [{
      role: 'user',
      parts
    }]
  }

  if (stream) {
    return withScheduler(() => withRetries(async () => {
      const chunks = await requestGeminiApi({ config, body, stream: true, onDelta })
      const text = chunks.map(extractGeminiText).join('')
      return { text, raw: chunks }
    }), schedulerOptions)
  }

  return withScheduler(() => withRetries(async () => {
    const response = await requestGeminiApi({ config, body, stream: false, onDelta })
    const text = extractGeminiText(response)
    return { text, raw: response }
  }), schedulerOptions)
}

export async function requestModel({ providerId, system, user, userContent, stream = false, onDelta, maxCompletionTokens = 4000, schedulerOptions = null }) {
  const { client, config } = createClient(providerId)
  const hasPdfInput = hasPdfFileInput(userContent)

  globalThis.__REQUEST_MODEL_DEBUG__ = globalThis.__REQUEST_MODEL_DEBUG__ || []
  globalThis.__REQUEST_MODEL_DEBUG__.push({
    at: new Date().toISOString(),
    label: requestModelDebugLabel(system),
    providerId,
    providerType: config.providerType,
    stream,
    systemLength: String(system || '').length,
    userType: Array.isArray(user) ? 'array' : typeof user,
    userLength: typeof user === 'string' ? user.length : -1,
    userContentType: Array.isArray(userContent) ? 'array' : typeof userContent,
    userContentLength: typeof userContent === 'string' ? userContent.length : -1,
    contentPreview: typeof userContent === 'string'
      ? userContent.slice(0, 160)
      : (typeof user === 'string' ? user.slice(0, 160) : null)
  })
  if (globalThis.__REQUEST_MODEL_DEBUG__.length > 200) {
    globalThis.__REQUEST_MODEL_DEBUG__ = globalThis.__REQUEST_MODEL_DEBUG__.slice(-200)
  }

  if (hasPdfInput && !config.supportsPdfInput) {
    throw new Error(getPdfSupportErrorMessage(config))
  }

  if (hasPdfInput && config.providerType === 'openai-compatible') {
    throw new Error(getPdfSupportErrorMessage(config))
  }

  if (config.providerType === 'gemini') {
    return requestGeminiModel({ config, system, user, userContent, stream, onDelta, maxCompletionTokens, schedulerOptions })
  }

  if (hasPdfInput && config.providerType === 'azure-openai') {
    const input = await createResponsesInput(client, user, userContent, config)

    if (stream) {
      return withScheduler(() => withRetries(async () => {
        const response = await client.responses.create({
          model: config.model,
          instructions: system,
          input,
          max_output_tokens: maxCompletionTokens,
          stream: true
        })

        let text = ''
        for await (const event of response) {
          if (event.type !== 'response.output_text.delta') continue
          const deltaText = event.delta || ''
          if (!deltaText) continue
          text += deltaText
          onDelta?.(deltaText)
        }

        return { text }
      }), schedulerOptions)
    }

    return withScheduler(() => withRetries(async () => {
      const response = await client.responses.create({
        model: config.model,
        instructions: system,
        input,
        max_output_tokens: maxCompletionTokens
      })

      const text = response.output_text || (response.output || [])
        .flatMap(item => item.type === 'message' ? item.content || [] : [])
        .filter(item => item.type === 'output_text')
        .map(item => item.text || '')
        .join('')

      return { text, raw: response }
    }), schedulerOptions)
  }

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: toChatContent(user, userContent) }
  ]

  if (stream) {
    return withScheduler(() => withRetries(async () => {
      const response = await client.chat.completions.create({
        model: config.model,
        messages,
        max_completion_tokens: maxCompletionTokens,
        stream: true
      })

      let text = ''
      for await (const chunk of response) {
        const deltaText = normalizeTextContent(chunk.choices?.[0]?.delta?.content)
        if (!deltaText) continue
        text += deltaText
        onDelta?.(deltaText)
      }

      return { text }
    }), schedulerOptions)
  }

  return withScheduler(() => withRetries(async () => {
    const response = await client.chat.completions.create({
      model: config.model,
      messages,
      max_completion_tokens: maxCompletionTokens
    })

    const text = normalizeTextContent(response.choices?.[0]?.message?.content)
    return { text, raw: response }
  }), schedulerOptions)
}

export async function solveProblem(promptConfig, onDelta) {
  return requestModel({
    providerId: promptConfig.providerId,
    system: promptConfig.system,
    user: promptConfig.user?.(),
    userContent: promptConfig.userContent?.(),
    stream: typeof promptConfig.stream === 'boolean' ? promptConfig.stream : true,
    onDelta,
    maxCompletionTokens: getMaxCompletionTokens(promptConfig, 4000),
    schedulerOptions: promptConfig.schedulerOptions || null
  })
}

export async function judgeSolutions(promptConfig, onDelta) {
  return requestModel({
    providerId: promptConfig.providerId,
    system: promptConfig.system,
    user: promptConfig.user?.(),
    userContent: promptConfig.userContent?.(),
    stream: typeof promptConfig.stream === 'boolean' ? promptConfig.stream : true,
    onDelta,
    maxCompletionTokens: getMaxCompletionTokens(promptConfig, 4000),
    schedulerOptions: promptConfig.schedulerOptions || null
  })
}

export async function generateDiagramCode(promptConfig, onDelta) {
  return requestModel({
    providerId: promptConfig.providerId,
    system: promptConfig.system,
    user: promptConfig.user?.(),
    userContent: promptConfig.userContent?.(),
    stream: typeof promptConfig.stream === 'boolean' ? promptConfig.stream : true,
    onDelta,
    maxCompletionTokens: getMaxCompletionTokens(promptConfig, 4000),
    schedulerOptions: promptConfig.schedulerOptions || null
  })
}

export async function generateFinalExplanation(promptConfig, onDelta) {
  return requestModel({
    providerId: promptConfig.providerId,
    system: promptConfig.system,
    user: promptConfig.user?.(),
    stream: typeof promptConfig.stream === 'boolean' ? promptConfig.stream : true,
    onDelta,
    maxCompletionTokens: getMaxCompletionTokens(promptConfig, 8000),
    schedulerOptions: promptConfig.schedulerOptions || null
  })
}

export async function planDiagram(promptConfig) {
  return requestModel({
    providerId: promptConfig.providerId,
    system: promptConfig.system,
    user: promptConfig.user?.(),
    stream: false,
    schedulerOptions: promptConfig.schedulerOptions || null
  })
}
