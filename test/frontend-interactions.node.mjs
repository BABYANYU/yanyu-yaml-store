// Supplemental browser-logic checks: node --test test/frontend-interactions.node.mjs
// A small jQuery/DOM adapter runs the real script. It does not validate browser layout,
// native event bubbling, clipboard permissions, or accessibility-tree behavior.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const template = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8')
const base = 'https://paste.example'
const script = readFileSync(new URL('../frontend/index.client.js', import.meta.url), 'utf8')
  .replace('{{BASE_URL_JSON}}', JSON.stringify(base))

function setup(path = '/') {
  const nodes = new Map(), requests = [], alerts = []
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, {
      value: '', textContent: '', disabled: false, hidden: false, open: false, classes: new Set(), handlers: {}, attrs: {},
      tagName: 'DIV', setAttribute(k, v) { this.attrs[k] = v },
      addEventListener(event, callback) { (this.handlers[event] ||= []).push(callback) },
      scrollIntoView() {},
      getAttribute(k) { return this.attrs[k] },
      closest() { return { querySelector() { return node('#uploaded-url') } } },
      focus() {}, select() {}, click() { fire(key, 'click') },
    })
    return nodes.get(key)
  }
  // Seed new layout hooks from markup so missing hooks or wrong defaults cannot
  // pass merely because the jQuery adapter synthesizes an empty node.
  for (const id of ['advanced-settings', 'management-links', 'result-suggest', 'result-expiration']) {
    const match = [...template.matchAll(/<([a-z][\w-]*)\b([^<>]*)>/gi)]
      .find(([, , attrs]) => new RegExp(`\\bid=['"]${id}['"]`).test(attrs))
    assert.ok(match, `template hook #${id} must exist`)
    const item = node('#' + id)
    item.tagName = match[1].toUpperCase()
    item.open = /\bopen(?:\s|=|$)/.test(match[2])
    item.hidden = /\bhidden(?:\s|=|$)/.test(match[2])
    const classes = match[2].match(/\bclass=['"]([^'"]*)['"]/)?.[1] || ''
    item.classes = new Set(classes.split(/\s+/).filter(Boolean))
  }
  const radios = ['short', 'long', 'custom', 'admin'].map(value => {
    const item = node(`#paste-url-${value}-radio`)
    item.value = value
    return item
  })
  radios[0].checked = true
  node('#paste-expiration-input').value = '2147483647'
  node('#paste-admin-url-input').value = base
  node('#paste-tab-file').tagName = 'LABEL'
  node('#paste-uploaded-panel').classes.add('hidden')
  const resultIds = ['uploaded-url', 'uploaded-admin-url', 'uploaded-suggest-url', 'uploaded-expiration']
  class Selection {
    constructor(items) { this.items = items; items.forEach((item, i) => { this[i] = item }); this.length = items.length }
    val(value) { return value === undefined ? this[0]?.value : this.prop('value', value) }
    prop(key, value) { if (value === undefined) return this[0]?.[key]; this.items.forEach(item => { item[key] = value }); return this }
    attr(key, value) { const attrs = typeof key === 'object' ? key : { [key]: value }; this.items.forEach(item => Object.assign(item.attrs, attrs)); return this }
    text(value) { if (value === undefined) return this[0]?.textContent; this.items.forEach(item => { item.textContent = String(value) }); return this }
    add(other) { return new Selection([...this.items, ...other.items]) }
    each(callback) { this.items.forEach((item, i) => callback(i, item)); return this }
    filter(selector) { return new Selection(this.items.filter(item => item.tagName.toLowerCase() === selector)) }
    on(events, callback) { for (const event of events.split(' ')) this.items.forEach(item => { (item.handlers[event] ||= []).push(callback) }); return this }
    addClass(value) { this.items.forEach(item => item.classes.add(value)); return this }
    removeClass(value) { this.items.forEach(item => item.classes.delete(value)); return this }
    toggleClass(value, enabled) { return enabled ? this.addClass(value) : this.removeClass(value) }
    hasClass(value) { return this[0]?.classes.has(value) }
    children(selector) { return $(selector) }
    click() { this.items.forEach(item => item.click()); return this }
  }
  function $(selector) {
    if (typeof selector !== 'string') return new Selection([selector])
    if (selector === 'input[name="url-type"]') return new Selection(radios)
    if (selector === 'input[name="url-type"]:checked') return new Selection(radios.filter(item => item.checked))
    if (selector === '#paste-uploaded-panel input') return new Selection(resultIds.map(id => node('#' + id)))
    return new Selection([node(selector)])
  }
  $.ajax = options => requests.push(options)
  $.post = options => requests.push({ ...options, method: 'POST' })
  function fire(selector, event, extra = {}) {
    const item = node(selector)
    if (event === 'click' && item.disabled) return
    for (const callback of item.handlers[event] || []) callback({ target: item, currentTarget: item, preventDefault() {}, ...extra })
  }
  function input(selector, value) { node(selector).value = value; fire(selector, 'input') }
  function mode(value) { radios.forEach(item => { item.checked = item.value === value }); fire(`#paste-url-${value}-radio`, 'input') }
  runInNewContext(script, {
    window: { addEventListener(event, callback) { if (event === 'DOMContentLoaded') callback() } },
    location: new URL(path, base), URL, TypeError, FormData, Date, setTimeout, clearTimeout,
    document: { execCommand() { return true }, getElementById(id) { return nodes.get('#' + id) || null } }, navigator: {},
    alert: message => alerts.push(message), $, console,
  })
  return { node, input, mode, fire, requests, alerts }
}

