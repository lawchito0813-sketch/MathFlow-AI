function jsonBlockInstructions(schemaDescription) {
  return [
    '你必須只輸出合法 JSON。',
    '不要輸出 markdown 程式碼區塊。',
    '不要輸出額外解釋。',
    schemaDescription
  ].join('\n')
}

function buildHardJudgeSystem({ compact = false } = {}) {
  return [
    '你是數學裁決助手。',
    '你的職責是比較兩份解答，找出衝突，給出更可信的最終答案。',
    '不能盲目折中，必須指出採信理由。',
    '若兩份解答都不可靠，也必須明確指出。',
    '你還必須額外判斷這題是否需要畫圖才能更好理解或展示。',
    '若題目明顯依賴幾何關係、座標關係、圖像理解或示意圖輔助，diagramDecision 應為 required。',
    '若畫圖只是輔助理解但非必要，diagramDecision 應為 optional。',
    '若是純代數、純數值、純公式題，diagramDecision 應為 unnecessary。',
    compact ? '這是精簡重試版：reasoning 請簡潔，但 finalAnswer 與 diagramDecision 不可缺。' : 'reasoning 要清楚但避免冗長。',
    jsonBlockInstructions('返回 JSON: {"finalAnswer":"","chosenSolver":"A|B|neither","reasoning":"","conflictPoints":[],"confidence":"high|medium|low","diagramDecision":"required|optional|unnecessary","diagramReason":""}')
  ].join('\n')
}

function buildSimpleJudgeSystem({ compact = false } = {}) {
  return [
    '你是數學解題與裁定助手。',
    '你的職責是根據已標準化的題目直接完成解題，給出最終答案與簡潔可靠的推導理由。',
    '你不是比較兩份解答，也不要假設還有 Solver A 或 Solver B。',
    '若題目條件不足，必須在 finalAnswer 直接說明無法確定答案。',
    '你還必須額外判斷這題是否需要畫圖才能更好理解或展示。',
    '若題目明顯依賴幾何關係、座標關係、圖像理解或示意圖輔助，diagramDecision 應為 required。',
    '若畫圖只是輔助理解但非必要，diagramDecision 應為 optional。',
    '若是純代數、純數值、純公式題，diagramDecision 應為 unnecessary。',
    compact ? '這是精簡重試版：reasoning 請簡潔，但 finalAnswer 與 diagramDecision 不可缺。' : 'reasoning 要清楚但避免冗長。',
    jsonBlockInstructions('返回 JSON: {"finalAnswer":"","chosenSolver":"neither","reasoning":"","conflictPoints":[],"confidence":"high|medium|low","diagramDecision":"required|optional|unnecessary","diagramReason":""}')
  ].join('\n')
}

export function buildJudgePrompt({ normalizedProblem, solverA, solverB, compact = false }) {
  return {
    system: buildHardJudgeSystem({ compact }),
    user() {
      return [
        `題目: ${normalizedProblem.problemText}`,
        normalizedProblem.goal ? `求解目標: ${normalizedProblem.goal}` : '求解目標: 請自行判斷',
        `Solver A: ${JSON.stringify(solverA)}`,
        `Solver B: ${JSON.stringify(solverB)}`
      ].join('\n\n')
    }
  }
}

export function buildSimpleJudgePrompt({ normalizedProblem, compact = false }) {
  return {
    system: buildSimpleJudgeSystem({ compact }),
    user() {
      return [
        `題目: ${normalizedProblem.problemText}`,
        normalizedProblem.goal ? `求解目標: ${normalizedProblem.goal}` : '求解目標: 請自行判斷',
        normalizedProblem.knownConditions?.length > 0
          ? `已知條件: ${normalizedProblem.knownConditions.join('；')}`
          : '已知條件: 無法額外提取',
        normalizedProblem.extractedText ? `抽取文字: ${normalizedProblem.extractedText}` : '抽取文字: 無'
      ].join('\n\n')
    }
  }
}

export function buildJudgeRepairPrompt({ basePrompt, brokenOutput, errorMessage, compact = false }) {
  return {
    system: [
      basePrompt.system || buildHardJudgeSystem({ compact }),
      '你現在不是延續上一版輸出，而是修復上一版裁決 JSON。',
      '你會收到解析或驗證錯誤，以及上一版錯誤輸出。',
      compact
        ? '請用更精簡的 reasoning 重新輸出完整合法 JSON。'
        : '請重新輸出一份完整、合法、可 JSON.parse 的 JSON。',
      '禁止續寫半截內容，只能完整重發。'
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
