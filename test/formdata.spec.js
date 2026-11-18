import { parseFormdata, getBoundary } from "../src/parseFormdata.js"
import { test, expect } from "vitest"

const encode = value => new TextEncoder().encode(value)
const multipart = (parts, boundary = 'abc', ending = '\r\n') => encode(
  parts.map(({ headers = 'Content-Disposition: form-data; name="c"', body = '' }) =>
    `--${boundary}\r\n${headers}\r\n\r\n${body}\r\n`).join('') + `--${boundary}--${ending}`
)

test('boundary parameters support quotes, case, ordering and quoted semicolons', () => {
  expect(getBoundary('Multipart/Form-Data; charset=utf-8; BOUNDARY="a:b c"; other="x;y"')).toBe('a:b c')
  expect(getBoundary('multipart/form-data; boundary=abc; charset=UTF-8')).toBe('abc')
  expect(getBoundary(`multipart/form-data; boundary=${'a'.repeat(70)}`)).toHaveLength(70)
})

test.each([
  undefined, null, '', 'text/plain; boundary=abc', 'multipart/form-data',
  'multipart/form-data; boundary=""', 'multipart/form-data; boundary="abc "',
  'multipart/form-data; boundary="abc', 'multipart/form-data; boundary=abc; BOUNDARY=def',
  'multipart/form-data; boundary="a\r\nb"', 'multipart/form-data; boundary="é"',
  'multipart/form-data; boundary="a;b"', `multipart/form-data; boundary=${'a'.repeat(71)}`,
  'multipart/form-data; boundary=abc garbage', 'multipart/form-data; boundary=abc; broken'
])('rejects invalid content type %s', value => {
  expect(() => getBoundary(value)).toThrow()
})

test('disposition case, escaped values and filename* preserve parameter values', () => {
  const headers = `cOnTeNt-DiSpOsItIoN: FORM-DATA; NAME="c"; filename="a;\\\"b.txt"; filename*=UTF-8''%E4%B8%AD.txt\r\nContent-Type: application/octet-stream`
  const part = parseFormdata(multipart([{ headers, body: 'data' }]), 'abc').get('c')
  expect(part.fields).toEqual({ name: 'c', filename: 'a;"b.txt', 'filename*': "UTF-8''%E4%B8%AD.txt" })
  expect(part.content).toBeInstanceOf(Uint8Array)
  expect(part.content).toEqual(encode('data'))
})

test('preserves all binary values, CRLF and near-boundary bytes', () => {
  const content = Buffer.concat([
    Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
    Buffer.from('\r\n--abcX\r\n--abc--X\r\n--ab\r\n--abc-\r\n--ABC\r\n--abc \r\nend\r\n')
  ])
  const body = Buffer.concat([
    Buffer.from('--abc\r\nContent-Disposition: form-data; name="c"\r\n\r\n'),
    content, Buffer.from('\r\n--abc--')
  ])
  expect(Buffer.from(parseFormdata(body, 'abc').get('c').content)).toEqual(content)
})

test('supports empty content, empty names and empty multipart', () => {
  expect(parseFormdata(multipart([{}]), 'abc').get('c').content).toHaveLength(0)
  expect(parseFormdata(multipart([{ headers: 'Content-Disposition: form-data; name=""' }]), 'abc').has('')).toBe(true)
  expect(parseFormdata(encode('--abc--\r\n'), 'abc').size).toBe(0)
  expect(parseFormdata(encode('--abc--'), 'abc').size).toBe(0)
})

test.each([
  '', 'garbage', 'preamble\r\n--abc--', '--wrong--', '--abc', '--abc\r\n',
  '--abc\r\nContent-Disposition: form-data; name="c"',
  '--abc\r\nContent-Disposition: form-data; name="c"\r\n\r\ndata',
  '--abc\r\nContent-Disposition: form-data; name="c"\r\n\r\ndata\r\n--abc',
  '--abc--\r\nepilogue', '--abc--\n', '--abc--\r',
  '--abc\nContent-Disposition: form-data; name="c"\n\ndata\n--abc--',
  '--abc\r\nContent-Disposition: form-data; name="c"\r\n\r\ndata\r\n--abc\r\n--'
])('rejects malformed or truncated framing without looping: %j', value => {
  expect(() => parseFormdata(encode(value), 'abc')).toThrow()
})

