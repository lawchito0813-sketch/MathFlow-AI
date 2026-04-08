function formatQuestionResult(result) {
  return JSON.stringify({
    questionNumber: result.questionNumber,
    questionId: result.questionId,
    mode: result.mode,
    topicTags: result.topicTags || [],
    status: result.status,
    visibleMarks: result.visibleMarks || '',
    awardedTotalMarks: result.awardedTotalMarks ?? 0,
    maxTotalMarks: result.maxTotalMarks ?? 0,
    scorePlan: result.scorePlan || null,
    scoreBreakdown: result.scoreBreakdown || [],
    answerVerdict: result.answerVerdict || '',
    methodVerdict: result.methodVerdict || '',
    whyWrong: result.whyWrong || '',
    suggestedNextStep: result.suggestedNextStep || '',
    routingReasoning: result.routingReasoning || '',
    error: result.error || null
  })
}

export function buildPaperReportPrompt({ paperIndex, questionResults, compact = false }) {
  return {
    system: [
      '你是香港 DSE Core Math 整卷批改總結助手。',
      '你的任務是根據逐題批改結果，用自然語言直接寫出整卷總報告。',
      '不要輸出 JSON。不要輸出 markdown 程式碼區塊。不要列印欄位名或大括號。',
      '請直接用清晰段落輸出，至少涵蓋：整體得分表現、較弱課題、較強課題、常見失分原因、下一步改善建議。',
      '若有題目失敗或證據不足，必須保守說明，不可捏造。',
      compact
        ? '這是精簡重試版：請用較短篇幅直接重寫完整自然語言報告，但仍要包含整體表現、弱點與建議。'
        : '請輸出完整、可直接給學生閱讀的自然語言整卷報告。'
    ].join('\n\n'),
    user() {
      return [
        paperIndex?.summary ? `整卷索引摘要: ${paperIndex.summary}` : '',
        `題目總數: ${Array.isArray(questionResults) ? questionResults.length : 0}`,
        '以下是逐題結果 JSON：',
        ...(questionResults || []).map(formatQuestionResult),
        '請綜合以上資料，直接寫出自然語言整卷總報告。'
      ].filter(Boolean).join('\n\n')
    },
    stream: true,
    maxCompletionTokens: compact ? 2200 : 3600
  }
}
