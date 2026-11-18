import { decode, encodeRFC5987ValueChars, isLegalUrl, parsePath, WorkerError } from "../common.js"
import { getStaticPage } from "../pages/staticPages.js"
import { verifyAuth } from "../auth.js"
import { getType } from "mime/lite.js"
import { makeMarkdown } from "../pages/markdown.js"
import { makeHighlight } from "../pages/highlight.js"
import favicon from "../../frontend/favicon.svg"

function staticPageCacheHeader(env) {
  const age = env.CACHE_STATIC_PAGE_AGE
  return age ? { "cache-control": `public, max-age=${age}` } : {}
}

function pasteCacheHeader() {
  // Mutable and expiring KV entries must not leave reusable HTTP cache copies.
  // This does not change KV's eventual consistency behavior.
  return { "cache-control": "no-store" }
}

function lastModifiedHeader(paste) {
  const lastModified = paste.metadata?.lastModified
  return lastModified ? { "last-modified": new Date(lastModified).toGMTString() } : {}
}

export async function handleGet(request, env, ctx) {
  const url = new URL(request.url)

  if (url.pathname === "/favicon.ico") {
    return Response.redirect(env.FAVICON || new URL("/favicon.svg?v=1", url).href)
  }
  if (url.pathname === "/favicon.svg") {
    return new Response(favicon, {
      headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
    })
  }

  const { role, short, ext, passwd, filename } = parsePath(url.pathname)
  // return the editor for admin URL
  const staticPageContent = getStaticPage((passwd.length > 0) ? "/" : url.pathname, env)
  if (staticPageContent) {
    // access to all static pages requires auth
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }
    return new Response(staticPageContent, {
      headers: {
        "content-type": "text/html;charset=UTF-8",
        ...(passwd.length > 0 || (env.BASIC_AUTH && Object.keys(env.BASIC_AUTH).length > 0)
          ? { "cache-control": "private, no-store" }
          : staticPageCacheHeader(env)),
        "referrer-policy": "no-referrer",
      },
    })
  }

  // Path filenames are URL-encoded; metadata filenames are already literal text.
  let pathFilename = filename
  if (filename) {
    try {
      pathFilename = decodeURIComponent(filename)
    } catch {
      throw new WorkerError(400, "invalid filename encoding")
    }
  }

  const mime = url.searchParams.get("mime") || getType(ext) || "text/plain"

  const disp = url.searchParams.has("a") ? "attachment" : "inline"

  const item = await env.PB.getWithMetadata(short, { type: "arrayBuffer" })

  // when paste is not found
  if (item.value === null) {
    throw new WorkerError(404, `paste of name '${short}' not found`)
  }

  // check `if-modified-since`
  const pasteLastModified = item.metadata?.lastModified
  const headerModifiedSince = request.headers.get("if-modified-since")
  if (pasteLastModified && headerModifiedSince) {
    let pasteLastModifiedMs = Date.parse(pasteLastModified)
    pasteLastModifiedMs -= pasteLastModifiedMs % 1000 // deduct the milliseconds parts
    const headerIfModifiedMs = Date.parse(headerModifiedSince)
    if (pasteLastModifiedMs <= headerIfModifiedMs) {
      return new Response(null, {
        status: 304, // Not Modified
        headers: {
          ...lastModifiedHeader(item),
          ...pasteCacheHeader(),
          ...(role !== "a" && role !== "u" && !url.searchParams.get("lang")
            ? { "content-security-policy": "sandbox", "referrer-policy": "no-referrer" }
            : {}),
        },
      })
    }
  }

  // determine filename with priority: url path > meta
  const returnFilename = pathFilename || item.metadata?.filename

  // handle URL redirection
  if (role === "u") {
    const redirectURL = decode(item.value)
    if (isLegalUrl(redirectURL)) {
      return new Response(null, {
        status: 302,
        headers: { location: redirectURL, ...pasteCacheHeader() },
      })
    } else {
      throw new WorkerError(400, "cannot parse paste content as a legal URL")
    }
  }

  // handle article (render as markdown)
  if (role === "a") {
    const md = makeMarkdown(decode(item.value))
    return new Response(md, {
      headers: { "content-type": `text/html;charset=UTF-8`, ...pasteCacheHeader(), ...lastModifiedHeader(item) },
    })
  }

  // handle language highlight
  const lang = url.searchParams.get("lang")
  if (lang) {
    return new Response(makeHighlight(decode(item.value), lang), {
      headers: { "content-type": `text/html;charset=UTF-8`, ...pasteCacheHeader(), ...lastModifiedHeader(item) },
    })
  } else {

    // handle default
    const headers = {
      "content-type": `${mime};charset=UTF-8`,
      "content-security-policy": "sandbox",
      "referrer-policy": "no-referrer",
      ...pasteCacheHeader(),
      ...lastModifiedHeader(item),
    }
    if (returnFilename) {
      const encodedFilename = encodeRFC5987ValueChars(returnFilename)
      headers["content-disposition"] = `${disp}; filename*=UTF-8''${encodedFilename}`
    } else {
      headers["content-disposition"] = `${disp}`
    }
    return new Response(item.value, { headers })
  }
}
