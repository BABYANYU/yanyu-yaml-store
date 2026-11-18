import { verifyAuth } from "../auth.js"
import { getBoundary, parseFormdata } from "../parseFormdata.js"
import {
  decode,
  genRandStr,
  getDispFilename,
  isLegalUrl,
  params,
  parseExpiration,
  parsePath,
  WorkerError,
} from "../common.js"

const MAX_REQUEST_BYTES = params.MAX_LEN + 1024 * 1024
const MAX_FIELD_BYTES = 4096
const MAX_PASSWORD_BYTES = 128
// Excludes '.', ':', '/', '?' and '#' which change the existing admin URL grammar.
const URL_SAFE_PASSWORD = /^[A-Za-z0-9_~!$&'()*+,;=@-]+$/

function ensureFieldSize(value, fieldName, maxBytes = MAX_FIELD_BYTES) {
  if (value === undefined) return
  const size = new TextEncoder().encode(value).byteLength
  if (size > maxBytes) {
    throw new WorkerError(413, `${fieldName} is too large`)
  }
}

function validateNewPassword(password) {
  if (password === undefined) return
  ensureFieldSize(password, "password", MAX_PASSWORD_BYTES)
  if (password.length === 0 || !URL_SAFE_PASSWORD.test(password)) {
    throw new WorkerError(400, "password must contain only URL-safe characters")
  }
}

async function readLimitedBody(request) {
  const declared = request.headers.get("content-length")
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_REQUEST_BYTES) {
    throw new WorkerError(413, "request payload too large")
  }
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => {})
        throw new WorkerError(413, "request payload too large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function getExistingExpiration(env, short) {
  // KV getWithMetadata does not expose the actual expiry; list does, including legacy keys.
  let cursor
  for (let attempt = 0; attempt < 3; attempt++) {
    const page = await env.PB.list({ prefix: short, limit: 100, ...(cursor ? { cursor } : {}) })
    const key = page.keys.find((entry) => entry.name === short)
    if (key) return key.expiration
    if (page.list_complete) {
      throw new WorkerError(503, "cannot determine existing paste expiration")
    }
    if (!page.cursor || page.cursor === cursor) {
      throw new WorkerError(503, "cannot determine existing paste expiration")
    }
    cursor = page.cursor
  }
  throw new WorkerError(503, "cannot determine existing paste expiration")
}

async function createPaste(env, content, isPrivate, expire, short, createDate, passwd, filename, previousExpiresAt) {
  const now = new Date().toISOString()
  createDate = createDate || now
  passwd = passwd || genRandStr(params.ADMIN_PATH_LEN)
  const short_len = isPrivate ? params.PRIVATE_RAND_LEN : params.RAND_LEN
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAt = !isNaN(expire) ? nowSeconds + expire : previousExpiresAt
  if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt < nowSeconds + 60)) {
    throw new WorkerError(400, "paste expiration must be at least 60 seconds in the future")
  }

  if (short === undefined) {
    while (true) {
      short = genRandStr(short_len)
      if ((await env.PB.get(short)) === null) break
    }
  }

  const metadata = {
    postedAt: createDate,
    passwd,
    filename,
    lastModified: now,
  }
  metadata.expiration = expiresAt ?? null // null explicitly marks newly written permanent keys.
  if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > 1024) {
    throw new WorkerError(413, "paste metadata is too large")
  }

  const options = { metadata }
  const expirationTtl = expiresAt === undefined ? NaN : expiresAt - nowSeconds
  if (expiresAt !== undefined) options.expiration = expiresAt

  await env.PB.put(short, content, options)

  const accessUrl = env.BASE_URL + "/" + short
  const adminUrl = env.BASE_URL + "/" + short + params.SEP + passwd
  return {
    url: accessUrl,
    suggestUrl: suggestUrl(content, filename, short, env.BASE_URL),
    admin: adminUrl,
    isPrivate,
    expire: isNaN(expirationTtl) ? null : expirationTtl,
  }
}

function suggestUrl(content, filename, short, baseUrl) {
  if (filename) {
    return `${baseUrl}/${short}/${encodeURIComponent(filename)}`
  } else if (isLegalUrl(decode(content))) {
    return `${baseUrl}/u/${short}`
  } else {
    return null
  }
}

