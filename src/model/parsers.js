export function extractTextFromContentBlock(block) {
  if (!block || typeof block !== 'object') return ''
  if (block.type === 'text' && typeof block.text === 'string') return block.text
  return ''
}

export async function readStream(response, onDelta) {
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
      if (!data || data === '[DONE]') continue

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
