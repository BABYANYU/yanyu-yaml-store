import { env } from "cloudflare:test"
import { expect, test, vi } from "vitest"
import worker from "../src/index.js"
import { ALLOWED_METHODS } from "../src/handlers/handleCors.js"
import { encodeBasicAuth } from "../src/auth.js"

import { BASE_URL, randomBlob, upload, workerFetch } from "./testUtils.js"

test("mime type", async () => {
  const url = (await upload(({ "c": randomBlob(1024) })))["url"]

  async function testMime(accessUrl, mime) {
    const resp = await workerFetch(accessUrl)
    expect(resp.headers.get("Content-Type")).toStrictEqual(mime)
  }

  await testMime(url, "text/plain;charset=UTF-8")
  await testMime(`${url}.jpg`, "image/jpeg;charset=UTF-8")
  await testMime(`${url}/test.jpg`, "image/jpeg;charset=UTF-8")
  await testMime(`${url}?mime=random-mime`, "random-mime;charset=UTF-8")
  await testMime(`${url}.jpg?mime=random-mime`, "random-mime;charset=UTF-8")
  await testMime(`${url}/test.jpg?mime=random-mime`, "random-mime;charset=UTF-8")
})

test("cache control", async () => {
  const uploadResp = await upload(({ "c": randomBlob(1024) }))
  const url = uploadResp["url"]
  const resp = await workerFetch(url)
  expect(resp.headers.get("Cache-Control")).toStrictEqual("no-store")

  const indexResp = await workerFetch(BASE_URL)
  if ("CACHE_STATIC_PAGE_AGE" in env) {
    expect(indexResp.headers.get("Cache-Control")).toStrictEqual(`public, max-age=${env.CACHE_STATIC_PAGE_AGE}`)
  } else {
    expect(indexResp.headers.get("Cache-Control")).toBeUndefined()
  }

  const staleResp = await workerFetch(url, {
    headers: {
      "If-Modified-Since": "Mon, 11 Mar 2030 00:00:00 GMT",
    },
  })
  expect(staleResp.status).toStrictEqual(304)
  expect(staleResp.headers.get("Cache-Control")).toStrictEqual("no-store")
})

test("HEAD preserves GET status and headers without a body", async () => {
  const created = await upload({ c: "head fixture" })
  for (const url of [BASE_URL, created.url, `${created.url}?lang=js`, `${BASE_URL}/a/${created.url.split('/').pop()}`, `${BASE_URL}/missing-head-fixture`]) {
    const get = await workerFetch(url)
    const head = await workerFetch(url, { method: "HEAD" })
    expect(head.status).toBe(get.status)
    expect([...head.headers]).toEqual([...get.headers])
    expect(await head.text()).toBe("")
  }
})

test("OPTIONS and 405 advertise the same implemented methods", async () => {
  const options = await workerFetch(BASE_URL, { method: "OPTIONS" })
  const preflight = await workerFetch(BASE_URL, {
    method: "OPTIONS",
    headers: { Origin: "https://client.example", "Access-Control-Request-Method": "DELETE", "Access-Control-Request-Headers": "content-type" },
  })
  const invalid = await workerFetch(BASE_URL, { method: "PATCH" })
  expect(options.headers.get("Allow")).toBe(ALLOWED_METHODS)
  expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe(ALLOWED_METHODS)
  expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*")
  expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBeNull()
  expect(invalid.status).toBe(405)
  expect(invalid.headers.get("Allow")).toBe(ALLOWED_METHODS)
  expect(invalid.headers.get("Cache-Control")).toBe("no-store")
})

test("authenticated and management pages cannot be stored", async () => {
  const authEnv = { ...env, BASIC_AUTH: { fixture: "test-password" } }
  for (const method of ["GET", "HEAD"]) {
    const accepted = await worker.fetch(new Request(BASE_URL, { method, headers: { Authorization: encodeBasicAuth("fixture", "test-password") } }), authEnv, {})
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get("Cache-Control")).toBe("private, no-store")
    const denied = await worker.fetch(new Request(BASE_URL, { method }), authEnv, {})
    expect(denied.status).toBe(401)
    expect(denied.headers.get("Cache-Control")).toBe("no-store")
  }
  const editor = await workerFetch(`${BASE_URL}/fixture:management-password`)
  expect(editor.headers.get("Cache-Control")).toBe("private, no-store")
})

test("raw documents are sandboxed while rendered pages keep scripts", async () => {
  const created = await upload({ c: "# Render fixture" })
  const raw = await workerFetch(`${created.url}?mime=text/html`)
  expect(raw.headers.get("Content-Security-Policy")).toBe("sandbox")
  expect(raw.headers.get("X-Content-Type-Options")).toBe("nosniff")
  for (const url of [`${created.url}?lang=js`, `${BASE_URL}/a/${created.url.split('/').pop()}`]) {
    const rendered = await workerFetch(url)
    expect(rendered.status).toBe(200)
    expect(rendered.headers.get("Content-Security-Policy")).toBeNull()
    expect(rendered.headers.get("Cache-Control")).toBe("no-store")
  }
})

