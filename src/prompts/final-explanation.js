function buildFinalExplanationSystem() {
  return [
    '你是香港 DSE Core Math 數學最終講解助手。',
    '你正在為香港高中學生講解 DSE Core Math 題目，必須使用香港 DSE Core Math 課程內的方法與寫法。',
    '嚴禁使用超出 DSE Core Math syllabus 的技巧、定理、術語或捷徑；不要 out-syllabus。',
    '你的任務是直接輸出可顯示給學生閱讀的繁體中文最終講解正文。',
    '不要輸出 JSON，不要輸出 markdown 程式碼區塊，不要輸出除講解正文外的前言、說明、debug 訊息。',
    '請用自然分段方式講解，可使用短段落或簡單小標，但整體必須像正式學生版講解。',
    '所有數學式必須完整包在 KaTeX 可渲染定界符內：行內公式用 $...$ 或 \\(...\\)；獨立公式用 $$...$$ 或 \\[...\\]。',
    '每個 LaTeX 指令都必須完整保留反斜線，例如 \\pi、\\times、\\frac、\\text；絕對不可寫成 pi、times、frac、text、imes、ext。',
    '乘號一律只可寫 \\times。只要出現乘法，不可寫 x、*、times、imes，也不可省略乘號。',
    '凡是下標、上標或括號內需要文字標籤時，一律寫成合法形式，例如 S_{\\text{大}}、V_{\\text{新}}；絕不可寫 ext{大}、text{大}、S_大、V_新。',
    '公式內禁止寫任何單位，包括 cm、\\text{cm}、\\text{cm}^2、\\text{cm}^3。單位必須放在公式外，用中文正文表達，例如「單位為厘米 / 平方厘米 / 立方厘米」。',
    '公式內禁止放中文判斷詞或敘述詞，例如「最大」「最小」「因此」「所以」「可得」「即」「當…時」；這些內容必須放在公式外。',
    '在公式中盡量只保留單個公式或最多一到兩個等號；不要輸出長串連等式。',
    '若需要代入數值，請把代入說明放在正文中，再另外給一條簡短公式。',
    '避免把太多等式硬塞在同一條超長公式內；可拆成兩至三行短公式，確保每條都合法可渲染。',
    '不要輸出裸公式，不要輸出字面上的 \\n、\\t、\\quad、\\, 等控制字樣。',
    '優先使用短段落，避免超長單段。',
    '講解要先說清題意，再給答案，再逐步說明推導。',
    '若有圖形，可自然提示學生配合上方圖形理解；若沒有圖形，不要要求重新作圖。',
    '請避免過度冗長，重點是清楚、穩定、可直接顯示。'
  ].join('\n')
}

function buildSolverSummaryLines(solverA, solverB) {
  const lines = []

  if (solverA) {
    lines.push(`Solver A 摘要: ${solverA.summary || solverA.finalAnswer || '無'}`)
  }

  if (solverB) {
    lines.push(`Solver B 摘要: ${solverB.summary || solverB.finalAnswer || '無'}`)
  }

  return lines
}

function buildDiagramContext({ hasDiagram, diagramPlan }) {
  return hasDiagram
    ? [
        '系統已完成題目圖形生成，你可以在講解中引用上方圖形輔助理解。',
        diagramPlan?.reasoningSummary ? `圖形摘要: ${diagramPlan.reasoningSummary}` : '圖形摘要: 已有題目對應圖形。'
      ].join('\n')
    : '目前沒有題目圖形；若題目本身偏幾何，你可以提示學生之後配合圖形理解，但不要要求重新作圖。'
}

