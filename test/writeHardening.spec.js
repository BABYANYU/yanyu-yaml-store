import { expect, test, vi } from "vitest"
import worker from "../src/index.js"

const BASE_URL = "https://write-contract.example"
const MIB = 1024 * 1024
const CONTENT_LIMIT = 25 * MIB
const BODY_LIMIT = CONTENT_LIMIT + MIB
const SHORT = "hardening"
const PASSWORD = "existing-password"
const ORIGINAL_CONTENT = "original content"
const POSTED_AT = "2024-01-01T00:00:00.000Z"

// Keep KV local: rejected writes must not mutate storage, regardless of whether
// production KV would reject the same options later.
function fixture({ expiration, metadataExpiration = true } = {}) {
  const metadata = { passwd: PASSWORD, postedAt: POSTED_AT }
  if (expiration !== undefined && metadataExpiration) metadata.expiration = expiration
  const PB = {
    get: vi.fn(async () => null),
    getWithMetadata: vi.fn(async () => ({ value: ORIGINAL_CONTENT, metadata: { ...metadata } })),
    list: vi.fn(async () => ({
      keys: [{ name: SHORT, ...(expiration === undefined ? {} : { expiration }) }],
      list_complete: true,
      cursor: "",
    })),
    put: vi.fn(async () => {}),
  }
  return { PB, env: { PB, BASE_URL } }
}

function requestFor(method, fields = { c: "replacement content" }) {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  return new Request(method === "PUT" ? `${BASE_URL}/${SHORT}:${PASSWORD}` : BASE_URL, {
    method,
    body: form,
  })
}

async function fetchWrite(request, env) {
  return worker.fetch(request, env, {})
}

test("PUT with an incorrect password leaves the real multipart body unread and never writes", async () => {
  const { PB, env } = fixture()
  const form = new FormData()
  form.set("c", "must remain unread")
  const request = new Request(`${BASE_URL}/${SHORT}:wrong-password`, { method: "PUT", body: form })

  const response = await fetchWrite(request, env)

  expect(response.status).toBe(403)
  expect(PB.getWithMetadata).toHaveBeenCalledWith(SHORT)
  expect(PB.put).not.toHaveBeenCalled()
  expect(request.bodyUsed).toBe(false)
  expect(request.body.locked).toBe(false)
  // Reading the original request after rejection also detects handlers which
  // acquired/consumed its stream without calling request.formData().
  expect((await request.formData()).get("c")).toBe("must remain unread")
})

for (const method of ["POST", "PUT"]) {
  test.each([
    ["missing", "multipart/form-data"],
    ["empty", "multipart/form-data; boundary="],
    ["quoted empty", 'multipart/form-data; boundary=""'],
    ["unterminated quoted", 'multipart/form-data; boundary="broken'],
    ["quoted invalid character", 'multipart/form-data; boundary="bad;boundary"'],
    ["quoted trailing space", 'multipart/form-data; boundary="boundary "'],
  ])(`${method} rejects a %s boundary with 400 before consuming the body`, async (_, contentType) => {
    const { PB, env } = fixture()
    const request = requestFor(method)
    request.headers.set("content-type", contentType)

    const response = await fetchWrite(request, env)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe("Error 400: invalid multipart boundary\n")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(PB.put).not.toHaveBeenCalled()
    expect(request.bodyUsed).toBe(false)
    expect(request.body.locked).toBe(false)
  })
}

test.each(["POST", "PUT"])("%s accepts a valid quoted boundary", async (method) => {
  const { PB, env } = fixture()
  const request = requestFor(method)
  const contentType = request.headers.get("content-type")
  const boundary = contentType.slice(contentType.indexOf("boundary=") + "boundary=".length)
  request.headers.set("content-type", `multipart/form-data; boundary="${boundary}"`)

  const response = await fetchWrite(request, env)

  expect(response.status).toBe(200)
  expect(PB.put).toHaveBeenCalledTimes(1)
  expect(new TextDecoder().decode(PB.put.mock.calls[0][1])).toBe("replacement content")
})