test.each([
  'Content-Type: text/plain',
  'Content-Disposition: attachment; name="c"',
  'Content-Disposition: form-data; filename="a.txt"',
  'Content-Disposition: form-data; name="c"; NAME="d"',
  'Content-Disposition: form-data; name="c"\r\ncontent-disposition: form-data; name="d"',
  'Content-Disposition: form-data; name="c"\r\n folded: value',
  'Content-Disposition: form-data; name="c"\r\nBad Header: value',
  'Content-Disposition: form-data; name="c"\nInjected: value',
  'Content-Disposition: form-data; name="c"\r\nX: value\u0000'
])('rejects malformed or ambiguous part headers %j', headers => {
  expect(() => parseFormdata(multipart([{ headers }]), 'abc')).toThrow()
})

test('rejects duplicate field names including empty names', () => {
  expect(() => parseFormdata(multipart([{}, {}]), 'abc')).toThrow(/duplicate field name/)
  const part = { headers: 'Content-Disposition: form-data; name=""' }
  expect(() => parseFormdata(multipart([part, part]), 'abc')).toThrow(/duplicate field name/)
})

test('enforces exactly the 16 KiB header and 32 part limits', () => {
  const prefix = 'Content-Disposition: form-data; name="c"\r\nX-Padding: '
  const headers = prefix + 'x'.repeat(16 * 1024 - prefix.length)
  expect(parseFormdata(multipart([{ headers }]), 'abc').size).toBe(1)
  expect(() => parseFormdata(multipart([{ headers: headers + 'x' }]), 'abc')).toThrow(/headers/)
  expect(() => parseFormdata(encode('--abc\r\n' + headers + 'x'), 'abc')).toThrow(/headers/)
  const parts = Array.from({ length: 32 }, (_, i) => ({ headers: `Content-Disposition: form-data; name="f${i}"` }))
  expect(parseFormdata(multipart(parts), 'abc').size).toBe(32)
  expect(() => parseFormdata(multipart([...parts, { headers: 'Content-Disposition: form-data; name="f32"' }]), 'abc')).toThrow(/too many parts/)
})

test('validates direct boundary arguments and retains safe own parameter properties', () => {
  for (const boundary of [undefined, '', 'a'.repeat(71), 'a\r\nb', 'é']) {
    expect(() => parseFormdata(encode('--abc--'), boundary)).toThrow(/boundary/)
  }
  expect(() => parseFormdata('not bytes', 'abc')).toThrow(/Uint8Array/)
  const part = parseFormdata(multipart([{ headers: 'Content-Disposition: form-data; name="__proto__"; __proto__="literal"' }]), 'abc').get('__proto__')
  expect(Object.getPrototypeOf(part.fields)).toBe(Object.prototype)
  expect(Object.hasOwn(part.fields, '__proto__')).toBe(true)
  expect(part.fields.__proto__).toBe('literal')
})

test('every truncated prefix before the closing marker is rejected', () => {
  const body = multipart([{ body: 'payload' }], 'abc', '')
  for (let length = 0; length < body.length; length++) {
    expect(() => parseFormdata(body.subarray(0, length), 'abc')).toThrow()
  }
  expect(parseFormdata(body, 'abc').size).toBe(1)
})

test("basic formdata", async () => {
  const boundary = "-----------------------------27048489924104183609341311243"
  const boundaryLine = `--${boundary}\r\n`

  const content = "print('Error 2\\n', omg, '\\n', theta, '\\n', expse3mat, '\\n', explogexpse3mat)\r\n" +
    "print('diff = ', np.max(np.abs(expse3mat - explogexpse3mat)))\r\n" +
    "break"

  const secret = "dgfadgfdgfd"
  const filename = "a.py"

  const fullBody =
    boundaryLine +
    `Content-Disposition: form-data; name="c"; filename="${filename}"\r\n\r\n` +
    content + "\r\n" +
    boundaryLine +
    "Content-Disposition: form-data; name=\"s\";\r\n\r\n" +
    secret + "\r\n" +
    `--${boundary}--\r\n`

  const bodyBuffer = Buffer.from(fullBody, "utf-8")
  const parts = parseFormdata(bodyBuffer, boundary)

  // compare "c"
  const parsedContent = new TextDecoder().decode(parts.get("c").content)
  expect(parsedContent).toStrictEqual(content)
  expect(parts.get("c").fields["filename"]).toStrictEqual("a.py")

  // compare "s"
  const parsedSecret = new TextDecoder().decode(parts.get("s").content)
  expect(parsedSecret).toStrictEqual(secret)
})