export function buildDseAuthorPaperPrompt({ intent, blueprint, generatedQuestions, questionTasks }) {
  return {
    system: [
      '你是 HKDSE Mathematics Compulsory Part 整卷整理助手。',
      '你的任務是根據目前已完成的題目與任務進度，整理老師工作台可直接檢視的整卷進度摘要。',
      '若整卷尚未完成，summary 必須明確寫成進度／未完成狀態，不可冒充成整卷已完成。',
      'editorNotes 應指出目前已完成題數、未完成題數，以及老師下一步最值得看的重點。',
      '你必須只輸出合法 JSON。',
      '不要輸出 markdown 程式碼區塊。',
      '不要輸出額外解釋。',
      '返回 JSON: {"paperTitle":"","paperType":"paper1|paper2|full","summary":"","editorNotes":""}'
    ].join('\n\n'),
    user() {
      return [
        `卷別: ${intent.paperType}`,
        `藍圖摘要: ${blueprint.structureSummary || ''}`,
        `題目數: ${(generatedQuestions || []).length}`,
        `任務總數: ${(questionTasks || []).length}`,
        `已完成驗算題數: ${(questionTasks || []).filter(item => item?.stages?.verify === 'done').length}`,
        '已生成題目:',
        ...(generatedQuestions || []).map(item => JSON.stringify({
          questionNumber: item.questionNumber,
          paperSection: item.paperSection,
          questionType: item.questionType,
          difficultyBand: item.difficultyBand,
          topicTags: item.topicTags,
          marks: item.marks,
          title: item.title
        }))
      ].join('\n\n')
    },
    stream: true,
    maxCompletionTokens: 2000
  }
}