test.each(["POST", "PUT"])("%s rejects an actual multipart body over 26 MiB without a Content-Length hint", async (method) => {
  const { PB, env } = fixture()
  const request = requestFor(method, {
    c: "small content",
    padding: new Blob([new Uint8Array(BODY_LIMIT)], { type: "application/octet-stream" }),
  })
  request.headers.delete("content-length")
  // The padding alone is 26 MiB; real multipart framing makes the total larger.
  // c remains small so a check of the content field alone cannot pass this test.
  const response = await fetchWrite(request, env)

  expect(response.status).toBe(413)
  expect(PB.put).not.toHaveBeenCalled()
})

test("POST accepts 25 MiB of content plus normal multipart overhead", async () => {
  const { PB, env } = fixture()
  const request = requestFor("POST", {
    c: new Blob([new Uint8Array(CONTENT_LIMIT)], { type: "application/octet-stream" }),
  })

  const response = await fetchWrite(request, env)

  expect(response.status).toBe(200)
  expect(PB.put).toHaveBeenCalledTimes(1)
  expect(PB.put.mock.calls[0][1].byteLength).toBe(CONTENT_LIMIT)
})

test.each(["POST", "PUT"])("%s rejects a declared body above 26 MiB before consuming it", async (method) => {
  const { PB, env } = fixture()
  const request = requestFor(method)
  request.headers.set("content-length", String(BODY_LIMIT + 1))

  const response = await fetchWrite(request, env)

  expect(response.status).toBe(413)
  expect(PB.put).not.toHaveBeenCalled()
  expect(request.bodyUsed).toBe(false)
})

for (const method of ["POST", "PUT"]) {
  test.each(["abc", "1c", "-100m", "59", "60junk", "1.5", "Infinity", "9007199254740992"])(
    `${method} rejects invalid expiration %j before KV put`,
    async (expiration) => {
      const { PB, env } = fixture()
      const response = await fetchWrite(requestFor(method, { c: "replacement", e: expiration }), env)

      expect(response.status).toBe(400)
      expect(PB.put).not.toHaveBeenCalled()
    },
  )
}

test.each([true, false])("PUT without e preserves absolute expiration (metadata present: %s)", async (metadataExpiration) => {
  // Deliberately use an existing absolute timestamp, not a fresh TTL: updating
  // the content must neither remove expiry nor restart its original lifetime.
  const expiration = Math.floor(Date.now() / 1000) + 600
  const { PB, env } = fixture({ expiration, metadataExpiration })

  const response = await fetchWrite(requestFor("PUT"), env)

  expect(response.status).toBe(200)
  expect(PB.put).toHaveBeenCalledTimes(1)
  const [key, content, options] = PB.put.mock.calls[0]
  expect(key).toBe(SHORT)
  expect(new TextDecoder().decode(content)).toBe("replacement content")
  expect(options.expiration).toBe(expiration)
  expect(options.expirationTtl).toBeUndefined()
  expect(options.metadata.postedAt).toBe(POSTED_AT)
  expect(options.metadata.passwd).toBe(PASSWORD)
  const created = await response.json()
  expect(created.admin).toBe(`${BASE_URL}/${SHORT}:${PASSWORD}`)
  expect(created.expire).toBeGreaterThan(0)
  expect(created.expire).toBeLessThanOrEqual(600)
})

for (const method of ["POST", "PUT"]) {
  test.each(["bad:password", "bad/password", "bad.password", "bad?password", "bad#password", "bad%2Fpassword", "bad\\password"])(
    `${method} rejects URL-delimiting new password %j without writing`,
    async (password) => {
      const { PB, env } = fixture()
      const response = await fetchWrite(requestFor(method, { c: "replacement", s: password }), env)

      expect(response.status).toBe(400)
      expect(PB.put).not.toHaveBeenCalled()
    },
  )
}

