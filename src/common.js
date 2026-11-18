export const params = {
  CHAR_GEN : "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678",
  NAME_REGEX : /^[a-zA-Z0-9+_\-\[\]*$@,;]{3,}$/,
  RAND_LEN : 4,
  PRIVATE_RAND_LEN : 24,
  ADMIN_PATH_LEN : 24,
  SEP : ":",
  MAX_LEN : 25 * 1024 * 1024,
}

export function decode(arrayBuffer) {
  return new TextDecoder().decode(arrayBuffer)
}

export class WorkerError extends Error {
  constructor(statusCode, ...params) {
    super(...params)
    this.statusCode = statusCode
  }
}

export function genRandStr(len) {
  if (!Number.isSafeInteger(len) || len < 0) {
    throw new WorkerError(500, "invalid random string length")
  }

  const alphabet = params.CHAR_GEN
  const alphabetLength = alphabet.length
  const maxUnbiased = Math.floor(0x100000000 / alphabetLength) * alphabetLength
  const randomValues = new Uint32Array(Math.max(1, Math.min(len, 256)))
  let str = ""

  while (str.length < len) {
    crypto.getRandomValues(randomValues)
    for (const randomValue of randomValues) {
      if (randomValue >= maxUnbiased) continue
      str += alphabet[randomValue % alphabetLength]
      if (str.length === len) break
    }
  }

  return str
}

export function parsePath(pathname) {
  // Example of paths (SEP=':'). Note: query string is not processed here
  // > example.com/~stocking
  // > example.com/~stocking:uLE4Fhb/d3414adlW653Vx0VSVw=
  // > example.com/abcd
  // > example.com/abcd.jpg
  // > example.com/abcd/myphoto.jpg
  // > example.com/u/abcd
  // > example.com/abcd:3ffd2e7ff214989646e006bd9ad36c58d447065e
  pathname = pathname.slice(1,)  // strip the leading slash

  let role = "", ext = "", filename = undefined
  if (pathname[1] === "/") {
    role = pathname[0]
    pathname = pathname.slice(2)
  }

  // parse filename
  let startOfFilename = pathname.lastIndexOf("/")
  if (startOfFilename >= 0) {
    filename = pathname.slice(startOfFilename + 1)
    pathname = pathname.slice(0, startOfFilename)
  }

  // if having filename, parse ext from filename, else from remaining pathname
  if (filename) {
    let startOfExt = filename.indexOf(".")
    if (startOfExt >= 0) {
      ext = filename.slice(startOfExt)
    }
  } else {
    let startOfExt = pathname.indexOf(".")
    if (startOfExt >= 0) {
      ext = pathname.slice(startOfExt)
      pathname = pathname.slice(0, startOfExt)
    }
  }

  let endOfShort = pathname.indexOf(params.SEP)
  if (endOfShort < 0) endOfShort = pathname.length // when there is no SEP, passwd is left empty
  const short = pathname.slice(0, endOfShort)
  const passwd = pathname.slice(endOfShort + 1)
  return { role, short, passwd, ext, filename }
}

export function parseExpiration(expirationStr) {
  if (expirationStr === undefined || expirationStr === null || expirationStr === "") {
    return NaN
  }
  if (typeof expirationStr !== "string") {
    throw new WorkerError(400, `‘${expirationStr}’ is not a valid expiration specification`)
  }

  const normalized = expirationStr.trim()
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([smhdwMY]?)$/)
  if (!match) {
    throw new WorkerError(400, `‘${expirationStr}’ is not a valid expiration specification`)
  }

  let expirationSeconds = Number(match[1])
  const unit = match[2]
  if (!unit && !Number.isInteger(expirationSeconds)) {
    throw new WorkerError(400, `‘${expirationStr}’ is not a valid expiration specification`)
  }

  if (unit === "m") expirationSeconds *= 60
  else if (unit === "h") expirationSeconds *= 3600
  else if (unit === "d") expirationSeconds *= 3600 * 24
  else if (unit === "w") expirationSeconds *= 3600 * 24 * 7
  else if (unit === "M") expirationSeconds *= 3600 * 24 * 30
  else if (unit === "Y") expirationSeconds *= 3600 * 24 * 365

  if (!Number.isSafeInteger(expirationSeconds) || !Number.isFinite(expirationSeconds)) {
    throw new WorkerError(400, `‘${expirationStr}’ is not a valid expiration specification`)
  }

  return expirationSeconds
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>\"']/g, (tag) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#x27;",
  })[tag])
}

// Ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
export function encodeRFC5987ValueChars(str) {
  return (
    encodeURIComponent(str)
      // The following creates the sequences %27 %28 %29 %2A (Note that
      // the valid encoding of "*" is %2A, which necessitates calling
      // toUpperCase() to properly encode). Although RFC3986 reserves "!",
      // RFC5987 does not, so we do not need to escape it.
      .replace(
        /['()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      )
      // The following are not required for percent-encoding per RFC5987,
      // so we can allow for a little better readability over the wire: |`^
      .replace(/%(7C|60|5E)/g, (str, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      )
  );
}

// Decode the filename from a Content-Disposition fields
export function getDispFilename(fields) {
  if ('filename' in fields) {
    return fields['filename']
  } else if ('filename*' in fields) {
    return decodeURIComponent(fields['filename*'])
  } else {
    return undefined
  }
}

export function isLegalUrl(url) {
  return URL.canParse(url)
}
