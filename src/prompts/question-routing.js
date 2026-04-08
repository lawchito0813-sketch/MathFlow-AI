function jsonBlockInstructions(schemaDescription) {
  return [
    '你必須只輸出合法 JSON。',
    '不要輸出 markdown 程式碼區塊。',
    '不要輸出額外解釋。',
    schemaDescription
  ].join('\n')
}

export function buildQuestionRoutingPrompt({ question }) {
  return {
    system: [
      '你是香港 DSE Core Math 題目路由助手。',
      '你需要根據題目內容判斷此題應使用 simple review 還是 hard review。',
      '簡單直接、計算步驟短、結構單純的題目可用 simple。',
      '多步推理、跨分題、證明、較長應用題或需要更細緻判分者用 hard。',
      '如果同一頁出現多題，你只可處理指定題號的那一題。',
      '禁止把同頁其他題目的題幹、分題、分數、圖形或學生作答混入本題的 normalizedQuestionText。',
      'regionHint 只是輔助定位提示，不代表你可以猜測或補全其他題目內容。',
      jsonBlockInstructions('返回 JSON: {"reviewMode":"simple|hard","normalizedQuestionText":"","visibleMarks":"","topicTags":[""],"reasoning":""}')
    ].join('\n\n'),
    user() {
      return [
        `題號: ${question.questionNumber}`,
        `頁碼範圍: ${(question.pageRange || []).join('-')}`,
        question.visibleMarks ? `可見分數: ${question.visibleMarks}` : '可見分數: 未標示',
        question.samePageMultiQuestion ? '同頁情況: 此頁可能還有其他題目，請只抽取指定題號內容。' : '',
        question.regionHint ? `區域提示: ${question.regionHint}` : '',
        '請根據題目圖片與上下文，只整理該題文字，再判斷適合 simple 或 hard。'
      ].filter(Boolean).join('\n\n')
    },
    userContent() {
      const items = []
      ;(question.pages || []).forEach(page => {
        items.push({ type: 'text', text: `第 ${page.pageNumber} 頁` })
        items.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: page.mediaType || 'image/png',
            data: page.imageBase64
          }
        })
      })
      return items
    },
    stream: true,
    maxCompletionTokens: 2200
  }
}

export function buildQuestionRoutingRepairPrompt({ basePrompt, brokenOutput, errorMessage }) {
  return {
    system: [
      basePrompt.system,
      '你現在不是延續上一版輸出，而是修復上一版題目路由 JSON。',
      '請重新輸出完整合法 JSON。',
      '禁止續寫半截內容，只能完整重發。'
    ].join('\n\n'),
    user() {
      return [
        typeof basePrompt.user === 'function' ? basePrompt.user() : '',
        `解析/驗證錯誤: ${errorMessage}`,
        '以下是上一版錯誤輸出，請完整重發正確 JSON。',
        brokenOutput
      ].filter(Boolean).join('\n\n')
    },
    userContent: basePrompt.userContent,
    stream: true,
    maxCompletionTokens: 2200
  }
}
