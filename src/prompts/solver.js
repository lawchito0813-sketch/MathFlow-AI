function jsonBlockInstructions(schemaDescription) {
  return [
    '你必須只輸出合法 JSON。',
    '不要輸出 markdown 程式碼區塊。',
    '不要輸出額外解釋。',
    'steps 必須是字串陣列。',
    'finalAnswer 必須是非空字串，絕對不可省略、不可為空字串、不可為 null。',
    'confidence 必須是 high、medium、low 其中之一。',
    'assumptions 必須是字串陣列，沒有就返回空陣列。',
    'summary 必須是非空字串。',
    schemaDescription
  ].join('\n')
}

function buildSolverSystem({ variant, compact = false }) {
  const variantInstruction = variant === 'A'
    ? '你偏向直接推導，快速給出清晰步驟。'
    : '你偏向仔細校驗條件、分步驗算並檢查常見錯誤。'

  return [
    '你是數學解題助手。',
    variantInstruction,
    '必須逐步解題，不可跳過關鍵推導。',
    '若條件不足，必須明確指出。',
    '即使條件不足，也必須返回完整 JSON，並在 finalAnswer 中直接說明無法確定答案。',
    '輸出前先自查：JSON 必須同時包含 steps、finalAnswer、confidence、assumptions、summary。',
    compact ? '這是精簡重試版：steps 請更短，但仍要完整。' : 'steps 需保持清晰且不冗長。',
    jsonBlockInstructions('返回 JSON: {"steps":[],"finalAnswer":"","confidence":"high|medium|low","assumptions":[],"summary":""}')
  ].join('\n')
}

export function buildSolverPrompt({ variant, sourceType, normalizedProblem, originalInput, compact = false }) {
  return {
    system: buildSolverSystem({ variant, compact }),
    user() {
      return [
        `輸入類型: ${sourceType}`,
        normalizedProblem?.problemText ? `題目: ${normalizedProblem.problemText}` : '題目: 請根據使用者提供的原始輸入自行理解題意。',
        normalizedProblem?.knownConditions?.length > 0 ? `已知條件: ${normalizedProblem.knownConditions.join('；')}` : '已知條件: 若未提供標準化結果，請自行從原始輸入提取。',
        normalizedProblem?.goal ? `求解目標: ${normalizedProblem.goal}` : '求解目標: 請從題意中自行判斷。',
        sourceType === 'image'
          ? '這是圖片題。若標準化結果尚未完整，請直接根據原始圖片與文字上下文自行辨識題意並解題。'
          : '這是文字題，請直接根據題目解題。'
      ].join('\n')
    },
    userContent() {
      if (sourceType !== 'image' || !originalInput?.imageBase64) {
        return null
      }

      return [
        {
          type: 'text',
          text: this.user()
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: originalInput.mediaType || 'image/png',
            data: originalInput.imageBase64
          }
        }
      ]
    }
  }
}

export function buildSolverRepairPrompt({ basePrompt, brokenOutput, errorMessage, compact = false }) {
  return {
    system: [
      basePrompt.system || buildSolverSystem({ variant: 'A', compact }),
      '你現在不是延續上一版輸出，而是修復上一版解題 JSON。',
      '你會收到解析或驗證錯誤，以及上一版錯誤輸出。',
      compact
        ? '這一輪請用更精簡的 steps，但仍必須返回完整合法 JSON。'
        : '請重新輸出一份完整、合法、可 JSON.parse 的 JSON。',
      '禁止只補尾巴，禁止續寫半截內容，必須完整重發。'
    ].join('\n\n'),
    user() {
      return [
        typeof basePrompt.user === 'function' ? basePrompt.user() : '',
        `解析/驗證錯誤: ${errorMessage}`,
        '以下是上一版錯誤輸出，請完整重發正確 JSON。',
        brokenOutput
      ].filter(Boolean).join('\n\n')
    }
  }
}