function submit(ui, content = 'port: 7890') {
  ui.input('#paste-textarea', content)
  ui.fire('#submit-button', 'click')
  return ui.requests.at(-1)
}
function complete(request, result) { request.success(result); request.complete() }
function hidden(ui, id) { const item = ui.node(id); return item.hidden || item.classes.has('hidden') }

test('compact create flow keeps advanced and management details closed while generating links', () => {
  const ui = setup()
  assert.equal(ui.node('#advanced-settings').open, false)
  assert.equal(ui.node('#management-links').open, false)
  assert.equal(hidden(ui, '#paste-uploaded-panel'), true)
  assert.equal(ui.node('#submit-button').textContent, '生成链接')
  const request = submit(ui)
  assert.equal(request.method, 'POST')
  complete(request, { url: base + '/created', admin: base + '/created:secret' })
  assert.equal(hidden(ui, '#result-suggest'), true)
  assert.equal(hidden(ui, '#result-expiration'), true)
  assert.equal(ui.node('#uploaded-url').value, base + '/created')
  assert.equal(hidden(ui, '#paste-uploaded-panel'), false)
  assert.equal(ui.node('#advanced-settings').open, false)
  assert.equal(ui.node('#management-links').open, false)
  assert.equal(ui.node('#submit-button').textContent, '生成链接')
})

test('optional result rows follow each response independently and reappear when populated', () => {
  const ui = setup()
  for (const [extra, suggestHidden, expirationHidden] of [
    [{ suggestUrl: base + '/one/file', expire: 60 }, false, false],
    [{ suggestUrl: null, expire: null }, true, true],
    [{}, true, true],
    [{ suggestUrl: '', expire: '' }, true, true],
    [{ expire: 0 }, true, false],
    [{ suggestUrl: base + '/one/file' }, false, true],
    [{ expire: 120 }, true, false],
  ]) {
    complete(submit(ui), { url: base + '/one', admin: base + '/one:secret', ...extra })
    assert.equal(hidden(ui, '#result-suggest'), suggestHidden)
    assert.equal(hidden(ui, '#result-expiration'), expirationHidden)
    assert.equal(ui.node('#uploaded-suggest-url').value, extra.suggestUrl || '')
    assert.equal(ui.node('#uploaded-expiration').value, extra.expire ?? '')
  }
})

test('empty input blocks submission; upload sends multipart fields and prevents duplicate requests', () => {
  const ui = setup()
  ui.fire('#submit-button', 'click')
  assert.equal(ui.requests.length, 0)
  ui.input('#paste-expiration-input', '2h')
  ui.input('#paste-passwd-input', 'secret')
  const request = submit(ui)
  assert.equal(request.method, 'POST')
  assert.equal(request.url, base)
  assert.deepEqual(Object.fromEntries(request.data), { c: 'port: 7890', e: '2h', s: 'secret' })
  assert.equal(request.processData, false)
  assert.equal(request.contentType, false)
  ui.fire('#submit-button', 'click')
  assert.equal(ui.requests.length, 1)
  request.complete()
  assert.equal(ui.node('#submit-button').disabled, false)
})

test('long and custom URL modes send only their own API options', () => {
  const ui = setup()
  ui.mode('long')
  let request = submit(ui)
  assert.equal(request.data.get('p'), 'true')
  assert.equal(request.data.has('n'), false)
  request.complete()
  ui.mode('custom')
  ui.input('#paste-custom-url-input', 'ab')
  ui.fire('#submit-button', 'click')
  assert.equal(ui.requests.length, 1)
  ui.input('#paste-custom-url-input', 'my_config')
  ui.fire('#submit-button', 'click')
  request = ui.requests.at(-1)
  assert.equal(request.data.get('n'), 'my_config')
  assert.equal(request.data.has('p'), false)
})

