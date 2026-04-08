const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'gpt-5.4'
const API_URL = (process.env.ANTHROPIC_BASE_URL || '').replace(/\/$/, '')
const AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || ''

function ensureConfig() {
  if (!API_URL) {
    throw new Error('缺少 ANTHROPIC_BASE_URL')
  }
  if (!AUTH_TOKEN) {
    throw new Error('缺少 ANTHROPIC_AUTH_TOKEN')
  }
}

function extractTextFromContentBlock(block) {
  if (!block || typeof block !== 'object') return ''
  if (block.type === 'text' && typeof block.text === 'string') return block.text
  return ''
}

async function readStream(response, onDelta) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''

    for (const part of parts) {
      const lines = part.split('\n')
      let eventType = ''
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim()
        if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data) continue
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const deltaText = parsed?.delta?.text || parsed?.content_block?.text || parsed?.text || ''
        if (deltaText) {
          fullText += deltaText
          onDelta?.(deltaText, eventType)
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }

  return fullText
}

export async function requestModel({ system, user, stream = false, onDelta }) {
  ensureConfig()

  const response = await fetch(`${API_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': AUTH_TOKEN,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: 4000,
      stream,
      system,
      messages: [
        {
          role: 'user',
          content: user
        }
      ]
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`模型请求失败: ${response.status} ${text}`)
  }

  if (stream) {
    const text = await readStream(response, onDelta)
    return { text }
  }

  const json = await response.json()
  const text = Array.isArray(json.content)
    ? json.content.map(extractTextFromContentBlock).join('')
    : ''

  return { text, raw: json }
}

export async function solveProblem(promptConfig, onDelta) {
  return requestModel({
    system: promptConfig.system,
    user: promptConfig.user(),
    stream: true,
    onDelta
  })
}

export async function judgeSolutions(promptConfig, onDelta) {
  return requestModel({
    system: promptConfig.system,
    user: promptConfig.user(),
    stream: true,
    onDelta
  })
}

export async function planDiagram(promptConfig) {
  return requestModel({
    system: promptConfig.system,
    user: promptConfig.user(),
    stream: false
  })
}