export function buildFinalExplanationPrompt({ normalizedProblem, judgeResult, solverA, solverB, diagramPlan, hasDiagram }) {
  const diagramContext = buildDiagramContext({ hasDiagram, diagramPlan })

  return {
    system: buildFinalExplanationSystem(),
    user() {
      return [
        `題目: ${normalizedProblem.problemText}`,
        normalizedProblem.goal ? `求解目標: ${normalizedProblem.goal}` : '求解目標: 請依題意整理',
        normalizedProblem.knownConditions.length > 0 ? `已知條件: ${normalizedProblem.knownConditions.join('；')}` : '已知條件: 無法額外提取',
        `最終答案: ${judgeResult.finalAnswer}`,
        `裁決理由: ${judgeResult.reasoning || '無'}`,
        ...buildSolverSummaryLines(solverA, solverB),
        diagramContext,
        '請直接輸出學生版最終講解正文。建議順序：題意整理 → 最終答案 → 逐步講解 → 如適合則補一句圖形提示。',
        '公式請優先寫短而完整的兩到三步，不要把所有等式擠成一長串；單條公式最多保留一到兩個等號。',
        '像「點 Q 到直線 GP 的垂直距離」這種中文說明請放在公式外單獨解釋；公式內只保留短變數或短英文標籤。',
        '「最大、最小、因此、所以、可得、即、當…時」這類中文判斷詞必須寫在正文中，不可貼在公式尾部，也不要寫成 \\text{最大} 這種形式。',
        '面積、體積、長度等單位不要寫進公式。請寫成例如「曲面面積為 $60\\pi$，單位為平方厘米」或「體積為 $2496\\pi$，單位為立方厘米」。',
        '再次提醒：不要輸出 JSON；所有公式都要包在可渲染定界符內；所有 LaTeX 指令都必須保留反斜線；不要輸出字面上的 \\n 或 \\quad。'
      ].join('\n\n')
    }
  }
}

export function buildReviewFinalExplanationPrompt({
  normalizedProblem,
  reviewResult,
  studentWorkText,
  studentAnswer,
  diagramPlan,
  hasDiagram
}) {
  const diagramContext = buildDiagramContext({ hasDiagram, diagramPlan })

  return {
    system: buildFinalExplanationSystem(),
    user() {
      return [
        `題目: ${normalizedProblem.problemText}`,
        normalizedProblem.goal ? `求解目標: ${normalizedProblem.goal}` : '求解目標: 請依題意整理',
        normalizedProblem.knownConditions.length > 0 ? `已知條件: ${normalizedProblem.knownConditions.join('；')}` : '已知條件: 無法額外提取',
        `學生解題過程: ${studentWorkText || '未提供可讀內容'}`,
        studentAnswer?.provided
          ? `學生最終答案: ${studentAnswer.text || '[圖片答案]'}`
          : '學生最終答案: 未提供',
        `標準答案: ${reviewResult.referenceAnswer || '未提供'}`,
        reviewResult.referenceReasoning ? `標準解題理由: ${reviewResult.referenceReasoning}` : '',
        reviewResult.answerVerdict ? `答案判定: ${reviewResult.answerVerdict}` : '',
        reviewResult.methodVerdict ? `方法判定: ${reviewResult.methodVerdict}` : '',
        reviewResult.whyWrong ? `錯因: ${reviewResult.whyWrong}` : '',
        Array.isArray(reviewResult.mistakeSteps) && reviewResult.mistakeSteps.length > 0
          ? `錯誤步驟: ${reviewResult.mistakeSteps.join('；')}`
          : '',
        reviewResult.scoreJudgement ? `評分說明: ${reviewResult.scoreJudgement}` : '',
        Array.isArray(reviewResult.markingNotes) && reviewResult.markingNotes.length > 0
          ? `得分與失分點: ${reviewResult.markingNotes.join('；')}`
          : '',
        diagramContext,
        '請直接輸出學生版批改後講解正文。建議順序：題意整理 → 標準答案 → 學生哪裡對 / 錯 → 正確做法怎樣寫 → 如適合則補一句圖形提示。',
        '若學生做錯，必須明確指出錯在哪一步，以及應如何修正；若學生做對，則簡要說明其方法為何可接受。',
        '講解要以批改後講解為主，不要只重講正解而完全忽略學生作答。',
        '公式請優先寫短而完整的兩到三步，不要把所有等式擠成一長串；單條公式最多保留一到兩個等號。',
        '像「點 Q 到直線 GP 的垂直距離」這種中文說明請放在公式外單獨解釋；公式內只保留短變數或短英文標籤。',
        '「最大、最小、因此、所以、可得、即、當…時」這類中文判斷詞必須寫在正文中，不可貼在公式尾部，也不要寫成 \\text{最大} 這種形式。',
        '面積、體積、長度等單位不要寫進公式。請寫成例如「曲面面積為 $60\\pi$，單位為平方厘米」或「體積為 $2496\\pi$，單位為立方厘米」。',
        '再次提醒：不要輸出 JSON；所有公式都要包在可渲染定界符內；所有 LaTeX 指令都必須保留反斜線；不要輸出字面上的 \\n 或 \\quad。'
      ].filter(Boolean).join('\n\n')
    }
  }
}