export async function handlePostOrPut(request, env, ctx, isPut) {
  const url = new URL(request.url)
  let existingItem
  let existingPath

  if (isPut) {
    // Authenticate before reading the request body, so an invalid PUT cannot consume upload data.
    existingPath = parsePath(url.pathname)
    existingItem = await env.PB.getWithMetadata(existingPath.short)
    if (existingItem.value === null) {
      throw new WorkerError(404, `paste of name '${existingPath.short}' is not found`)
    }
    if (existingPath.passwd !== existingItem.metadata?.passwd) {
      throw new WorkerError(403, `incorrect password for paste '${existingPath.short}`)
    }
  } else {
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) return authResponse
  }

  const contentType = request.headers.get("content-type") || ""
  if (!contentType.includes("multipart/form-data")) {
    throw new WorkerError(400, `bad usage, please use 'multipart/form-data' instead of ${contentType}`)
  }

  let boundary
  try {
    boundary = getBoundary(contentType)
  } catch {
    throw new WorkerError(400, "invalid multipart boundary")
  }
  if (!boundary || boundary.length > 200) {
    throw new WorkerError(400, "invalid multipart boundary")
  }

  const body = await readLimitedBody(request)

  let form
  try {
    form = parseFormdata(body, boundary)
  } catch (e) {
    throw new WorkerError(400, "error occurs when parsing formdata")
  }

  for (const [fieldName, part] of form) {
    if (fieldName !== "c" && part.content.byteLength > MAX_FIELD_BYTES) {
      throw new WorkerError(413, "form field is too large")
    }
  }
  const contentPart = form.get("c")
  const content = contentPart && contentPart.content
  let filename
  try {
    filename = contentPart && getDispFilename(contentPart.fields)
  } catch {
    throw new WorkerError(400, "invalid filename encoding")
  }
  const name = form.get("n") && decode(form.get("n").content)
  const isPrivate = form.get("p") !== undefined
  const newPasswd = (form.get("s") && decode(form.get("s").content)) || undefined
  const expire = form.has("e") && form.get("e").content.byteLength > 0
    ? decode(form.get("e").content)
    : undefined

  if (content === undefined) {
    throw new WorkerError(400, "cannot find content in formdata")
  }
  if (content.byteLength > params.MAX_LEN) {
    throw new WorkerError(413, "payload too large")
  }

  ensureFieldSize(name, "name", 511) // KV keys allow 512 bytes including the '~' prefix.
  ensureFieldSize(expire, "expiration", 64)
  ensureFieldSize(filename, "filename", 512)
  validateNewPassword(newPasswd)

  let expirationSeconds = NaN
  if (expire !== undefined) {
    expirationSeconds = parseExpiration(expire)
    if (!isNaN(expirationSeconds) && expirationSeconds < 60) {
      throw new WorkerError(
        400,
        `due to limitation of Cloudflare, expire should be a integer greater than 60, '${expirationSeconds}' given`,
      )
    }
  }

  if (name !== undefined && !params.NAME_REGEX.test(name)) {
    throw new WorkerError(400, `Name ${name} not satisfying regexp ${params.NAME_REGEX}`)
  }

  function makeResponse(created) {
    return new Response(JSON.stringify(created, null, 2), {
      headers: { "content-type": "application/json;charset=UTF-8" },
    })
  }

  if (isPut) {
    const { short } = existingPath
    const date = existingItem.metadata?.postedAt
    const previousExpiresAt = expire === undefined
      ? (Object.prototype.hasOwnProperty.call(existingItem.metadata || {}, "expiration")
        ? existingItem.metadata.expiration ?? undefined
        : await getExistingExpiration(env, short))
      : undefined
    return makeResponse(await createPaste(
      env,
      content,
      isPrivate,
      expirationSeconds,
      short,
      date,
      newPasswd === undefined ? existingItem.metadata?.passwd : newPasswd,
      filename,
      previousExpiresAt,
    ))
  }

  let short
  if (name !== undefined) {
    short = "~" + name
    if ((await env.PB.get(short)) !== null) {
      throw new WorkerError(409, `name '${name}' is already used`)
    }
  }
  return makeResponse(await createPaste(
    env, content, isPrivate, expirationSeconds, short, undefined, newPasswd, filename,
  ))
}
