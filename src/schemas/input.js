function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeSolveMode(value) {
  return value === 'simple' || value === 'hard' ? value : 'hard'
}

export function validateSolveRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('請求體必須是 JSON 物件')
  }

  const hasText = isNonEmptyString(body.text)
  const hasImage = isNonEmptyString(body.imageBase64)

  if (!hasText && !hasImage) {
    throw new Error('必須提供 text 或 imageBase64')
  }

  if (hasText && hasImage) {
    throw new Error('text 與 imageBase64 只能二選一')
  }

  return {
    type: hasImage ? 'image' : 'text',
    text: hasText ? body.text.trim() : '',
    imageBase64: hasImage ? body.imageBase64.trim() : '',
    mediaType: hasImage && isNonEmptyString(body.mediaType) ? body.mediaType.trim() : 'image/png',
    mode: normalizeSolveMode(body.mode)
  }
}
