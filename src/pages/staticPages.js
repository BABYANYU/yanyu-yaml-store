import { makeMarkdown } from "./markdown.js"

import indexHtml from "../../frontend/index.html"
import styleCss from "../../frontend/style.css"
import typographyCss from "../../frontend/typography.css"
import indexJs from "../../frontend/index.client.js"
import tosMd from "../../frontend/tos.md"
import apiMd from "../../doc/api.md"

function escapeAttribute(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

function indexPage(env) {
  // JSON encoding protects JS strings; escaping '<' prevents closing the script element.
  const baseUrlJson = JSON.stringify(String(env.BASE_URL ?? '')).replace(/</g, '\\u003c')
  const script = indexJs.replace('{{BASE_URL_JSON}}', () => baseUrlJson)
  const values = {
    CSS: typographyCss + "\n" + styleCss,
    INDEX_JS: script,
    BASE_URL: escapeAttribute(env.BASE_URL),
    REPO: escapeAttribute(env.REPO),
    FAVICON: escapeAttribute(env.FAVICON || "/favicon.svg?v=1"),
  }
  // One pass avoids interpreting placeholders or replacement tokens inside values.
  return indexHtml.replace(/\{\{(CSS|INDEX_JS|BASE_URL|REPO|FAVICON)\}\}/g,
    (_, name) => values[name])
}

export function getStaticPage(path, env) {
  if (path === "/" || path === "/index" || path === "/index.html") {
    return indexPage(env)
  } else if (path === "/tos" || path === "/tos.html") {
    const tosMdRenderred = tosMd
      .replaceAll("{{TOS_MAINTAINER}}", env.TOS_MAINTAINER)
      .replaceAll("{{TOS_MAIL}}", env.TOS_MAIL)
      .replaceAll("{{BASE_URL}}", env.BASE_URL)

    return makeMarkdown(tosMdRenderred)
  } else if (path === "/api" || path === "/api.html") {
    return makeMarkdown(apiMd)
  } else {
    return null
  }
}
