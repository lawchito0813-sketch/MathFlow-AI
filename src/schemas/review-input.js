function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeReviewMode(value) {
  return value === 'simple' || value === 'hard' ? value : 'hard'
}

function normalizeOptionalText(value) {
  return isNonEmptyString(value) ? value.trim() : ''
}

function normalizeImageField(base64Value, mediaTypeValue, fieldLabel) {
  const hasImage = isNonEmptyString(base64Value)
  return {
    hasImage,
    imageBase64: hasImage ? base64Value.trim() : '',
    mediaType: hasImage && isNonEmptyString(mediaTypeValue) ? mediaTypeValue.trim() : 'image/png',
    fieldLabel
  }
}

export function validateReviewRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('請求體必須是 JSON 物件')
  }

  const problemText = normalizeOptionalText(body.problemText)
  const problemImage = normalizeImageField(body.problemImageBase64, body.problemMediaType, '題目')
  const workText = normalizeOptionalText(body.workText)
  const workImage = normalizeImageField(body.workImageBase64, body.workMediaType, '學生解題過程')
  const answerText = normalizeOptionalText(body.answerText)
  const answerImage = normalizeImageField(body.answerImageBase64, body.answerMediaType, '學生答案')

  if (!problemText && !problemImage.hasImage) {
    throw new Error('必須提供題目文字或題目圖片')
  }

  if (problemText && problemImage.hasImage) {
    throw new Error('題目文字與題目圖片只能二選一')
  }

  if (!workText && !workImage.hasImage) {
    throw new Error('必須提供學生解題過程文字或圖片')
  }

  if (workText && workImage.hasImage) {
    throw new Error('學生解題過程文字與圖片只能二選一')
  }

  if (answerText && answerImage.hasImage) {
    throw new Error('學生答案文字與圖片只能二選一')
  }

  return {
    mode: normalizeReviewMode(body.mode),
    problem: {
      type: problemImage.hasImage ? 'image' : 'text',
      text: problemText,
      imageBase64: problemImage.imageBase64,
      mediaType: problemImage.mediaType
    },
    studentWork: {
      type: workImage.hasImage ? 'image' : 'text',
      text: workText,
      imageBase64: workImage.imageBase64,
      mediaType: workImage.mediaType
    },
    studentAnswer: {
      provided: Boolean(answerText || answerImage.hasImage),
      type: answerImage.hasImage ? 'image' : 'text',
      text: answerText,
      imageBase64: answerImage.imageBase64,
      mediaType: answerImage.mediaType
    }
  }
}

export function validateReviewFollowupRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('請求體必須是 JSON 物件')
  }

  const sessionId = normalizeOptionalText(body.sessionId)
  const question = normalizeOptionalText(body.question)

  if (!sessionId) {
    throw new Error('缺少 sessionId')
  }

  if (!question) {
    throw new Error('缺少追問內容')
  }

  return { sessionId, question }
}
