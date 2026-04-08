import { buildDseStyleRules } from './dse-style-rules.js'
import { buildDseMarkingRules } from './dse-marking-rules.js'

function jsonOnly(schema) {
  return ['你必須只輸出合法 JSON。', '不要輸出 markdown 程式碼區塊。', '不要輸出額外解釋。', schema].join('\n')
}

export function buildDseAuthorQuestionPrompt({ intent, blueprintQuestion, compact = false }) {
  return {
    system: [
      buildDseStyleRules({
        questionType: blueprintQuestion.questionType,
        difficultyBand: blueprintQuestion.difficultyBand,
        language: intent.language,
        needsDiagram: blueprintQuestion.needsDiagram,
        paperType: intent.paperType
      }),
      '你是 DSE 題目生成助手。',
      '請先根據藍圖生成老師可直接編輯的最小題目草稿。',
      '這一步只負責題幹本身，不能輸出標準答案、解題過程、評分指引。',
      compact ? '精簡重試版：文字可略短，但欄位不得缺。' : '請輸出可立即展示給老師的題目草稿。',
      jsonOnly('返回 JSON: {"questionNumber":"1","title":"","paperSection":"A|B","questionType":"mc|long","difficultyBand":"1|2|3|4|5|5*|5**","topicTags":[""],"questionTextZh":"","questionTextEn":"","options":[""],"marks":4,"needsDiagram":"required|optional|forbidden","diagramInstructions":""}')
    ].join('\n\n'),
    user() {
      return [
        `意圖摘要: ${intent.intentSummary || ''}`,
        `老師目標: ${intent.teacherGoal || '無'}`,
        `自訂限制: ${intent.customConstraints || '無'}`,
        `題號: ${blueprintQuestion.questionNumber}`,
        `卷別區段: ${blueprintQuestion.paperSection}`,
        `題型: ${blueprintQuestion.questionType}`,
        `難度: ${blueprintQuestion.difficultyBand}`,
        `課題: ${(blueprintQuestion.topicTags || []).join('；') || '未指定'}`,
        `子課題: ${(blueprintQuestion.subtopicTags || []).join('；') || '無'}`,
        `分數: ${blueprintQuestion.marks}`,
        `需圖: ${blueprintQuestion.needsDiagram}`,
        `答案形式: ${blueprintQuestion.answerForm || '請自行合理設計'}`,
        `藍圖備註: ${blueprintQuestion.blueprintNotes || '無'}`
      ].join('\n\n')
    },
    stream: true,
    maxCompletionTokens: compact ? 1800 : 2800
  }
}

export function buildDseAuthorMarkingSchemePrompt({ intent, blueprintQuestion, questionDraft, compact = false }) {
  return {
    system: [
      buildDseStyleRules({
        questionType: blueprintQuestion.questionType,
        difficultyBand: blueprintQuestion.difficultyBand,
        language: intent.language,
        needsDiagram: blueprintQuestion.needsDiagram,
        paperType: intent.paperType
      }),
      buildDseMarkingRules(),
      '你是 HKDSE Math 出題助手。',
      '題目草稿已經確定，現在只需補齊標準答案、解題過程、評分指引與質量檢查。',
      '請嚴格根據現有題幹作答，不要重寫題目內容。',
      compact ? '精簡重試版：可略短，但必須保留 HKDSE marks and remarks 重點。' : '請提供完整但精煉的答案與 marking scheme。',
      jsonOnly('返回 JSON: {"answer":"","working":"","markingScheme":"","qualityChecks":[""]}')
    ].join('\n\n'),
    user() {
      return [
        `意圖摘要: ${intent.intentSummary || ''}`,
        `老師目標: ${intent.teacherGoal || '無'}`,
        `自訂限制: ${intent.customConstraints || '無'}`,
        `題號: ${questionDraft.questionNumber || blueprintQuestion.questionNumber}`,
        `卷別區段: ${questionDraft.paperSection || blueprintQuestion.paperSection}`,
        `題型: ${questionDraft.questionType || blueprintQuestion.questionType}`,
        `難度: ${questionDraft.difficultyBand || blueprintQuestion.difficultyBand}`,
        `課題: ${(questionDraft.topicTags || blueprintQuestion.topicTags || []).join('；') || '未指定'}`,
        `分數: ${questionDraft.marks || blueprintQuestion.marks}`,
        `題目（中文）: ${questionDraft.questionTextZh || '無'}`,
        `題目（英文）: ${questionDraft.questionTextEn || '無'}`,
        (questionDraft.options || []).length ? `選項: ${(questionDraft.options || []).join(' | ')}` : '選項: 無',
        `圖形要求: ${questionDraft.needsDiagram || blueprintQuestion.needsDiagram || 'optional'}`,
        `圖形說明: ${questionDraft.diagramInstructions || blueprintQuestion.diagramInstructions || '無'}`
      ].join('\n\n')
    },
    stream: true,
    maxCompletionTokens: compact ? 1800 : 2600
  }
}

export function buildDseAuthorQuestionRepairPrompt({ basePrompt, brokenOutput, errorMessage, compact = false }) {
  return {
    system: [basePrompt.system, compact ? '請更精簡地完整重發合法 JSON。' : '請完整重發合法 JSON。', '禁止續寫半截內容。'].join('\n\n'),
    user() {
      return [typeof basePrompt.user === 'function' ? basePrompt.user() : '', `解析/驗證錯誤: ${errorMessage}`, brokenOutput].filter(Boolean).join('\n\n')
    },
    stream: false,
    maxCompletionTokens: compact ? 2600 : 4200
  }
}