test("redirects and write responses cannot be stored", async () => {
  const created = await upload({ c: "https://example.com/" })
  const redirect = await workerFetch(`${BASE_URL}/u/${created.url.split('/').pop()}`)
  expect(redirect.status).toBe(302)
  expect(redirect.headers.get("Location")).toBe("https://example.com/")
  expect(redirect.headers.get("Cache-Control")).toBe("no-store")
  const deleted = await workerFetch(created.admin, { method: "DELETE" })
  expect(deleted.status).toBe(200)
  expect(deleted.headers.get("Cache-Control")).toBe("no-store")
})

test("unexpected failures hide internal exception messages", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  try {
    const brokenEnv = { ...env, PB: { getWithMetadata: async () => { throw new Error("internal-fixture-detail") } } }
    const response = await worker.fetch(new Request(`${BASE_URL}/failure-fixture`), brokenEnv, {})
    expect(response.status).toBe(500)
    expect(await response.text()).toBe("Error 500: internal server error\n")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  } finally {
    log.mockRestore()
  }
})

test("content disposition without specifying filename", async () => {
  const content = "hello"  // not using Blob here, since FormData.append() automatically add filename for Blob
  const filename = "hello.jpg"

  const uploadResp = await upload({ "c": content })
  const url = uploadResp["url"]

  expect((await workerFetch(url)).headers.get("Content-Disposition"))
    .toStrictEqual("inline")
  expect((await workerFetch(`${url}?a`)).headers.get("Content-Disposition"))
    .toStrictEqual("attachment")

  expect((await workerFetch(`${url}/${filename}`)).headers.get("Content-Disposition"))
    .toStrictEqual(`inline; filename*=UTF-8''${filename}`)
  expect((await workerFetch(`${url}/${filename}?a`)).headers.get("Content-Disposition"))
    .toStrictEqual(`attachment; filename*=UTF-8''${filename}`)
})

test.each([
  ["配置.yaml", "%E9%85%8D%E7%BD%AE.yaml"],
  ["my config.yaml", "my%20config.yaml"],
  ["100%.yaml", "100%25.yaml"],
  ["config#1.yaml", "config%231.yaml"],
  ["literal%20%23%25.yaml", "literal%2520%2523%2525.yaml"],
])("suggestUrl preserves the download filename %s", async (filename, encodedFilename) => {
  const content = "filename fixture"
  const created = await upload({ c: { value: content, filename } })
  expect(created.suggestUrl).toBe(`${created.url}/${encodedFilename}`)

  for (const [suffix, disposition] of [["", "inline"], ["?a", "attachment"]]) {
    for (const method of ["GET", "HEAD"]) {
      // Follow the returned URL unchanged, including its percent-encoded path.
      const response = await workerFetch(`${created.suggestUrl}${suffix}`, { method })
      expect(response.status).toBe(200)
      expect(response.headers.get("Content-Disposition"))
        .toBe(`${disposition}; filename*=UTF-8''${encodedFilename}`)
      expect(await response.text()).toBe(method === "HEAD" ? "" : content)
    }
    // Without a path filename, metadata must not be URI-decoded.
    const metadataResponse = await workerFetch(`${created.url}${suffix}`)
    expect(metadataResponse.status).toBe(200)
    expect(metadataResponse.headers.get("Content-Disposition"))
      .toBe(`${disposition}; filename*=UTF-8''${encodedFilename}`)
  }

  const override = await workerFetch(`${created.url}/%E6%96%B0%20%2520%23.yaml?a`)
  expect(override.status).toBe(200)
  expect(override.headers.get("Content-Disposition"))
    .toBe("attachment; filename*=UTF-8''%E6%96%B0%20%2520%23.yaml")
})

test.each(["bad%.yaml", "bad%2.yaml", "bad%GG.yaml", "bad%E0%A4.yaml", "bad%FF.yaml"])(
  "malformed path filename %s returns a controlled 400",
  async (filename) => {
    const created = await upload({ c: "filename fixture" })
    for (const method of ["GET", "HEAD"]) {
      for (const headers of [{}, { "If-Modified-Since": "Mon, 11 Mar 2030 00:00:00 GMT" }]) {
        const response = await workerFetch(`${created.url}/${filename}`, { method, headers })
        expect(response.status).toBe(400)
        expect(response.headers.get("Cache-Control")).toBe("no-store")
        expect(response.headers.get("Content-Disposition")).toBeNull()
        expect(await response.text()).toBe(method === "HEAD" ? "" : "Error 400: invalid filename encoding\n")
      }
    }
  },
)

test("content disposition with specifying filename", async () => {
  const content = randomBlob(1024)
  const filename = "hello.jpg"
  const altFilename = "world.txt"

  const uploadResp = await upload({ "c": { value: content, filename: filename } })
  const url = uploadResp["url"]

  expect(uploadResp["suggestUrl"]).toStrictEqual(`${url}/${filename}`)

  expect((await workerFetch(url)).headers.get("Content-Disposition"))
    .toStrictEqual(`inline; filename*=UTF-8''${filename}`)
  expect((await workerFetch(`${url}?a`)).headers.get("Content-Disposition"))
    .toStrictEqual(`attachment; filename*=UTF-8''${filename}`)

  expect((await workerFetch(`${url}/${altFilename}`)).headers.get("Content-Disposition"))
    .toStrictEqual(`inline; filename*=UTF-8''${altFilename}`)
  expect((await workerFetch(`${url}/${altFilename}?a`)).headers.get("Content-Disposition"))
    .toStrictEqual(`attachment; filename*=UTF-8''${altFilename}`)
})

