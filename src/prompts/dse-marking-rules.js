export function buildDseMarkingRules() {
  return [
    '你必須把 HKDSE Mathematics Compulsory Part 的評分語義當成硬規則，而不是一般參考。',
    '長題的評分指引必須使用 marks and remarks 風格，而不是只寫總分或泛泛說明。',
    '你必須明確理解並正確使用以下記號：B1、M1、A1、ft。',
    'B 分代表獨立基本分；M 分代表方法分；A 分代表準確分；ft 代表 follow-through，可沿用前面錯誤但方法合理的後續步驟給分。',
    'A 分通常依附於相應方法或前提成立時才可獲得；不要把 A 分當成獨立亂給。',
    '若答案存在可接受等價形式，remarks 必須標示 accept / allow equivalent form。',
    '若學生可能以常見但非標準的方法作答，而該方法在邏輯上值得部分分，remarks 必須寫明可給分條件。',
    '若存在 ft 情境，remarks 必須清楚指出是基於哪一步前錯後對而可跟分，不能濫用 ft。',
    '評分指引語氣要接近 HKDSE answer book，不要寫成一般教學筆記。',
    '每道 long question 的 marking scheme 至少要按小題或關鍵步驟拆分，清楚寫出每一步可得的 marks and remarks。',
    '若是 MC 題，仍要提供簡明的正解理由與干擾項設計依據，但不需要虛構長題式 marks and remarks。'
  ].join('\n')
}
