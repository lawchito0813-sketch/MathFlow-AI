function jsonBlockInstructions(schemaDescription) {
  return [
    '你必須只輸出合法 JSON。',
    '不要輸出 markdown 程式碼區塊。',
    '不要輸出額外解釋。',
    schemaDescription
  ].join('\n')
}

function formatStudentAnswer(studentAnswer) {
  if (!studentAnswer?.provided) {
    return '學生最終答案: 未提供，請從學生作答圖片自行判讀。'
  }

  if (studentAnswer.type === 'image') {
    return '學生最終答案: 以圖片提供，請直接結合圖片內容判讀。'
  }

  return `學生最終答案: ${studentAnswer.text || '未能讀取'}`
}

function formatScorePlan(scorePlan) {
  if (!scorePlan) return ''
  return [
    `總分: ${scorePlan.totalMarks}`,
    `分數來源: ${scorePlan.totalMarksSource === 'problem' ? '題目標示' : '模型估算'}`,
    Array.isArray(scorePlan.subparts) && scorePlan.subparts.length > 0
      ? `分題滿分: ${scorePlan.subparts.map(item => `${item.label} ${item.maxMarks}`).join('；')}`
      : '',
    scorePlan.reasoning ? `分數規劃說明: ${scorePlan.reasoning}` : ''
  ].filter(Boolean).join('\n')
}

function buildQuestionImageContext({ normalizedProblem, studentWorkText, studentAnswer, scorePlan, includeStudentWork = true, includeStudentAnswer = true }) {
  return [
    `題目文字提示: ${normalizedProblem.problemText || '請根據圖片辨識題目內容'}`,
    normalizedProblem.goal ? `求解目標: ${normalizedProblem.goal}` : '',
    normalizedProblem.knownConditions?.length > 0
      ? `已知條件: ${normalizedProblem.knownConditions.join('；')}`
      : '',
    scorePlan ? `題目分數資訊:\n${formatScorePlan(scorePlan)}` : '',
    includeStudentWork ? `學生作答文字提示: ${studentWorkText || '請以學生作答圖片為準，不可假設看不到的內容。'}` : '',
    includeStudentAnswer ? formatStudentAnswer(studentAnswer) : ''
  ].filter(Boolean).join('\n\n')
}

function summarizeHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return ''
  return history.slice(-6).map(item => `${item.role === 'assistant' ? '助手' : '用戶'}: ${item.content}`).join('\n')
}

export function buildReferenceAnswerPrompt({ normalizedProblem, studentWorkText, studentAnswer, scorePlan, variant = 'single', compact = false }) {
  const isJudge = variant === 'judge'
  return {
    system: [
      isJudge
        ? '你是香港 DSE Core Math 參考答案裁決助手。'
        : `你是香港 DSE Core Math 參考答案求解助手${variant === 'single' ? '' : ` ${variant}`}。`,
      '你必須直接根據題目圖片理解題意與數據，不可忽略圖片。',
      isJudge
        ? '你的任務是比較兩份獨立參考答案，輸出唯一更可靠的最終參考答案。'
        : '你的任務是只根據題目圖片求出可靠的參考答案與簡潔解題理由。',
      '禁止重述題目內容。',
      '禁止整理或抄寫學生作答。',
      'referenceAnswer 必須直接寫出最終答案或各小題答案，不可寫閱讀說明、看圖描述、題意摘要或作答策略。',
      'referenceReasoning 只能寫精簡解題依據，不可重寫題幹。',
      '若題目有多個小題，referenceAnswer 必須直接列出各小題正解。',
      compact ? '這是精簡重試版，內容可短，但 referenceAnswer 與 referenceReasoning 不可缺。' : '回答要精準、保守、符合香港 DSE Core Math。',
      jsonBlockInstructions(isJudge
        ? '返回 JSON: {"referenceAnswer":"","referenceReasoning":"","decision":"A|B","decisionReason":""}'
        : '返回 JSON: {"referenceAnswer":"","referenceReasoning":""}')
    ].join('\n\n'),
    user() {
      return [
        buildQuestionImageContext({ normalizedProblem, studentWorkText, studentAnswer, scorePlan, includeStudentWork: false, includeStudentAnswer: false }),
        isJudge
          ? '以下有兩份候選參考答案，請比較後只保留一份最可靠的最終參考答案。不得輸出題目轉寫或學生作答整理。'
          : '請直接解題並輸出標準答案。referenceAnswer 只能寫正解；referenceReasoning 只能寫精簡解題依據。不得輸出題目轉寫、抽取摘要、學生作答整理。'
      ].join('\n\n')
    }
  }
}

export function buildStudentJudgementPrompt({ normalizedProblem, studentWorkText, studentAnswer, scorePlan, referenceAnswer, referenceReasoning, compact = false }) {
  return {
    system: [
      '你是香港 DSE Core Math 學生作答批改助手。',
      '你必須同時查看題目圖片與學生作答圖片，不可只依賴文字摘要。',
      '你的任務是根據參考答案與圖片中的學生作答，先輸出自然語言批改裁決。',
      '此階段不要輸出最終分數 breakdown，只需自然語言判斷學生答案、方法、錯因與可得分方向。',
      'answerVerdict、methodVerdict、whyWrong、scoreJudgement 不可留空；若證據不足，必須明確寫 unable_to_confirm 與原因。',
      compact ? '這是精簡重試版，內容可短，但 answerVerdict、methodVerdict、whyWrong、scoreJudgement 不可缺。' : '回答要保守、直接、符合香港 DSE Core Math。',
      jsonBlockInstructions('返回 JSON: {"answerVerdict":"","methodVerdict":"","whyWrong":"","suggestedNextStep":"","referenceAnswer":"","referenceReasoning":"","scoreJudgement":"","markingNotes":[]}')
    ].join('\n\n'),
    user() {
      return [
        buildQuestionImageContext({ normalizedProblem, studentWorkText, studentAnswer, scorePlan }),
        `參考答案: ${referenceAnswer || '未提供'}`,
        `參考理由: ${referenceReasoning || '未提供'}`,
        '請先用自然語言判斷學生是否答對、方法是否合理、錯在何處，以及評分方向。若看不清或證據不足，也必須把不確定之處寫清楚，不可留白。'
      ].join('\n\n')
    }
  }
}

