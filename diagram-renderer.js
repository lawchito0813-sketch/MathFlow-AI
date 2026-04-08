function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function renderShape(shape) {
  if (!shape || typeof shape !== 'object') return ''
  if (shape.type === 'line') {
    return `<line x1="${shape.x1 || 0}" y1="${shape.y1 || 0}" x2="${shape.x2 || 0}" y2="${shape.y2 || 0}" stroke="${escapeXml(shape.stroke || '#2563eb')}" stroke-width="2" />`
  }
  if (shape.type === 'circle') {
    return `<circle cx="${shape.cx || 0}" cy="${shape.cy || 0}" r="${shape.r || 10}" fill="none" stroke="${escapeXml(shape.stroke || '#dc2626')}" stroke-width="2" />`
  }
  if (shape.type === 'point') {
    return `<circle cx="${shape.x || 0}" cy="${shape.y || 0}" r="4" fill="${escapeXml(shape.fill || '#111827')}" />`
  }
  if (shape.type === 'polygon' && Array.isArray(shape.points)) {
    const points = shape.points.map(p => `${p.x || 0},${p.y || 0}`).join(' ')
    return `<polygon points="${points}" fill="none" stroke="${escapeXml(shape.stroke || '#16a34a')}" stroke-width="2" />`
  }
  return ''
}

function renderLabel(label) {
  if (!label || typeof label !== 'object') return ''
  return `<text x="${label.x || 0}" y="${label.y || 0}" font-size="14" fill="#111827">${escapeXml(label.text || '')}</text>`
}

export function renderDiagramPngDataUrl(plan) {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
    <rect width="800" height="500" fill="#ffffff" />
    <text x="24" y="32" font-size="20" fill="#111827">${escapeXml(plan.title || '数学题图形')}</text>
    <text x="24" y="56" font-size="12" fill="#6b7280">${escapeXml(plan.description || '')}</text>
    ${(Array.isArray(plan.shapes) ? plan.shapes : []).map(renderShape).join('')}
    ${(Array.isArray(plan.labels) ? plan.labels : []).map(renderLabel).join('')}
  </svg>`

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
