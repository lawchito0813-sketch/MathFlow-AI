export function initSse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'access-control-allow-origin': '*'
  })

  res.write(': connected\n\n')
}

export function sendSseEvent(res, event) {
  res.write(`event: ${event.type}\n`)
  res.write(`data: ${JSON.stringify(event.payload || {})}\n\n`)
}
