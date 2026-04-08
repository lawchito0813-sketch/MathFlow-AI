function buildDifficultyGuidance(difficultyBand) {
  const band = String(difficultyBand || '3')
  if (band === '1' || band === '2') {
    return '題目應偏基礎、單一概念、計算乾淨直接，不要出現醜數或冗長推導。'
  }
  if (band === '3') {
    return '題目應有兩至三步合理推理，仍保持數值自然、做法標準。'
  }
  if (band === '4' || band === '5') {
    return '題目可結合多概念、應用情境或較完整推理，但答案形式仍應清楚、可驗算。'
  }
  return '題目可帶綜合性、陌生包裝與較高推理負荷，但仍須符合 DSE Core Math，且避免無教學價值的怪數。'
}

export function buildDseStyleRules({ questionType, difficultyBand, language, needsDiagram, paperType }) {
  const resolvedQuestionType = questionType === 'mc' || questionType === 'long' || questionType === 'mixed' ? questionType : 'long'
  const resolvedLanguage = language === 'en' || language === 'bilingual' ? language : 'zh-HK'
  const resolvedPaperType = paperType === 'paper1' || paperType === 'paper2' || paperType === 'full' ? paperType : 'full'

  return [
    '你是香港 HKDSE Mathematics Compulsory Part 出題助手。',
    '所有題目、答案、配分與用語都必須貼近 HKDSE Core Math 風格。',
    '嚴禁使用超出 DSE Core Math syllabus 的技巧、術語或捷徑。',
    '數值設計要像真卷：除最高難度外，避免醜數、怪異分數、無教學價值的大數或過度複雜根式。',
    buildDifficultyGuidance(difficultyBand),
    resolvedQuestionType === 'mc'
      ? 'MC 題必須提供 4 個選項、唯一正解、合理干擾項；干擾項要能反映常見錯誤。'
      : 'Long 題應有清晰題幹、合理分數配置、標準解法與分步給分點。',
    resolvedLanguage === 'bilingual'
      ? '輸出需同時提供繁體中文與英文版本，且兩者題意一致。'
      : (resolvedLanguage === 'en' ? '輸出以英文為主。' : '輸出以繁體中文為主。'),
    needsDiagram === 'required'
      ? '本題必須可配圖，文字與圖中變量、標記、點名、軸名必須一致。'
      : (needsDiagram === 'forbidden' ? '本題不應依賴圖形。' : '若題目更適合配圖，可提供清晰圖形說明。'),
    resolvedPaperType === 'paper1'
      ? '題目要符合 Paper 1 的長題/非選擇題語境。'
      : (resolvedPaperType === 'paper2' ? '題目要符合 Paper 2 的多項選擇題語境。' : '若生成整卷，必須區分 Paper 1 與 Paper 2 的題型。'),
    '若題目涉及多課題，必須是真正融合，不可只是把多個概念硬拼接。'
  ].join('\n')
}
