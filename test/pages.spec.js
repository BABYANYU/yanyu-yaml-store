import { expect, test } from "vitest"
import { BASE_URL, staticPages, upload, workerFetch } from "./testUtils.js"
import { makeHighlight } from "../src/pages/highlight.js"
import { makeMarkdown, sanitizeMarkdownUrls } from "../src/pages/markdown.js"
import { getStaticPage } from "../src/pages/staticPages.js"

test('highlight rejects attribute injection in language', () => {
  const html = makeHighlight('<img src=x>', "x' onmouseover='alert(1)")
  expect(html).toContain("class='language-text'")
  expect(html).not.toContain('onmouseover=')
  expect(html).toContain('&lt;img src=x&gt;')
})

test('markdown metadata keeps quotes inside the description attribute', () => {
  const html = makeMarkdown("# Title\n\nhello' onmouseover='alert(1)")
  expect(html).not.toContain("content='hello' onmouseover=")
})

test('static template encodes values without recursive replacement', () => {
  const html = getStaticPage('/', {
    BASE_URL: "https://example.test/'</script><script>alert(1)</script>",
    FAVICON: "x' onerror='alert(1)",
    REPO: '$&{{INDEX_JS}}',
  })
  expect(html).not.toContain("href='x' onerror=")
  expect(html).not.toContain('</script><script>alert(1)</script>')
  expect(html).toContain('\\u003c/script>')
})

test('markdown rejects executable protocols after parsing', () => {
  for (const url of ['javascript:alert%281%29', 'JaVaScRiPt:alert%281%29', 'data:text/html,test', 'vbscript:test', 'javascript&colon;alert%281%29']) {
    const html = makeMarkdown(`[click](${url})\n\n![picture](${url})`)
    expect(html).toContain('<a>click</a>')
    expect(html).toContain('<img alt="picture">')
  }
})

test('markdown URL transform rejects control character obfuscation', () => {
  for (const url of ['java\tscript:alert(1)', 'java\nscript:alert(1)', '\rjavascript:alert(1)', '\u0000javascript:alert(1)', 'data:text/html,test']) {
    const tree = { type: 'root', children: [
      { type: 'element', tagName: 'a', properties: { href: url }, children: [] },
      { type: 'element', tagName: 'img', properties: { src: url }, children: [] },
    ] }
    sanitizeMarkdownUrls()(tree)
    expect(tree.children[0].properties).not.toHaveProperty('href')
    expect(tree.children[1].properties).not.toHaveProperty('src')
  }
})

test('markdown retains safe links, tables and code', () => {
  for (const url of ['https://example.test/x', 'http://example.test/x', '/relative', '../relative', '#anchor', 'mailto:test@example.test']) {
    expect(makeMarkdown(`[click](${url})`)).toContain(`href="${url}"`)
  }
  expect(makeMarkdown('![picture](mailto:test@example.test)')).toContain('<img alt="picture">')
  expect(makeMarkdown('![picture](/image.png)')).toContain('src="/image.png"')
  const html = makeMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst value = "javascript:test";\n```')
  expect(html).toContain('<table>')
  expect(html).toContain('<td>1</td>')
  expect(html).toContain('<code class="language-js">')
  expect(html).toContain('javascript:test')
})

test("static pages", async () => {
  for (const page of staticPages) {
    expect((await workerFetch(`${BASE_URL}/${page}`)).status).toStrictEqual(200)
  }
})

test("markdown", async () => {
  const testMd = `# Hello`  // TODO: use a stronger test file
  const url = (await upload({ "c": testMd }))["url"]

  function makeMarkdownUrl(url) {
    const splitPoint = url.lastIndexOf("/")
    return url.slice(0, splitPoint) + "/a" + url.slice(splitPoint)
  }

  const revisitResponse = await workerFetch(makeMarkdownUrl(url))
  expect(revisitResponse.status).toStrictEqual(200)
  expect(revisitResponse.headers.get("Content-Type")).toStrictEqual("text/html;charset=UTF-8")
  const responseHtml = await revisitResponse.text()
  expect(responseHtml.indexOf("<title>Hello</title>")).toBeGreaterThan(-1)
  expect(responseHtml.indexOf("<h1>Hello</h1>")).toBeGreaterThan(-1)
})

test("url redirect", async () => {
  const contentUrl = "https://example.com:1234/abc-def?g=hi&jk=l"
  const uploadResp = await upload({ "c": contentUrl })
  const url = uploadResp["url"]

  function makeRedirectUrl(url) {
    const splitPoint = url.lastIndexOf("/")
    return url.slice(0, splitPoint) + "/u" + url.slice(splitPoint)
  }

  expect(uploadResp["suggestUrl"].includes(makeRedirectUrl(url))).toBe(true)

  const resp = await workerFetch(makeRedirectUrl(url))
  expect(resp.status).toStrictEqual(302)
  expect(resp.headers.get("location")).toStrictEqual(contentUrl)
})

test("url redirect with illegal url", async () => {
  const contentUrl = "xxxx"
  const uploadResp = await upload({ "c": contentUrl })
  const url = uploadResp["url"]

  function makeRedirectUrl(url) {
    const splitPoint = url.lastIndexOf("/")
    return url.slice(0, splitPoint) + "/u" + url.slice(splitPoint)
  }

  expect(uploadResp["suggestUrl"]).toBeNull()

  const resp = await workerFetch(makeRedirectUrl(url))
  expect(resp.status).toStrictEqual(400)
})

test("highlight", async () => {
  const content = "print(\"hello world\")"
  const url = (await upload(({ "c": content })))["url"]
  const resp = await workerFetch(`${url}?lang=html`)
  expect(resp.status).toStrictEqual(200)
  const body = await resp.text()
  expect(body.includes("language-html")).toBeTruthy()
  expect(body).toContain("<code class='language-html'>print(&quot;hello world&quot;)</code>")
  expect(body).not.toContain(content)
})

