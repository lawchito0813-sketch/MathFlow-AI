function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeLabel(value, fallback = '整題') {
  return isNonEmptyString(value) ? value.trim() : fallback
}

function normalizeMarks(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return fallback
  return Math.round(number * 100) / 100
}

function normalizeSource(value) {
  return value === 'problem' || value === 'estimated' ? value : 'estimated'
}

function normalizeSubpart(item, index) {
  return {
    label: normalizeLabel(item?.label, `part_${index + 1}`),
    maxMarks: normalizeMarks(item?.maxMarks, 0),
    reasoning: isNonEmptyString(item?.reasoning) ? item.reasoning.trim() : ''
  }
}

export function validateReviewScorePlan(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('分數規劃結果必須是物件')
  }

  const subparts = Array.isArray(data.subparts)
    ? data.subparts.map((item, index) => normalizeSubpart(item, index)).filter(item => item.maxMarks > 0)
    : []

  const totalFromSubparts = subparts.reduce((sum, item) => sum + item.maxMarks, 0)
  const totalMarks = normalizeMarks(data.totalMarks, totalFromSubparts || 0)

  return {
    totalMarks,
    totalMarksSource: normalizeSource(data.totalMarksSource),
    reasoning: isNonEmptyString(data.reasoning) ? data.reasoning.trim() : '',
    subparts: subparts.length > 0
      ? subparts
      : [{ label: '整題', maxMarks: totalMarks, reasoning: '' }]
  }
}