test.each(["POST", "PUT"])("%s keeps the UI empty-password default behavior", async (method) => {
  const { PB, env } = fixture()
  const response = await fetchWrite(requestFor(method, { c: "replacement", s: "" }), env)

  expect(response.status).toBe(200)
  expect(PB.put).toHaveBeenCalledTimes(1)
  const [key, , options] = PB.put.mock.calls[0]
  const generated = options.metadata.passwd
  if (method === "POST") {
    expect(generated).toHaveLength(24)
    expect(generated).toMatch(/^[ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678]+$/)
  } else {
    // Leaving the editor password blank must not unexpectedly rotate it.
    expect(generated).toBe(PASSWORD)
  }
  const created = await response.json()
  expect(created.admin).toBe(`${BASE_URL}/${key}:${generated}`)
  // The returned default credential must actually authorize a subsequent PUT.
  PB.getWithMetadata.mockResolvedValue({ value: "replacement", metadata: options.metadata })
  PB.list.mockResolvedValue({ keys: [{ name: key }], list_complete: true, cursor: "" })
  const form = new FormData()
  form.set("c", "second revision")
  const updated = await fetchWrite(new Request(created.admin, { method: "PUT", body: form }), env)
  expect(updated.status).toBe(200)
  expect(PB.put).toHaveBeenCalledTimes(2)
  expect(PB.put.mock.calls[1][2].metadata.passwd).toBe(generated)
})

test("PUT preserves a permanent paste marked with null expiration without a list lookup", async () => {
  const { PB, env } = fixture({ expiration: null })
  const response = await fetchWrite(requestFor("PUT"), env)

  expect(response.status).toBe(200)
  expect(PB.list).not.toHaveBeenCalled()
  expect(PB.put).toHaveBeenCalledTimes(1)
  const options = PB.put.mock.calls[0][2]
  expect(options.expiration).toBeUndefined()
  expect(options.expirationTtl).toBeUndefined()
  expect(options.metadata.expiration).toBeNull()
  expect((await response.json()).expire).toBeNull()
})

test("PUT of a legacy paste finds the exact key across KV list pages", async () => {
  const expiration = Math.floor(Date.now() / 1000) + 600
  const { PB, env } = fixture({ expiration, metadataExpiration: false })
  PB.list
    .mockResolvedValueOnce({ keys: [{ name: `${SHORT}-neighbor`, expiration: expiration + 1000 }], list_complete: false, cursor: "next-page" })
    .mockResolvedValueOnce({ keys: [{ name: SHORT, expiration }], list_complete: true, cursor: "" })

  const response = await fetchWrite(requestFor("PUT"), env)

  expect(response.status).toBe(200)
  expect(PB.list).toHaveBeenCalledTimes(2)
  expect(PB.list.mock.calls[0][0]).toMatchObject({ prefix: SHORT, limit: 100 })
  expect(PB.list.mock.calls[1][0]).toMatchObject({ prefix: SHORT, limit: 100, cursor: "next-page" })
  expect(PB.put.mock.calls[0][2].expiration).toBe(expiration)
})

test.each(["missing key", "page budget"])("PUT refuses unknown legacy expiration (%s) without writing", async (failure) => {
  const { PB, env } = fixture()
  PB.list.mockImplementation(async () => ({
    keys: [{ name: `${SHORT}-neighbor` }],
    list_complete: failure === "missing key",
    cursor: `page-${PB.list.mock.calls.length}`,
  }))

  const response = await fetchWrite(requestFor("PUT"), env)

  expect(response.status).toBe(503)
  expect(PB.put).not.toHaveBeenCalled()
  expect(PB.list).toHaveBeenCalledTimes(failure === "missing key" ? 1 : 3)
})

test("PUT refuses a paste expiring in under 60 seconds instead of extending it", async () => {
  const { PB, env } = fixture({ expiration: Math.floor(Date.now() / 1000) + 30 })
  const response = await fetchWrite(requestFor("PUT"), env)

  expect(response.status).toBe(400)
  expect(PB.put).not.toHaveBeenCalled()
})

test("suggestUrl encodes a special filename as one path segment", async () => {
  const { PB, env } = fixture()
  const filename = "报告 100% #draft?part=1&copy.txt"
  const form = new FormData()
  form.set("c", new Blob(["file content"], { type: "text/plain" }), filename)

  const response = await fetchWrite(new Request(BASE_URL, { method: "POST", body: form }), env)

  expect(response.status).toBe(200)
  expect(PB.put).toHaveBeenCalledTimes(1)
  expect(PB.put.mock.calls[0][2].metadata.filename).toBe(filename)
  const created = await response.json()
  expect(created.suggestUrl).toBe(`${created.url}/${encodeURIComponent(filename)}`)
  const suggested = new URL(created.suggestUrl)
  expect(suggested.search).toBe("")
  expect(suggested.hash).toBe("")
  expect(decodeURIComponent(suggested.pathname.split("/").pop())).toBe(filename)
})
