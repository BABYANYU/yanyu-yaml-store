import { WorkerError } from "./common.js"
import { Buffer } from 'node:buffer'

// Encoding function
export function encodeBasicAuth(username, password) {
  const credentials = `${username}:${password}`
  const encodedCredentials = Buffer.from(credentials).toString("base64")
  return `Basic ${encodedCredentials}`
}

const MAX_BASIC_AUTH_HEADER_LENGTH = 8 * 1024

// Decoding function
export function decodeBasicAuth(encodedString) {
  if (typeof encodedString !== "string" || encodedString.length > MAX_BASIC_AUTH_HEADER_LENGTH) {
    throw new WorkerError(401, "Invalid basic auth header")
  }

  const match = encodedString.match(/^Basic[\t ]+([^\t ]+)$/i)
  if (!match) {
    throw new WorkerError(401, "Invalid basic auth header")
  }

  const encodedCredentials = match[1]
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedCredentials)) {
    throw new WorkerError(401, "Invalid basic auth credentials")
  }

  let credentials
  try {
    credentials = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(encodedCredentials, "base64"))
  } catch {
    throw new WorkerError(401, "Invalid basic auth credentials")
  }
  const separator = credentials.indexOf(":")
  if (separator < 0 || /[\x00-\x1f\x7f]/.test(credentials)) {
    throw new WorkerError(401, "Invalid basic auth credentials")
  }

  return {
    username: credentials.slice(0, separator),
    password: credentials.slice(separator + 1),
  }
}

function unauthorizedResponse() {
  return new Response("HTTP basic auth is required", {
    status: 401,
    headers: {
      "WWW-Authenticate": "Basic charset=\"UTF-8\"",
    },
  })
}

// Return null if auth passes or is not required; otherwise return a uniform challenge.
export function verifyAuth(request, env) {
  // pass auth if 'BASIC_AUTH' is not present
  if (!env.BASIC_AUTH) return null

  const passwdMap = new Map(Object.entries(env.BASIC_AUTH))

  // pass auth if 'BASIC_AUTH' is empty
  if (passwdMap.size === 0) return null

  let credentials
  try {
    credentials = decodeBasicAuth(request.headers.get("Authorization"))
  } catch (error) {
    if (error instanceof WorkerError && error.statusCode === 401) {
      return unauthorizedResponse()
    }
    throw error
  }

  const { username, password } = credentials
  if (!passwdMap.has(username) || passwdMap.get(username) !== password) {
    return unauthorizedResponse()
  }
  return null
}
