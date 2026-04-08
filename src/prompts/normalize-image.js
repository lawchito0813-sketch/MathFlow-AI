function jsonBlockInstructions(schemaDescription) {
  return [
    '你必須只輸出合法 JSON。',
    '不要輸出 markdown 程式碼區塊。',
    '不要輸出額外解釋。',
    schemaDescription
  ].join('\n')
}

function buildNormalizeImageSystem() {
  return [
    '你是數學題圖片理解助手。',
    '你的職責是從圖片題目中提取題幹、已知條件、目標。',
    '若條件不足，不要編造。',
    jsonBlockInstructions('返回 JSON: {"sourceType":"image","problemText":"","extractedText":"","knownConditions":[],"goal":"","requiresDiagram":true}')
  ].join('\n')
}

export function buildNormalizeImagePrompt(input) {
  return {
    system: buildNormalizeImageSystem(),
    userText() {
      return [
        '請根據這張數學題圖片提取題意。',
        '如果圖片有模糊處，請盡量保守表達。'
      ].join('\n\n')
    },
    userContent() {
      return [
        {
          type: 'text',
          text: this.userText()
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: input.mediaType || 'image/png',
            data: input.imageBase64
          }
        }
      ]
    },
    user() {
      return this.userText()
    }
  }
}

export function buildNormalizeImageRepairPrompt({ basePrompt, brokenOutput, errorMessage }) {
  return {
    system: [
      buildNormalizeImageSystem(),
      '你現在不是重新看一張新圖片，而是修復上一版圖片理解 JSON。',
      '你會收到解析或驗證錯誤，以及上一版錯誤輸出。',
      '請根據同一張圖片與原始要求，重新輸出一份完整、合法、可直接 JSON.parse 的 JSON。',
      '禁止續寫半截內容，禁止解釋，只能完整重發 JSON。'
    ].join('\n\n'),
    user() {
      return [
        typeof basePrompt.user === 'function' ? basePrompt.user() : '',
        `解析/驗證錯誤: ${errorMessage}`,
        '以下是上一版錯誤輸出，請完整重發正確 JSON。',
        brokenOutput
      ].filter(Boolean).join('\n\n')
    },
    userContent() {
      return typeof basePrompt.userContent === 'function' ? basePrompt.userContent() : null
    }
  }
}
