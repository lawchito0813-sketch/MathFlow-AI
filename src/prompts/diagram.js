function jsonBlockInstructions(schemaDescription) {
  return [
    '你必須只輸出合法 JSON。',
    '不要輸出 markdown 程式碼區塊。',
    '不要輸出額外解釋。',
    schemaDescription
  ].join('\n')
}

export function buildDiagramPlanPrompt({ normalizedProblem, judgeResult, previousAttempt, originalInput }) {
  const retrySection = previousAttempt
    ? [
        '你上一版 Python 作圖程式執行失敗，現在必須根據錯誤修正。',
        `上一版程式:\n${previousAttempt.pythonCode}`,
        `執行錯誤:\n${previousAttempt.error}`
      ].join('\n\n')
    : '這是首次生成作圖程式。'

  const imageHint = originalInput?.type === 'image'
    ? '這次會同時提供原始題目圖片，你必須結合圖片內容與文字上下文作圖，但不要沿用手機拍照的外框比例。圖片只用來理解結構與相對位置。'
    : '這次沒有原始題目圖片，請僅依文字上下文作圖。'

  return {
    system: [
      '你是數學作圖 Python 助手。',
      '你的任務是根據題目上下文輸出可直接執行的 Python 程式，並由後端產生 JPG 圖片。',
      '只能使用 Python 標準庫與 matplotlib。',
      '程式必須把最終圖片輸出到字串常量 __OUTPUT_IMAGE_PATH__ 指定的位置。',
      '不要使用互動介面，不要顯示視窗，必須直接存檔。',
      '圖片內容必須聚焦題目本身，不要加入與題目無關的裝飾。',
      '圖上只能保留清晰必要的幾何元素、點名、線段名、角名，以及題目本身已給出的數值或符號標記。',
      '可以標示題目已知條件，例如點位名稱、長度、角度、半徑、x、y、r 等；但不能額外把解題推導、結論、證明步驟、公式變形、文字講解寫到圖上。',
      '嚴禁在圖上寫出解題過程，例如「由 SAS 得...」、「內角和 180°」、「代入可得」、「所以答案是...」這種說明文字。',
      '目標只是把圖畫得清晰、乾淨、可讀，讓學生看圖理解題目，不是把解說直接印在圖上。',
      '不要根據使用者拍照比例決定畫布尺寸；畫布比例必須以數學圖形本身最清晰、最均衡為優先。',
      '請先判斷圖形最適合的畫布類型，只能選 square、portrait、landscape、wide 其中之一。',
      '若是圓形、扇形、中心構圖，優先使用 square。',
      '若圖形上下延展更明顯，使用 portrait。',
      '若圖形左右延展更明顯，使用 landscape 或 wide。',
      'Python 程式中不要自行決定 figsize，必須改用 __FIGSIZE__ 常量。',
      '你必須直接寫 figsize=__FIGSIZE__，不可寫成帶引號的 "__FIGSIZE__" 或 \'__FIGSIZE__\'。',
      '你必須直接把 __OUTPUT_IMAGE_PATH__ 當成 Python 字串常量使用，不可再手動加引號。',
      '例如要寫 output_path = __OUTPUT_IMAGE_PATH__，不可寫 output_path = "__OUTPUT_IMAGE_PATH__" 或 output_path = \'__OUTPUT_IMAGE_PATH__\'。',
      '不要使用 tight_layout()，也不要在 savefig 或 fig.savefig 中使用 bbox_inches="tight" 或 bbox_inches=\'tight\'。',
      '請優先使用 fig, ax = plt.subplots(figsize=__FIGSIZE__)。',
      '請優先使用 fig.savefig(__OUTPUT_IMAGE_PATH__, format="jpg", dpi=160) 或先令 output_path = __OUTPUT_IMAGE_PATH__ 再存檔。',
      '生成前先自查：Python 程式必須同時包含 __OUTPUT_IMAGE_PATH__ 與 __FIGSIZE__，且兩者都不能放在引號內。',
      jsonBlockInstructions('返回 JSON: {"reasoningSummary":"","imageFormat":"jpg","expectedFilename":"diagram.jpg","canvasType":"square|portrait|landscape|wide","pythonCode":""}')
    ].join('\n'),
    userText() {
      return [
        `題目: ${normalizedProblem.problemText}`,
        normalizedProblem.goal ? `求解目標: ${normalizedProblem.goal}` : '求解目標: 請依題意判斷',
        normalizedProblem.knownConditions.length > 0 ? `已知條件: ${normalizedProblem.knownConditions.join('；')}` : '已知條件: 無法額外提取',
        `最終答案: ${judgeResult.finalAnswer}`,
        imageHint,
        retrySection,
        '請輸出可直接執行的 Python 作圖程式，成功產生 JPG 檔。'
      ].join('\n\n')
    },
    userContent() {
      if (originalInput?.type !== 'image' || !originalInput.imageBase64) {
        return null
      }

      return [
        {
          type: 'text',
          text: this.userText()
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: originalInput.mediaType || 'image/png',
            data: originalInput.imageBase64
          }
        }
      ]
    },
    user() {
      return this.userText()
    }
  }
}

export function buildDiagramRepairPrompt({ basePrompt, brokenOutput, errorMessage }) {
  return {
    system: [
      basePrompt.system,
      '你現在不是重新規劃新題，而是修復上一版作圖 JSON。',
      '你會收到解析或驗證錯誤，以及上一版錯誤輸出。',
      '請重新輸出一份完整、合法、可 JSON.parse 的 JSON。',
      '禁止只補尾巴，禁止續寫半截內容，必須完整重發。'
    ].join('\n\n'),
    userText() {
      return [
        typeof basePrompt.userText === 'function' ? basePrompt.userText() : (typeof basePrompt.user === 'function' ? basePrompt.user() : ''),
        `解析/驗證錯誤: ${errorMessage}`,
        '以下是上一版錯誤輸出，請完整重發正確 JSON。',
        brokenOutput
      ].filter(Boolean).join('\n\n')
    },
    userContent() {
      if (typeof basePrompt.userContent === 'function') {
        const content = basePrompt.userContent()
        if (Array.isArray(content) && content.length > 0) {
          const [first, ...rest] = content
          return [
            {
              ...first,
              text: this.userText()
            },
            ...rest
          ]
        }
      }
      return null
    },
    user() {
      return this.userText()
    }
  }
}
