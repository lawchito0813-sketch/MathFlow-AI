function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateDseAuthorPaper(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('整卷結果必須是物件')
  }

  return {
    paperTitle: isNonEmptyString(data.paperTitle) ? data.paperTitle.trim() : '',
    paperType: data.paperType === 'paper1' || data.paperType === 'paper2' || data.paperType === 'full' ? data.paperType : 'full',
    summary: isNonEmptyString(data.summary) ? data.summary.trim() : '',
    editorNotes: isNonEmptyString(data.editorNotes) ? data.editorNotes.trim() : ''
  }
}
