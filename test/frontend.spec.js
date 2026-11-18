import { expect, test } from "vitest"
import { getStaticPage } from "../src/pages/staticPages.js"
import { BASE_URL, createFormData, upload, workerFetch } from "./testUtils.js"

// Check DOM contracts and API semantics without freezing incidental copy or styling.
function elements(html) {
  const nodes = [], stack = []
  const voidTags = new Set("area base br col embed hr img input link meta param source track wbr".split(" "))
  for (const [, closing, rawTag, source] of html.matchAll(/<(\/)?([a-z][\w-]*)\b([^<>]*)>/gi)) {
    const tag = rawTag.toLowerCase()
    if (closing) {
      const index = stack.findLastIndex(node => node.tag === tag)
      if (index >= 0) stack.length = index
      continue
    }
    const attrs = Object.fromEntries([...source.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
      .map(([, name, double, single, bare]) => [name, double ?? single ?? bare ?? ""]))
    const node = { tag, attrs, ancestors: [...stack] }
    nodes.push(node)
    if (!voidTags.has(tag) && !source.endsWith("/")) stack.push(node)
  }
  return nodes
}

const names = {
  "paste-textarea": "c",
  "paste-expiration-input": "paste-expiration",
  "paste-passwd-input": "paste-password",
  "paste-custom-url-input": "custom-url",
  "paste-admin-url-input": "admin-url",
}
const hooks = [
  ...Object.keys(names), "paste-input-panel", "paste-tab-edit", "paste-tab-file",
  "paste-file-upload", "paste-edit", "paste-file-show", "paste-file-line",
  "paste-url-short-radio", "paste-url-long-radio", "paste-url-custom-radio", "paste-url-admin-radio",
  "paste-uploaded-panel", "uploaded-url", "uploaded-admin-url", "uploaded-suggest-url",
  "uploaded-expiration", "submit-button", "delete-button", "submit-error-msg",
]

for (const path of ["/", "/index", "/index.html"]) {
  test(`frontend hooks and template substitution on ${path}`, async () => {
    const response = await workerFetch(BASE_URL + path)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    const html = await response.text()
    // Ignore script/style source when checking DOM IDs.
    const dom = elements(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ""))
    const byId = id => dom.filter(node => node.attrs.id === id)
    for (const id of hooks) expect(byId(id), id).toHaveLength(1)
    for (const [id, name] of Object.entries(names)) expect(byId(id)[0].attrs.name).toBe(name)
    for (const value of ["short", "long", "custom", "admin"]) {
      expect(byId(`paste-url-${value}-radio`)[0].attrs).toMatchObject({ type: "radio", name: "url-type", value })
    }
    expect(byId("paste-url-short-radio")[0].attrs).toHaveProperty("checked")
    expect(byId("paste-file-upload")[0].attrs.type).toBe("file")
    expect(byId("paste-passwd-input")[0].attrs.type).toBe("password")
    expect(byId("paste-admin-url-input")[0].attrs.value).toBe(BASE_URL)
    for (const id of ["uploaded-url", "uploaded-admin-url", "uploaded-suggest-url", "uploaded-expiration"]) {
      expect(byId(id)[0].attrs).toHaveProperty("readonly")
    }
    expect(html).not.toMatch(/\{\{(?:CSS|INDEX_JS|BASE_URL_JSON|BASE_URL|REPO|FAVICON)\}\}/)
    for (const id of ["advanced-settings", "management-links"]) {
      expect(byId(id), id).toHaveLength(1)
      const details = byId(id)[0]
      expect(details.tag).toBe("details")
      expect(details.attrs).not.toHaveProperty("open")
      expect(dom.some(node => node.tag === "summary" && node.ancestors.at(-1) === details)).toBe(true)
    }
    const visibleOutsideDetails = id => {
      const node = byId(id)[0]
      for (const ancestor of [...node.ancestors, node]) {
        expect(ancestor.tag, id).not.toBe("details")
        expect(ancestor.attrs, id).not.toHaveProperty("hidden")
        expect((ancestor.attrs.class || "").split(/\s+/), id).not.toContain("hidden")
      }
    }
    visibleOutsideDetails("submit-button")
    visibleOutsideDetails("paste-textarea")
    expect(byId("submit-button")[0].tag).toBe("button")
    expect(byId("submit-button")[0].attrs.type).toBe("button")
    for (const id of ["paste-expiration-input", "paste-passwd-input", "paste-admin-url-input"]) {
      expect(byId(id)[0].ancestors.map(node => node.attrs.id)).toContain("advanced-settings")
    }
    expect(byId("uploaded-admin-url")[0].ancestors.map(node => node.attrs.id)).toContain("management-links")
    expect(byId("uploaded-url")[0].ancestors.some(node => node.tag === "details")).toBe(false)
    for (const [row, field] of [["result-suggest", "uploaded-suggest-url"], ["result-expiration", "uploaded-expiration"]]) {
      expect(byId(row), row).toHaveLength(1)
      expect(byId(field)[0].ancestors).toContain(byId(row)[0])
      expect([...byId(row)[0].ancestors, byId(row)[0]].some(({ attrs }) =>
        Object.hasOwn(attrs, "hidden") || (attrs.class || "").split(/\s+/).includes("hidden"))).toBe(true)
    }
    expect(dom.filter(node => node.tag === "h1")).toHaveLength(1)
    expect(html).toContain("<h1 class='workspace-title'>订阅配置托管</h1>")
    expect(byId("paste-textarea")[0].attrs).not.toHaveProperty("placeholder")
    expect(byId("help")).toHaveLength(0)
    expect(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).toContain("YANYU LINK")
    expect(html).toContain("DOMContentLoaded")
    expect(html).toMatch(/<style\b[^>]*>\s*\S/i)
  })
}

