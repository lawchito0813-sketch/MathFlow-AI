import { buildDseStyleRules } from './dse-style-rules.js'

function jsonOnly(schema) {
  return ['你必須只輸出合法 JSON。', '不要輸出 markdown 程式碼區塊。', '不要輸出額外解釋。', schema].join('\n')
}

function stringifyConversation(conversation = []) {
  if (!Array.isArray(conversation) || conversation.length === 0) return '暫無額外對話'
  return conversation.map(item => `${item.role === 'assistant' ? '助手' : '老師'}: ${item.content}`).join('\n')
}

export function buildDseAuthorIntentPrompt({ request, compact = false }) {
  return {
    system: [
      buildDseStyleRules(request),
      '你是老師出題工作台的主 agent intake stage。',
      '你要把老師的表單與對話整理為結構化出題意圖，並判斷資訊是否足夠開始生成。',
      '若老師要求整卷、full paper、整份卷，而目前仍未明確決定先出 Paper 1 或 Paper 2，你必須先追問卷別，不可自行決定，也不可同時規劃兩卷。',
      '只有在卷別已明確為 paper1 或 paper2 時，才可進入 blueprint / generate。',
      '當模式是 paper 時，這代表要先規劃整份卷的藍圖與題目任務，不可把它降格成先出一題試題。',
      '當模式是 paper 且卷別已確定時，readyToGenerate 只可表示資訊足夠開始規劃整卷，不可因為只夠出一題就視為可生成。',
      '當模式是 paper 時，mustHaveQuestionCount 若為 0 代表由藍圖決定整卷題量；不要把它理解成 0 題或 1 題。',
      '若資訊不足，assistantQuestion 必須只問一條最有價值的下一步問題。',
      compact ? '精簡重試版：內容可以更短，但欄位不得缺。' : '請完整整理意圖。',
      jsonOnly('返回 JSON: {"mode":"single|set|paper","questionType":"mc|long|mixed","language":"zh-HK|en|bilingual","difficultyBand":"1|2|3|4|5|5*|5**","paperType":"paper1|paper2|full","topicCoverage":[""],"avoidTopics":[""],"needsDiagram":"required|optional|forbidden","useRealWorldContext":false,"mustHaveQuestionCount":1,"marksPerQuestion":4,"teacherGoal":"","customConstraints":"","missingFields":[""],"assistantQuestion":"","readyToGenerate":true,"intentSummary":""}')
    ].join('\n\n'),
    user() {
      return [
        `模式: ${request.mode}`,
        `題型: ${request.questionType}`,
        `語言: ${request.language}`,
        `難度: ${request.difficultyBand}`,
        `卷別: ${request.paperType}`,
        `課題覆蓋: ${(request.topicCoverage || []).join('；') || '未指定'}`,
        `避免課題: ${(request.avoidTopics || []).join('；') || '無'}`,
        `需圖: ${request.needsDiagram}`,
        `題量: ${request.mustHaveQuestionCount}`,
        `每題分數: ${request.marksPerQuestion}`,
        `情境化: ${request.useRealWorldContext ? '是' : '否'}`,
        `老師目標: ${request.teacherGoal || '未補充'}`,
        `自訂限制: ${request.customConstraints || '無'}`,
        `對話記錄:\n${stringifyConversation(request.conversation)}`
      ].join('\n\n')
    },
    stream: true,
    maxCompletionTokens: compact ? 1800 : 2600
  }
}

export function buildDseAuthorIntentRepairPrompt({ basePrompt, brokenOutput, errorMessage, compact = false }) {
  return {
    system: [
      basePrompt.system,
      compact ? '請更精簡地完整重發合法 JSON。' : '請完整重發合法 JSON。',
      '禁止續寫半截內容。'
    ].join('\n\n'),
    user() {
      return [
        typeof basePrompt.user === 'function' ? basePrompt.user() : '',
        `解析/驗證錯誤: ${errorMessage}`,
        brokenOutput
      ].filter(Boolean).join('\n\n')
    },
    stream: false,
    maxCompletionTokens: compact ? 1800 : 2600
  }
}