test('management rejects foreign origins and permits deletion without replacement content', () => {
  const ui = setup()
  ui.mode('admin')
  for (const invalid of ['not a URL', base + '/public', 'https://evil.example/name:secret', base + '.evil.example/name:secret']) {
    ui.input('#paste-admin-url-input', invalid)
    submit(ui)
    ui.fire('#delete-button', 'click')
  }
  assert.equal(ui.requests.length, 0)
  const admin = base + '/name:secret'
  ui.input('#paste-admin-url-input', admin)
  ui.input('#paste-expiration-input', '')
  const update = submit(ui, 'updated')
  assert.equal(update.method, 'PUT')
  assert.equal(update.url, admin)
  assert.deepEqual(Object.fromEntries(update.data), { c: 'updated' })
  update.complete()
  ui.input('#paste-textarea', '')
  ui.fire('#delete-button', 'click')
  assert.equal(ui.requests.at(-1).method, 'DELETE')
  assert.equal(ui.requests.at(-1).url, admin)
})

test('results clear stale optional values and preserve management link after a failed retry', () => {
  const ui = setup()
  complete(submit(ui), { url: base + '/one', admin: base + '/one:secret', suggestUrl: base + '/one/file', expire: 3600 })
  complete(submit(ui), { url: base + '/two', admin: base + '/two:private', suggestUrl: null, expire: null })
  assert.equal(ui.node('#uploaded-url').value, base + '/two')
  assert.equal(ui.node('#uploaded-admin-url').value, base + '/two:private')
  assert.equal(ui.node('#uploaded-suggest-url').value, '')
  assert.equal(ui.node('#uploaded-expiration').value, '')
  const request = submit(ui)
  request.error({ status: 403, responseText: '<script>secret-server-detail</script>' })
  request.complete()
  assert.equal(ui.node('#uploaded-admin-url').value, base + '/two:private')
  assert.equal(ui.node('#paste-uploaded-panel').classes.has('hidden'), false)
  assert.equal(ui.node('#submit-button').disabled, false)
  assert.ok(ui.alerts.length > 0)
  assert.ok(ui.alerts.every(message => !message.includes('secret-server-detail')))
})

test('file selection preserves bytes and filename, rejects oversized files, and permits switching back to text', async () => {
  const ui = setup()
  ui.input('#paste-textarea', 'editor preserved')
  const file = new File(['port: 7890'], '<img src=x>.yaml')
  ui.fire('#paste-file-upload', 'change', { target: { files: [file] } })
  ui.fire('#submit-button', 'click')
  const request = ui.requests.at(-1)
  const uploaded = request.data.get('c')
  assert.equal(uploaded.name, file.name)
  assert.equal(await uploaded.text(), await file.text())
  assert.equal(ui.node('.file-name').textContent, file.name)
  request.complete()
  ui.fire('#paste-file-upload', 'change', { target: { files: [] } })
  ui.fire('#submit-button', 'click')
  const afterCancel = ui.requests.at(-1)
  assert.equal(afterCancel.data.get('c').name, file.name)
  assert.equal(await afterCancel.data.get('c').text(), await file.text())
  afterCancel.complete()
  ui.fire('#paste-file-upload', 'change', { target: { files: [{ name: 'large', size: 25 * 1024 * 1024 + 1 }] } })
  ui.fire('#submit-button', 'click')
  assert.equal(ui.requests.length, 2)
  ui.fire('#paste-file-upload', 'change', { target: { files: [] } })
  assert.equal(ui.node('#submit-button').disabled, true)
  ui.fire('#paste-tab-edit', 'click')
  assert.equal(ui.node('#paste-textarea').value, 'editor preserved')
  ui.fire('#submit-button', 'click')
  assert.equal(ui.requests.at(-1).data.get('c'), 'editor preserved')
})

test('opening a management URL reads the public path without sending its password', () => {
  const ui = setup('/~named:secret')
  assert.equal(ui.node('#advanced-settings').open, true)
  assert.equal(ui.node('#management-links').open, false)
  assert.equal(ui.node('#paste-admin-url-input').value, base + '/~named:secret')
  assert.equal(hidden(ui, '#delete-button'), false)
  assert.equal(ui.requests.length, 1)
  assert.equal(ui.requests[0].url, '/~named')
  ui.requests[0].success('loaded: true')
  assert.equal(ui.node('#paste-textarea').value, 'loaded: true')
  ui.fire('#submit-button', 'click')
  assert.equal(ui.requests.at(-1).method, 'PUT')
  assert.equal(ui.requests.at(-1).url, base + '/~named:secret')
})
