import { buildDseStyleRules } from './dse-style-rules.js'

function jsonOnly(schema) {
  return ['你必須只輸出合法 JSON。', '不要輸出 markdown 程式碼區塊。', '不要輸出額外解釋。', schema].join('\n')
}

export function buildDseAuthorBlueprintPrompt({ intent, compact = false }) {
  return {
    system: [
      buildDseStyleRules(intent),
      '你是 DSE 出題藍圖規劃助手。',
      '請先規劃題目結構，再讓後續 stage 逐題生成。',
      '只可在卷別已明確為 paper1 或 paper2 時規劃藍圖。若卷別仍是 full，代表 intake 尚未完成，這一步不應替老師決定。',
      'Paper 1 與 Paper 2 的題型、分數與語境不同，藍圖必須對應指定卷別。',
      '當模式是 paper 時，你輸出的是整份卷的題目任務清單，不是示例題、起點題，也不是先出一題再說。',
      '當模式是 paper 時，questions 必須是多題結構，至少 2 題，並且 structureSummary 要明確描述整卷分布。',
      '當模式是 paper 且 mustHaveQuestionCount = 0，表示題量由你根據卷別與結構自行決定，不可退化成 1 題。',
      compact ? '精簡重試版：文字可更短，但每題藍圖必須完整。' : '請輸出完整藍圖。',
      jsonOnly('返回 JSON: {"paperType":"paper1|paper2|full","paperTitle":"","structureSummary":"","questions":[{"questionNumber":"1","paperSection":"A|B","questionType":"mc|long","difficultyBand":"1|2|3|4|5|5*|5**","topicTags":[""],"subtopicTags":[""],"marks":4,"needsDiagram":"required|optional|forbidden","answerForm":"","blueprintNotes":""}]}')
    ].join('\n\n'),
    user() {
      return [
        `意圖摘要: ${intent.intentSummary || ''}`,
        `模式: ${intent.mode}`,
        `題型: ${intent.questionType}`,
        `語言: ${intent.language}`,
        `難度: ${intent.difficultyBand}`,
        `卷別: ${intent.paperType}`,
        `課題覆蓋: ${(intent.topicCoverage || []).join('；') || '未指定'}`,
        `避免課題: ${(intent.avoidTopics || []).join('；') || '無'}`,
        `需圖: ${intent.needsDiagram}`,
        `題量: ${intent.mode === 'paper' && !intent.mustHaveQuestionCount ? '由整卷藍圖決定' : intent.mustHaveQuestionCount}`,
        `每題分數: ${intent.marksPerQuestion}`,
        `老師目標: ${intent.teacherGoal || '無'}`,
        `自訂限制: ${intent.customConstraints || '無'}`
      ].join('\n\n')
    },
    stream: true,
    maxCompletionTokens: compact ? 2200 : 3600
  }
}

export function buildDseAuthorBlueprintRepairPrompt({ basePrompt, brokenOutput, errorMessage, compact = false }) {
  return {
    system: [basePrompt.system, compact ? '請更精簡地完整重發合法 JSON。' : '請完整重發合法 JSON。', '禁止續寫半截內容。'].join('\n\n'),
    user() {
      return [typeof basePrompt.user === 'function' ? basePrompt.user() : '', `解析/驗證錯誤: ${errorMessage}`, brokenOutput].filter(Boolean).join('\n\n')
    },
    stream: false,
    maxCompletionTokens: compact ? 2200 : 3600
  }
}
