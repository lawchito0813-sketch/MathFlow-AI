function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateDiagramPlan(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('繪圖規格必須是物件')
  }

  return {
    title: isNonEmptyString(data.title) ? data.title.trim() : '數學題圖形',
    description: isNonEmptyString(data.description) ? data.description.trim() : '',
    shapes: Array.isArray(data.shapes) ? data.shapes : [],
    labels: Array.isArray(data.labels) ? data.labels : []
  }
}
