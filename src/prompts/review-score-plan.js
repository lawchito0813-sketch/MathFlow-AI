function jsonBlockInstructions(schemaDescription) {
  return [
    '你必須只輸出合法 JSON。',
    '不要輸出 markdown 程式碼區塊。',
    '不要輸出額外解釋。',
    schemaDescription
  ].join('\n')
}

function buildScorePlanSystem({ compact = false } = {}) {
  return [
    '你是香港 DSE Core Math 題目分數規劃助手。',
    '你的任務是在批改前先判斷這題的總分與分題分配。',
    '若題目文字中已清楚標示總分或分題分，必須優先沿用題目標示，不可自行改動。',
    '若題目沒有標示分數，才可根據 DSE Core Math 常見 marking logic 估算。',
    '請盡量識別分題結構，如 a、b(i)、b(ii)；若無分題，則用整題作為單一項。',
    compact
      ? '這是精簡重試版：內容可短，但 totalMarks、totalMarksSource、subparts 不可缺。'
      : '請輸出完整可用的分數規劃結果。',
    jsonBlockInstructions('返回 JSON: {"totalMarks":7,"totalMarksSource":"problem|estimated","reasoning":"","subparts":[{"label":"a","maxMarks":2,"reasoning":""}]}')
  ].join('\n\n')
}

export function buildReviewScorePlanPrompt({ normalizedProblem, compact = false }) {
  return {
    system: buildScorePlanSystem({ compact }),
    user() {
      return [
        `題目: ${normalizedProblem.problemText}`,
        normalizedProblem.goal ? `求解目標: ${normalizedProblem.goal}` : '求解目標: 請依題意判斷',
        normalizedProblem.knownConditions?.length > 0
          ? `已知條件: ${normalizedProblem.knownConditions.join('；')}`
          : '已知條件: 無法額外提取',
        '請先檢查題目中是否已明示分數；若有，totalMarksSource 必須為 problem。',
        '若沒有任何明示分數，請按 DSE Core Math 題型與步驟分配估算，totalMarksSource 設為 estimated。',
        '每個 subpart 都要有 label 與 maxMarks。'
      ].join('\n\n')
    }
  }
}

export function buildReviewScorePlanRepairPrompt({ basePrompt, brokenOutput, errorMessage, compact = false }) {
  return {
    system: [
      basePrompt.system || buildScorePlanSystem({ compact }),
      '你現在不是延續上一版輸出，而是修復上一版分數規劃 JSON。',
      compact ? '請用更精簡語句重發完整合法 JSON。' : '請重新輸出一份完整、合法、可 JSON.parse 的 JSON。',
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
