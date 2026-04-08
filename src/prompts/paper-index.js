function jsonBlockInstructions(schemaDescription) {
  return [
    '你必須只輸出合法 JSON。',
    '不要輸出 markdown 程式碼區塊。',
    '不要輸出額外解釋。',
    schemaDescription
  ].join('\n')
}

export function buildPaperIndexPrompt({ source }) {
  const sourceType = source?.sourceType === 'pdf' ? 'pdf' : 'pages'
  const pageCount = Number.isFinite(source?.pageCount) ? source.pageCount : Array.isArray(source?.pages) ? source.pages.length : 0

  return {
    system: [
      '你是香港 DSE Core Math 整卷 PDF 題目索引助手。',
      '只輸出這份 PDF 真正存在的主題號。',
      '不要把小題(a)(b)、續頁、答案頁、空白頁、草稿頁當成新題。',
      '如果同一頁清楚出現上下兩條不同主題號，例如 5 和 6，必須拆成兩筆，而且兩筆都要 samePageMultiQuestion=true。',
      '若同頁兩題，regionHint 只寫 upper 或 lower；不要寫 full page。',
      '只有整頁只有一題時，regionHint 才可寫 full page。',
      '若題目跨頁，crossPage=true 且 pageRange=[start,end]；不要同時把下一題也算進上一題。',
      '單頁題 pageRange 也必須寫成 [n,n]。',
      '題號必須依 PDF 實際可見內容順序遞增；看不到下一題號就停止，不要猜測、不補完、不外推。',
      '若第 n 頁底部開始第 8 題，而第 n+1 頁清楚出現第 9 題題頭，則第 8 題不應包含第 n+1 頁。',
      jsonBlockInstructions('返回 JSON: {"questions":[{"questionNumber":"1","pageRange":[2,2],"samePageMultiQuestion":true,"crossPage":false,"visibleMarks":"(3 marks)","regionHint":"upper|lower|full page","confidence":"high|medium|low"}],"summary":""}')
    ].join('\n'),
    user() {
      if (sourceType === 'pdf') {
        return [
          `這是一份共 ${pageCount} 頁的 PDF。`,
          '任務：建立整卷主題號索引。',
          '重點一：找出同頁雙題，尤其上下排列的連續題號，兩題都必須標記 samePageMultiQuestion=true。',
          '重點二：若後續頁已清楚開始下一題，上一題 pageRange 必須在前一頁結束。',
          '重點三：只列出能在 PDF 中直接確認存在的題號；看不到下一題號就停止。'
        ].join('\n')
      }
      return `這份 PDF 共 ${pageCount} 頁。請識別整卷題目目錄。`
    },
    userContent() {
      if (sourceType === 'pdf') {
        return [{
          type: 'file',
          mimeType: 'application/pdf',
          filePath: source.pdfPath,
          fileName: source.fileName || 'paper.pdf'
        }]
      }

      const items = []
      ;(source.pages || []).slice(0, 12).forEach(page => {
        items.push({ type: 'text', text: `第 ${page.pageNumber} 頁` })
        items.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: page.mediaType || 'image/png',
            data: page.imageBase64
          }
        })
      })
      return items
    },
    stream: true,
    maxCompletionTokens: 1200
  }
}

export function buildPaperIndexRepairPrompt({ basePrompt, brokenOutput, errorMessage }) {
  return {
    system: [
      basePrompt.system,
      '你現在是在修復整卷索引 JSON。',
      '只重發完整合法 JSON。'
    ].join('\n\n'),
    user() {
      return [
        typeof basePrompt.user === 'function' ? basePrompt.user() : '',
        `解析/驗證錯誤: ${errorMessage}`,
        brokenOutput
      ].filter(Boolean).join('\n\n')
    },
    userContent: basePrompt.userContent,
    stream: true,
    maxCompletionTokens: 1200
  }
}