export function buildScoreJsPrompt({ normalizedProblem, studentWorkText, studentAnswer, scorePlan, referenceAnswer, referenceReasoning, judgement, compact = false }) {
  return {
    system: [
      '你是香港 DSE Core Math 學生作答評分助手。',
      '你現在要根據同一題目的圖片、參考答案，以及你上一輪自然語言裁決，輸出最終 JS 評分結果。',
      '你必須只輸出合法 JSON，內容對應最終 JS 評分物件。',
      '分數必須保守且可追溯到學生圖片中的可見作答。',
      'answerVerdict、methodVerdict、whyWrong、scoreJudgement、scoreBreakdown[0].comment 不可全部留空；若證據不足，必須明寫待人工覆核。',
      compact ? '這是精簡重試版，但 awardedTotalMarks、maxTotalMarks、scoreBreakdown 不可缺。' : '請輸出完整可用的最終評分結果。',
      jsonBlockInstructions('返回 JSON: {"isCorrect":false,"answerVerdict":"","methodVerdict":"","mistakeSteps":[],"whyWrong":"","markingNotes":[],"suggestedNextStep":"","referenceAnswer":"","referenceReasoning":"","scoreJudgement":"","scoreBreakdown":[{"label":"整題","awardedMarks":0,"maxMarks":0,"comment":""}],"awardedTotalMarks":0,"maxTotalMarks":0,"followupHint":"","diagramDecision":"required|optional|unnecessary","diagramReason":""}')
    ].join('\n\n'),
    user() {
      return [
        buildQuestionImageContext({ normalizedProblem, studentWorkText, studentAnswer, scorePlan }),
        `參考答案: ${referenceAnswer || '未提供'}`,
        `參考理由: ${referenceReasoning || '未提供'}`,
        `上一輪自然語言裁決: ${JSON.stringify(judgement)}`,
        '請把上一輪自然語言裁決轉成最終分數與 scoreBreakdown。若證據不足，必須在 verdict、scoreJudgement 與 comment 明確寫出待人工覆核原因，不可留白。若題目沒有實際分題，可只輸出一項「整題」。'
      ].join('\n\n')
    }
  }
}

export function buildReviewRepairPrompt({ basePrompt, brokenOutput, errorMessage, compact = false }) {
  return {
    system: [
      basePrompt.system,
      '你現在不是延續上一版輸出，而是修復上一版 JSON。',
      compact ? '請用更精簡的語句重發完整合法 JSON。' : '請重新輸出一份完整、合法、可 JSON.parse 的 JSON。',
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

export function buildReviewFollowupPrompt({ session, question }) {
  const reviewResult = session.reviewResult || {}
  const historyText = summarizeHistory(session.followupMessages)

  return {
    system: [
      '你是香港 DSE Core Math 學生作答追問助手。',
      '你正在根據同一題目、同一份學生作答、同一份批改結果回答追問。',
      '你必須只使用 DSE Core Math syllabus 內的方法與評語。',
      '回答要直接、清楚、繁體中文；不要輸出 JSON。',
      '回答時要優先沿用既有批改結論，不可脫離上下文重新亂判。',
      '若上下文證據不足，必須保守說明不可確定之處。',
      '若學生追問扣分、方法對錯、替代做法、哪一步錯，應先回應該焦點，再補充必要原因。',
      '若上下文已有 scoreBreakdown，必須優先引用該最終分數，不可自行改判成另一個分數。'
    ].join('\n'),
    user() {
      return [
        `題目: ${session.normalizedProblem?.problemText || ''}`,
        `學生解題過程: ${session.studentWorkText || ''}`,
        session.studentAnswer?.provided
          ? `學生最終答案: ${session.studentAnswer.text || '[圖片答案]'}`
          : '學生最終答案: 未提供',
        `標準答案: ${reviewResult.referenceAnswer || ''}`,
        `批改結論: ${reviewResult.answerVerdict || ''}`,
        `方法評價: ${reviewResult.methodVerdict || ''}`,
        reviewResult.whyWrong ? `錯因: ${reviewResult.whyWrong}` : '',
        reviewResult.scoreJudgement ? `評分說明: ${reviewResult.scoreJudgement}` : '',
        session.scorePlan ? `題目分數規劃: 總分 ${session.scorePlan.totalMarks}；來源 ${session.scorePlan.totalMarksSource === 'problem' ? '題目標示' : '模型估算'}` : '',
        Array.isArray(session.scoreBreakdown) && session.scoreBreakdown.length > 0
          ? `最終得分: ${session.scoreBreakdown.map(item => `${item.label} ${item.awardedMarks}/${item.maxMarks}${item.comment ? `（${item.comment}）` : ''}`).join('；')}`
          : '',
        Array.isArray(reviewResult.mistakeSteps) && reviewResult.mistakeSteps.length > 0
          ? `已標記錯誤步驟: ${reviewResult.mistakeSteps.join('；')}`
          : '',
        session.followupSummary ? `較早追問摘要: ${session.followupSummary}` : '',
        historyText ? `最近追問:\n${historyText}` : '',
        `本輪追問: ${question}`
      ].filter(Boolean).join('\n\n')
    }
  }
}
