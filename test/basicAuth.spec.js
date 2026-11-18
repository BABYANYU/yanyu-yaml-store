import { expect, test } from "vitest"
import { areBlobsEqual, BASE_URL, createFormData, randomBlob, staticPages, workerFetchWithAuth } from "./testUtils.js"
import { encodeBasicAuth, decodeBasicAuth, verifyAuth } from "../src/auth.js"

test("basic auth encode and decode", async () => {
  const userPasswdPairs = [
    ["user1", "passwd1"],
    ["あおい", "まなか"],
    ["1234#", "اهلا"],
    ["alice", "a:b:c"],
    ["alice", ""],
    ["\uFEFFalice", "a"],
  ]
  for (const [user, passwd] of userPasswdPairs) {
    const encoded = encodeBasicAuth(user, passwd)
    const decoded = decodeBasicAuth(encoded)
    expect(decoded.username).toStrictEqual(user)
    expect(decoded.password).toStrictEqual(passwd)
  }
})

test.each(["basic", "BASIC", "bAsIc"])("basic auth accepts scheme %s", async (scheme) => {
  const authorization = encodeBasicAuth("alice", "a:b").replace("Basic", scheme)
  expect(decodeBasicAuth(authorization)).toEqual({ username: "alice", password: "a:b" })
  const response = await workerFetchWithAuth({ alice: "a:b" }, BASE_URL, {
    headers: { Authorization: authorization },
  })
  expect(response.status).toBe(200)
})

const invalidHeaders = [
  null,
  "",
  "Basic",
  "Basic ",
  "Bearer YWxpY2U6YQ==",
  "Basic !!!",
  "Basic YWxpY2U6YQ=",
  "Basic YWxpY2U6YQ===",
  "Basic YWxpY2U6YQ== extra",
  "Basic YWxpY2U6YQ==, Basic YWxpY2U6YQ==",
  "Basic YWxpY2U=", // no colon
  "Basic YWxpY2U6/w==", // invalid UTF-8
  "Basic YWxpY2U6YQA=", // control character
  `Basic ${"A".repeat(8192)}`,
]

test.each(invalidHeaders)("basic auth rejects malformed header %#", (authorization) => {
  expect(() => decodeBasicAuth(authorization)).toThrow(expect.objectContaining({ statusCode: 401 }))
})

test("all authentication failures return the same challenge on protected routes", async () => {
  const failures = [
    ...invalidHeaders,
    encodeBasicAuth("missing", "a"),
    encodeBasicAuth("alice", "wrong"),
    encodeBasicAuth("alice", "a:any"),
  ]
  for (const method of ["GET", "HEAD", "POST"]) {
    for (const authorization of failures) {
      const response = await workerFetchWithAuth({ alice: "a" }, BASE_URL, {
        method,
        headers: authorization === null ? {} : { Authorization: authorization },
      })
      expect(response.status).toBe(401)
      expect(response.headers.get("WWW-Authenticate")).toBe('Basic charset="UTF-8"')
      expect(await response.text()).toBe(method === "HEAD" ? "" : "HTTP basic auth is required")
    }
  }
})

test("basic auth bounds header length before decoding", () => {
  const authorization = encodeBasicAuth("alice", "a")
  const padded = `Basic${" ".repeat(8192 - authorization.length + 1)}${authorization.slice(6)}`
  expect(padded.length).toBe(8192)
  expect(decodeBasicAuth(padded)).toEqual({ username: "alice", password: "a" })
  expect(() => decodeBasicAuth(padded.replace("Basic", "Basic "))).toThrow(expect.objectContaining({ statusCode: 401 }))
})

test("disabled or empty basic auth still permits requests", () => {
  const request = new Request(BASE_URL, { headers: { Authorization: "Basic" } })
  expect(verifyAuth(request, {})).toBeNull()
  expect(verifyAuth(request, { BASIC_AUTH: {} })).toBeNull()
})

test("basic auth", async () => {
  const usersKv = {
    "user1": "passwd1",
    "user2": "passwd2",
  }

  // access index
  for (const page of staticPages) {
    expect((await workerFetchWithAuth(usersKv, `${BASE_URL}/${page}`, {})).status).toStrictEqual(401)
  }
  expect((await workerFetchWithAuth(usersKv, BASE_URL, {
    headers: { "Authorization": encodeBasicAuth("user1", usersKv["user1"]) },
  })).status).toStrictEqual(200)

  // upload with no auth
  const blob1 = randomBlob(1024)
  const uploadResp = await workerFetchWithAuth(usersKv, BASE_URL, {
    method: "POST",
    body: createFormData({ c: blob1 }),
  })
  expect(uploadResp.status).toStrictEqual(401)

  // upload with true auth
  const uploadResp1 = await workerFetchWithAuth(usersKv, BASE_URL, {
    method: "POST",
    body: createFormData({ c: blob1 }),
    headers: { "Authorization": encodeBasicAuth("user2", usersKv["user2"]) },
  })
  expect(uploadResp1.status).toStrictEqual(200)

  // upload with wrong auth
  const uploadResp2 = await workerFetchWithAuth(usersKv, BASE_URL, {
    method: "POST",
    body: createFormData({ c: blob1 }),
    headers: { "Authorization": encodeBasicAuth("user1", "wrong-password") },
  })
  expect(uploadResp2.status).toStrictEqual(401)

  // revisit without auth
  const uploadJson = JSON.parse(await uploadResp1.text())
  const url = uploadJson["url"]
  const revisitResp = await workerFetchWithAuth(usersKv, url)
  expect(revisitResp.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitResp.blob(), blob1)).toBeTruthy()

  // update with no auth
  const blob2 = randomBlob(1024)
  const admin = uploadJson["admin"]
  const updateResp = await workerFetchWithAuth(usersKv, admin, {
    method: "PUT",
    body: createFormData({ c: blob2 }),
  })
  expect(updateResp.status).toStrictEqual(200)
  const revisitUpdatedResp = await workerFetchWithAuth(usersKv, url)
  expect(revisitUpdatedResp.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitUpdatedResp.blob(), blob2)).toBeTruthy()

  // delete with no auth
  const deleteResp = await workerFetchWithAuth(usersKv, admin, {
    method: "DELETE",
  })
  expect(deleteResp.status).toStrictEqual(200)
  expect((await workerFetchWithAuth(usersKv, url)).status).toStrictEqual(404)
})