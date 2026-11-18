import { describe, expect, test } from "vitest"
import { escapeHtml, genRandStr, params, parseExpiration, WorkerError } from "../src/common.js"

describe("parseExpiration", () => {
  test.each([undefined, ""])("keeps an unspecified expiration (%s) as NaN", (input) => {
    expect(parseExpiration(input)).toBeNaN()
  })

  test.each([
    ["0", 0],
    ["59", 59], // The HTTP handler, not this parser, enforces the KV minimum TTL.
    ["60", 60],
    ["60s", 60],
    ["2m", 120],
    ["1.5h", 5400],
    ["1d", 86400],
    ["1w", 604800],
    ["1M", 2592000],
    ["1Y", 31536000],
    ["100  m", 6000],
    ["60.0", 60],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
  ])("parses %s into %s safe integer seconds", (input, expected) => {
    const seconds = parseExpiration(input)
    expect(seconds).toBe(expected)
    expect(Number.isSafeInteger(seconds)).toBe(true)
  })

  test.each([
    ".",
    "60..1",
    "60.5",
    "1.0001h",
    "Infinity",
    Infinity,
    "NaN",
    "9007199254740992",
    "9007199254740991Y", // A safe numeric prefix can overflow after unit conversion.
    "9".repeat(400),
    "-60",
    "+60",
    "1e3",
    "0x40",
    "60seconds",
    "60ms",
    "60junk",
    " ",
  ])("rejects invalid or unsafe expiration %s with WorkerError 400", (input) => {
    expect(() => parseExpiration(input)).toThrow(WorkerError)
    expect(() => parseExpiration(input)).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe("genRandStr", () => {
  test.each([0, 1, params.RAND_LEN, params.PRIVATE_RAND_LEN, params.ADMIN_PATH_LEN, 257])(
    "returns exactly %i characters from the configured alphabet",
    (length) => {
      const value = genRandStr(length)
      expect(typeof value).toBe("string")
      expect(value).toHaveLength(length)
      for (const character of value) {
        expect(params.CHAR_GEN.includes(character)).toBe(true)
      }
    },
  )
  // Deliberately avoid probabilistic uniqueness assertions: collisions are valid.
})

describe("escapeHtml", () => {
  test.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
    ["'", "&#x27;"],
    ["", ""],
    ["普通文本 café", "普通文本 café"],
    ["&amp;", "&amp;amp;"],
  ])("escapes %s without changing unrelated text", (input, expected) => {
    expect(escapeHtml(input)).toBe(expected)
  })

  test("escapes every occurrence of all five HTML-sensitive characters", () => {
    expect(escapeHtml(`<a title="x" data-value='y'>&</a> &`)).toBe(
      "&lt;a title=&quot;x&quot; data-value=&#x27;y&#x27;&gt;&amp;&lt;/a&gt; &amp;",
    )
  })
})
