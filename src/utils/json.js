export function parseJsonFromText(text) {
  const trimmed = String(text || '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('模型未返回合法 JSON')
  }
  return JSON.parse(trimmed.slice(start, end + 1))
}
