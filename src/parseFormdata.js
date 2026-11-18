const MAX_HEADER_BYTES = 16 * 1024
const MAX_PARTS = 32
const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function invalid(message) {
  throw new Error(`Invalid multipart form data: ${message}`)
}

function validateBoundary(boundary) {
  // RFC 2046 bchars, with no trailing space. Boundaries are ASCII bytes.
  if (typeof boundary !== 'string' || boundary.length < 1 || boundary.length > 70 ||
      !/^[0-9A-Za-z'()+_,\-./:=? ]*[0-9A-Za-z'()+_,\-./:=?]$/.test(boundary)) {
    invalid('invalid boundary')
  }
  return boundary
}

// Parse parameters without splitting quoted semicolons or escaped quotes.
function parseParameters(value) {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) invalid('invalid header value')
  const separator = value.indexOf(';')
  const type = (separator < 0 ? value : value.slice(0, separator)).trim().toLowerCase()
  const parameters = new Map()
  let offset = separator < 0 ? value.length : separator
  while (offset < value.length) {
    if (value[offset++] !== ';') invalid('invalid parameter separator')
    while (value[offset] === ' ' || value[offset] === '\t') offset++
    if (offset === value.length) break
    const start = offset
    while (offset < value.length && token.test(value[offset])) offset++
    const name = value.slice(start, offset).toLowerCase()
    while (value[offset] === ' ' || value[offset] === '\t') offset++
    if (!name || value[offset++] !== '=') invalid('invalid parameter')
    while (value[offset] === ' ' || value[offset] === '\t') offset++
    let result = ''
    if (value[offset] === '"') {
      offset++
      let closed = false
      while (offset < value.length) {
        let char = value[offset++]
        if (char === '"') { closed = true; break }
        if (char === '\\') {
          if (offset === value.length) invalid('truncated quoted parameter')
          char = value[offset++]
        }
        if (/[\x00-\x1f\x7f]/.test(char)) invalid('invalid quoted parameter')
        result += char
      }
      if (!closed) invalid('unterminated quoted parameter')
    } else {
      const start = offset
      while (offset < value.length && token.test(value[offset])) offset++
      result = value.slice(start, offset)
      if (!result) invalid('empty parameter')
    }
    while (value[offset] === ' ' || value[offset] === '\t') offset++
    if (offset < value.length && value[offset] !== ';') invalid('invalid parameter suffix')
    if (parameters.has(name)) invalid('duplicate parameter')
    parameters.set(name, result)
  }
  return { type, parameters }
}

export function getBoundary(contentType) {
  const { type, parameters } = parseParameters(contentType)
  if (type !== 'multipart/form-data') invalid('expected multipart/form-data')
  return validateBoundary(parameters.get('boundary'))
}

export function parseFormdata(uint8Array, boundary) {
  if (!(uint8Array instanceof Uint8Array)) invalid('expected Uint8Array')
  const marker = encoder.encode('--' + validateBoundary(boundary))
  const parts = new Map()
  const length = uint8Array.length
  const matches = (offset, bytes) => {
    if (offset + bytes.length > length) return false
    for (let i = 0; i < bytes.length; i++) {
      if (uint8Array[offset + i] !== bytes[i]) return false
    }
    return true
  }
  const crlf = offset => uint8Array[offset] === 13 && uint8Array[offset + 1] === 10
  // Only complete delimiter lines count; lookalikes remain body bytes.
  const delimiterAt = offset => {
    if (!matches(offset, marker)) return null
    const end = offset + marker.length
    if (crlf(end)) return { close: false, next: end + 2 }
    if (uint8Array[end] === 45 && uint8Array[end + 1] === 45) {
      if (end + 2 === length) return { close: true, next: length }
      if (crlf(end + 2)) return { close: true, next: end + 4 }
    }
    return null
  }
  let delimiter = delimiterAt(0)
  if (!delimiter) invalid('missing opening boundary')
  let count = 0
  while (true) {
    if (delimiter.close) {
      if (delimiter.next !== length) invalid('unexpected data after closing boundary')
      return parts
    }
    if (++count > MAX_PARTS) invalid('too many parts')
    const headerStart = delimiter.next
    let headerEnd = -1
    // Bound the search itself, including malformed input without a terminator.
    for (let i = headerStart; i <= Math.min(length - 4, headerStart + MAX_HEADER_BYTES); i++) {
      if (crlf(i) && crlf(i + 2)) { headerEnd = i; break }
    }
    if (headerEnd < 0) invalid('missing or oversized part headers')
    let headerText
    try { headerText = decoder.decode(uint8Array.subarray(headerStart, headerEnd)) }
    catch { invalid('invalid header encoding') }
    const headers = new Map()
    for (const line of headerText.split('\r\n')) {
      const colon = line.indexOf(':')
      const name = line.slice(0, colon).toLowerCase()
      if (colon < 1 || !token.test(name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(line)) {
        invalid('malformed part header')
      }
      if (headers.has(name)) invalid('duplicate part header')
      headers.set(name, line.slice(colon + 1).trim())
    }
    const { type, parameters } = parseParameters(headers.get('content-disposition'))
    if (type !== 'form-data' || !parameters.has('name')) invalid('missing form-data name')
    const name = parameters.get('name')
    if (parts.has(name)) invalid('duplicate field name')
    const fields = Object.fromEntries(parameters)
    const bodyStart = headerEnd + 4
    let bodyEnd = -1
    // Every iteration advances and is bounded by the input length, even at EOF.
    for (let i = bodyStart; i < length - 1; i++) {
      if (!crlf(i)) continue
      const candidate = delimiterAt(i + 2)
      if (candidate) { bodyEnd = i; delimiter = candidate; break }
    }
    if (bodyEnd < 0) invalid('missing closing boundary')
    parts.set(name, { fields, content: uint8Array.subarray(bodyStart, bodyEnd) })
  }
}
