function jsonBlockInstructions(schemaDescription) {
  return [
    '你必須只輸出合法 JSON。',
    '不要輸出 markdown 程式碼區塊。',
    '不要輸出額外解釋。',
    schemaDescription
  ].join('\n')
}

export function buildQuestionPairRoutingPrompt({ group }) {
  return {
    system: [
      '你是香港 DSE Core Math 題目路由助手。',
      '你現在會看到同一頁中的兩題簡單題，必須一次整理這兩題。',
      '你必須把兩題完全分開處理，每題只保留自己的題幹、分數、分題與知識點。',
      '禁止把第 1 題內容混入第 2 題，亦禁止把第 2 題內容混入第 1 題。',
      '對每題都要各自判斷適合 simple 或 hard。',
      '若其中一題明顯需要更複雜批改，可以把該題標成 hard。',
      jsonBlockInstructions('返回 JSON: {"questions":[{"questionNumber":"1","reviewMode":"simple|hard","normalizedQuestionText":"","visibleMarks":"","topicTags":[""],"reasoning":""}]}')
    ].join('\n\n'),
    user() {
      return [
        `這是一組同頁雙題，頁碼範圍: ${(group.pageRange || []).join('-')}`,
        `題號列表: ${(group.questions || []).map(item => item.questionNumber).join('、')}`,
        '請一次整理這兩題，並為每題各自輸出 routing 結果。'
      ].filter(Boolean).join('\n\n')
    },
    userContent() {
      const items = []
      ;(group.pages || []).forEach(page => {
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
    maxCompletionTokens: 3200
  }
}

export function buildQuestionPairRoutingRepairPrompt({ basePrompt, brokenOutput, errorMessage }) {
  return {
    system: [
      basePrompt.system,
      '你現在不是延續上一版輸出，而是修復上一版雙題 routing JSON。',
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
    maxCompletionTokens: 3200
  }
}

export function buildReviewPairPrompt({ group }) {
  const questionSummary = (group.questions || []).map(item => [
    `題號: ${item.questionNumber}`,
    item.visibleMarks ? `可見分數: ${item.visibleMarks}` : '',
    item.regionHint ? `定位提示: ${item.regionHint}` : '',
    item.normalizedQuestionText ? `已整理題意: ${item.normalizedQuestionText}` : ''
  ].filter(Boolean).join('\n')).join('\n\n')

  return {
    system: [
      '你是香港 DSE Core Math 同頁雙題批改助手。',
      '你現在會同時看到同一頁中的兩題簡單題，以及該頁的學生作答。',
      '你必須一次完成這兩題的批改，但輸出時必須把兩題完全分開。',
      '每題都要各自輸出標準答案、答案判定、方法判定、錯因、建議、逐分點 scoreBreakdown、得分與滿分。',
      '禁止把一題的題幹、學生作答、分數或評語混入另一題。',
      '若某題資訊不足，可對該題保守評分，但不能影響另一題。',
      jsonBlockInstructions('返回 JSON: {"results":[{"questionNumber":"1","answerVerdict":"","methodVerdict":"","referenceAnswer":"","referenceReasoning":"","whyWrong":"","suggestedNextStep":"","scoreBreakdown":[{"label":"整題","awardedMarks":0,"maxMarks":0,"comment":""}],"awardedTotalMarks":0,"maxTotalMarks":0,"diagramDecision":"required|optional|unnecessary","diagramReason":""}]}')
    ].join('\n\n'),
    user() {
      return [
        '請根據同頁圖片，一次完成以下兩題的批改。',
        questionSummary,
        '輸出必須是兩題各自的獨立結果。'
      ].filter(Boolean).join('\n\n')
    },
    userContent() {
      const items = []
      ;(group.pages || []).forEach(page => {
        items.push({ type: 'text', text: `第 ${page.pageNumber} 頁題目與學生作答` })
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
    maxCompletionTokens: 5200
  }
}

export function buildReviewPairRepairPrompt({ basePrompt, brokenOutput, errorMessage }) {
  return {
    system: [
      basePrompt.system,
      '你現在不是延續上一版輸出，而是修復上一版雙題批改 JSON。',
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
    maxCompletionTokens: 5200
  }
}