test("frontend template does not turn environment data into markup or recursive substitutions", () => {
  const injected = "https://example.test/'\"><script id=template-injection>alert(1)</script>"
  const html = getStaticPage("/", { BASE_URL: injected, FAVICON: injected, REPO: "$&{{CSS}}" })
  expect(html).not.toContain("<script id=template-injection>")
  expect(html).toContain("\\u003cscript id=template-injection>")
  expect(html).toContain("&lt;script id=template-injection&gt;")
})

test("browser multipart fields support create, edit, password rotation and delete", async () => {
  const original = await upload({ c: "first: true", e: "10m", s: "original-secret" })
  expect(original.url).not.toContain("original-secret")
  expect(original.admin).toBe(`${original.url}:original-secret`)
  const editor = await workerFetch(original.admin)
  expect(editor.status).toBe(200)
  expect(await editor.text()).toContain("paste-admin-url-input")
  const update = await workerFetch(original.admin, {
    method: "PUT", body: createFormData({ c: "second: true", s: "rotated-secret" }),
  })
  expect(update.status).toBe(200)
  const updated = await update.json()
  expect(updated.url).toBe(original.url)
  expect(updated.admin).toBe(`${original.url}:rotated-secret`)
  expect(updated.expire).toBeGreaterThan(0)
  expect(updated.expire).toBeLessThanOrEqual(original.expire)
  expect(await (await workerFetch(updated.url)).text()).toBe("second: true")
  expect((await workerFetch(original.admin, { method: "DELETE" })).status).toBe(403)
  expect((await workerFetch(updated.admin, { method: "DELETE" })).status).toBe(200)
  expect((await workerFetch(updated.url)).status).toBe(404)
})

test("file result keeps public download and management URLs separate", async () => {
  const filename = "配置 & report.yaml"
  const result = await upload({ c: { filename, value: "mixed-port: 7890" }, s: "file-secret" })
  expect(result.admin).toBe(`${result.url}:file-secret`)
  expect(result.suggestUrl).toBe(`${result.url}/${encodeURIComponent(filename)}`)
  expect(result.suggestUrl).not.toContain("file-secret")
  const download = await workerFetch(result.suggestUrl)
  expect(download.status).toBe(200)
  expect(await download.text()).toBe("mixed-port: 7890")
})
