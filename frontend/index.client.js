const SEP = ':'

function parsePath(pathname) {
  let role = "", ext = ""
  if (pathname[2] === "/") {
    role = pathname[1]
    pathname = pathname.slice(2)
  }
  let startOfExt = pathname.indexOf(".")
  if (startOfExt >= 0) {
    ext = pathname.slice(startOfExt)
    pathname = pathname.slice(0, startOfExt)
  }
  let endOfShort = pathname.indexOf(SEP)
  if (endOfShort < 0) endOfShort = pathname.length // when there is no SEP, passwd is left empty
  const short = pathname.slice(1, endOfShort)
  const passwd = pathname.slice(endOfShort + 1)
  return { role, short, passwd, ext }
}

window.addEventListener('DOMContentLoaded', () => {
  const base_url = {{BASE_URL_JSON}}
  const deploy_date = new Date('{{DEPLOY_DATE}}')

  function getDateString(date) {
    const year = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day = date.getDate().toString().padStart(2, '0')
    const hour = date.getHours().toString().padStart(2, '0')
    const minute = date.getMinutes().toString().padStart(2, '0')
    const second = date.getSeconds().toString().padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`
  }

  $('#deploy-date').text(getDateString(deploy_date))

  // Optional native dialog supplied by the visual template.
  const aboutDialog = document.getElementById('about-dialog')
  $('#about, #about-close').attr('type', 'button')
  $('#about').on('click', event => {
    event.preventDefault()
    if (aboutDialog && !aboutDialog.open && typeof aboutDialog.showModal === 'function') {
      aboutDialog.showModal()
    }
  })
  $('#about-close').on('click', event => {
    event.preventDefault()
    if (aboutDialog?.open) aboutDialog.close()
  })
  if (aboutDialog) {
    aboutDialog.addEventListener('click', event => {
      if (event.target !== aboutDialog) return
      const bounds = aboutDialog.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) {
        aboutDialog.close()
      }
    })
    // Escape and focus restoration are handled by the native dialog.
  }

  function isAdminUrlLegal(url) {
    try {
      url = new URL(url)
      return url.origin === base_url && url.pathname.indexOf(':') >= 0
    } catch (e) {
      if (e instanceof TypeError) {
        return false
      } else {
        throw e
      }
    }
  }

  const formatSize = (size) => {
    if (!size) return '0'
    if (size < 1024) {
      return `${size} Bytes`
    } else if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(2)} KB`
    } else if (size < 1024 * 1024 * 1024) {
      return `${(size / 1024 / 1024).toFixed(2)} MB`
    } else {
      return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
    }
  }

  // Optional details supplied by the compact template.
  $('#advanced-settings').prop('open', false)
  $('#management-links').prop('open', false)
  $('#result-suggest').prop('hidden', true)
  $('#result-expiration').prop('hidden', true)

  // monitor input changes and enable/disable submit button
  let urlType = $('input[name="url-type"]:checked').val()
  let inputType = 'edit'
  let expiration = $('#paste-expiration-input').val()
  let passwd = $('#paste-passwd-input').val() || ''
  let customName = $('#paste-custom-url-input').val() || ''
  let adminUrl = $('#paste-admin-url-input').val() || '', file = null
  let uploading = false
  let pendingAction = ''
  const MAX_FILE_SIZE = 25 * 1024 * 1024

  const NAME_REGEX = /^[a-zA-Z0-9+_\-\[\]*$@,;]{3,}$/
  const EXPIRE_REGEX = /^\d+\s*[smhdwMY]?$/
  const submitButton = $('#submit-button')
  const deleteButton = $('#delete-button')
  const pasteEditArea = $('#paste-textarea')
  const submitErrMsg = $('#submit-error-msg')

  submitButton.add(deleteButton).attr('type', 'button')
  submitErrMsg.attr({ role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' })
  submitButton.attr('aria-describedby', 'submit-error-msg')

  function disableSubmitButton(reason) {
    submitButton.removeClass('enabled')
    submitErrMsg.text(reason)
  }

  function updateButtons() {
    const pasteNotEmpty = inputType === 'edit'
      ? pasteEditArea.prop('value').length > 0
      : file !== null
    let expirationValid = EXPIRE_REGEX.test(expiration)  // TODO: verify it
    if (!expiration) {
      expirationValid = true
    }
    const nameValid = urlType !== 'custom' || NAME_REGEX.test(customName)
    const adminUrlValid = urlType !== 'admin' || isAdminUrlLegal(adminUrl)

    if (uploading) {
      disableSubmitButton('')
    } else if (inputType === 'file' && file && file.size > MAX_FILE_SIZE) {
      disableSubmitButton('文件不能超过 25 MiB')
    } else if (!pasteNotEmpty) {
      disableSubmitButton('')
    } else if (!expirationValid) {
      disableSubmitButton(`到期日期“${expiration}”无效`)
    } else if (!nameValid) {
      disableSubmitButton(`自定义 URL 应满足正则表达式 ${NAME_REGEX}`)
    } else if (!adminUrlValid) {
      disableSubmitButton(`管理员网址“${adminUrl}”无效`)
    } else {
      submitButton.addClass('enabled')
      submitErrMsg.text('')
    }

    submitButton.text(uploading && pendingAction !== 'delete'
      ? (pendingAction === 'update' ? '更新中…' : '生成中…')
      : (urlType === 'admin' ? '更新' : '生成链接'))
    deleteButton.text(uploading && pendingAction === 'delete' ? '删除中…' : '删除')
    deleteButton.toggleClass('hidden', urlType !== 'admin')
    deleteButton.toggleClass('enabled', urlType === 'admin' && adminUrlValid && !uploading)
    submitButton.prop('disabled', !submitButton.hasClass('enabled'))
    deleteButton.prop('disabled', !deleteButton.hasClass('enabled'))
    submitButton.add(deleteButton).each((_, button) => {
      button.setAttribute('aria-disabled', String(button.disabled))
      button.setAttribute('aria-busy', String(uploading &&
        (button === deleteButton[0] ? pendingAction === 'delete' : pendingAction !== 'delete')))
    })
    $('#paste-input-panel').attr('aria-busy', String(uploading))
    // Optional metadata hook; no dependency on a particular visual layout.
    $('#paste-character-count').text(pasteEditArea.val().length.toLocaleString())
  }

  updateButtons()

  const editTab = $('#paste-tab-edit')
  const fileTab = $('#paste-tab-file')
  const fileInput = $('#paste-file-upload')
  // These are mode/chooser buttons, not ARIA tabs: the file control opens a picker.
  editTab.add(fileTab).attr({ role: 'button', tabindex: '0' })
  editTab.attr('aria-controls', 'paste-edit')
  fileTab.attr('aria-controls', 'paste-file-show')
  editTab.add(fileTab).filter('button').attr('type', 'button')
  editTab.add(fileTab).on('keydown', event => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (event.currentTarget === fileTab[0]) fileInput[0].click()
      else editTab[0].click()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      ;(event.currentTarget === editTab[0] ? fileTab[0] : editTab[0]).focus()
    }
  })
  fileTab.on('click', event => {
    // A label already activates its associated input natively.
    if (fileTab[0].tagName !== 'LABEL' && event.target !== fileInput[0]) {
      event.preventDefault()
      fileInput[0].click()
    }
  })

  function updateTabBar() {
    editTab.attr('aria-pressed', String(inputType === 'edit'))
    fileTab.attr('aria-pressed', String(inputType === 'file'))
    $('#paste-edit').prop('hidden', inputType !== 'edit')
    $('#paste-file-show').prop('hidden', inputType !== 'file')
    if (inputType === 'file') {
      $('#paste-tab-edit').removeClass('enabled')
      $('#paste-tab-file').addClass('enabled')
      $('#paste-file-show').addClass('enabled')
      $('#paste-edit').removeClass('enabled')
    } else {
      $('#paste-tab-file').removeClass('enabled')
      $('#paste-tab-edit').addClass('enabled')
      $('#paste-edit').addClass('enabled')
      $('#paste-file-show').removeClass('enabled')
    }
  }

  updateTabBar()

  fileInput.on('change', event => {
    const files = event.target.files
    // Cancelling the picker must not discard the previous selection or draft.
    if (!files || files.length === 0) return
    file = files[0]
    inputType = 'file'
    updateButtons()
    updateTabBar()
    const fileLine = $('#paste-file-line')
    fileLine.children('.file-name').text(file.name)
    fileLine.children('.file-size').text(formatSize(file.size))
  })

  $('#paste-tab-edit').on('click', event => {
    event.preventDefault()
    // Permit choosing the same file again after returning to the editor.
    fileInput.val('')
    inputType = 'edit'
    updateButtons()
    updateTabBar()
  })

  pasteEditArea.on('input', updateButtons)

  $('#paste-expiration-input').on('input', event => {
    expiration = event.target.value
    updateButtons()
  })

  $('#paste-passwd-input').on('input', event => {
    passwd = event.target.value
  })

  $('input[name="url-type"]').on('input', event => {
    urlType = event.target.value
    updateButtons()
  })

  $('#paste-custom-url-input').on('input', event => {
    customName = event.target.value
    updateButtons()
  })

  $('#paste-admin-url-input').on('input', event => {
    adminUrl = event.target.value
    updateButtons()
  })

  // submit the form
  submitButton.on('click', event => {
    event.preventDefault()
    updateButtons()
    if (!uploading && !submitButton.prop('disabled')) {
      if (urlType === 'admin') {
        putPaste()
      } else {
        postPaste()
      }
    }
  })

  deleteButton.on('click', event => {
    event.preventDefault()
    updateButtons()
    if (!uploading && !deleteButton.prop('disabled')) {
      deletePaste()
    }
  })

  function putPaste() {
    prepareUploading()
    let fd = new FormData()
    if (inputType === 'file') {
      fd.append('c', file)
    } else {
      fd.append('c', pasteEditArea.prop('value'))
    }

    if (expiration.length > 0) fd.append('e', expiration)
    if (passwd.length > 0) fd.append('s', passwd)

    $.ajax({
      method: 'PUT',
      url: adminUrl,
      data: fd,
      processData: false,
      contentType: false,
      success: (data) => {
        renderUploaded(data)
      },
      error: handleError,
      complete: finishUploading,
    })
  }

  function postPaste() {
    prepareUploading()
    let fd = new FormData()
    if (inputType === 'file') {
      fd.append('c', file)
    } else {
      fd.append('c', pasteEditArea.prop('value'))
    }

    if (expiration.length > 0) fd.append('e', expiration)
    if (passwd.length > 0) fd.append('s', passwd)

    if (urlType === 'long') fd.append('p', 'true')
    if (urlType === 'custom') fd.append('n', customName)

    $.post({
      url: base_url,
      data: fd,
      processData: false,
      contentType: false,
      success: (data) => {
        renderUploaded(data)
      },
      error: handleError,
      complete: finishUploading,
    })
  }

  function deletePaste() {
    prepareUploading('delete')
    let fd = new FormData()
    $.ajax({
      method: 'DELETE',
      url: adminUrl,
      data: fd,
      processData: false,
      success: () => {
        alert('删除成功')
      },
      error: handleError,
      complete: finishUploading,
    })
  }

  function prepareUploading(action = urlType === 'admin' ? 'update' : 'upload') {
    pendingAction = action
    uploading = true
    resetCopyButtons()
    updateButtons()
    // Keep the last management link available if the next request fails.
  }

  function finishUploading() {
    uploading = false
    updateButtons()
  }

  function renderUploaded(uploaded) {
    $('#paste-uploaded-panel input').prop('value', '')
    // Also reveal results when the template uses a details or hidden container.
    $('#paste-uploaded-panel').removeClass('hidden').prop('hidden', false).prop('open', true)
    $('#management-links').prop('open', false)
    $('#uploaded-url').prop('value', uploaded.url)
    $('#uploaded-admin-url').prop('value', uploaded.admin)
    const hasSuggestUrl = Boolean(uploaded.suggestUrl)
    const hasExpiration = uploaded.expire != null && uploaded.expire !== ''
    $('#result-suggest').toggleClass('hidden', !hasSuggestUrl).prop('hidden', !hasSuggestUrl)
    $('#result-expiration').toggleClass('hidden', !hasExpiration).prop('hidden', !hasExpiration)
    if (hasSuggestUrl) {
      $('#uploaded-suggest-url').prop('value', uploaded.suggestUrl)
    }
    if (hasExpiration) {
      $('#uploaded-expiration').prop('value', uploaded.expire)
    }
    resetCopyButtons()
    updateButtons()
  }

  const copyStates = new Map()
  $('.copy-button').each((_, button) => {
    copyStates.set(button, { html: button.innerHTML, timer: null, version: 0 })
    button.setAttribute('type', 'button')
    button.setAttribute('aria-live', 'polite')
  })

  function copyInput(button) {
    const target = button.getAttribute('data-copy-target')
    return target ? document.getElementById(target.replace(/^#/, ''))
      : button.closest('.uploaded-entry')?.querySelector('input') || button.parentElement.querySelector('input')
  }

  $('.copy-button').on('click', async event => {
    event.preventDefault()
    const button = event.currentTarget
    const input = copyInput(button)
    if (button.disabled || !input || !input.value) return
    resetCopyButtons()
    const state = copyStates.get(button)
    const version = state.version
    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    const value = input.value
    try {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
        await navigator.clipboard.writeText(value)
      } catch (_) {
        // Do not copy a new result if it changed while permission was pending.
        if (state.version !== version || input.value !== value) return
        input.focus()
        input.select()
        if (!document.execCommand('copy')) throw new Error('Copy failed')
        button.focus()
      }
      if (state.version === version) button.textContent = '已复制'
    } catch (_) {
      if (state.version === version) {
        button.textContent = '请手动复制'
        input.focus()
        input.select()
      }
    } finally {
      if (state.version === version) {
        button.disabled = !input.value
        button.setAttribute('aria-busy', 'false')
        state.timer = setTimeout(() => restoreCopyButton(button, state), 2500)
      }
    }
  })

  function restoreCopyButton(button, state) {
    clearTimeout(state.timer)
    state.version++
    // Only restore trusted template markup, never response content.
    button.innerHTML = state.html
    button.disabled = !copyInput(button)?.value
    button.setAttribute('aria-busy', 'false')
  }

  function resetCopyButtons() {
    copyStates.forEach((state, button) => restoreCopyButton(button, state))
  }

  resetCopyButtons()

  function handleError(error) {
    const status = Number(error.status) || 0
    const messages = {
      400: '请求参数无效，请检查有效期和管理链接。',
      401: '需要身份认证。',
      403: '管理密码错误或没有操作权限。',
      404: '粘贴不存在或已过期。',
      409: '自定义名称已被使用。',
      413: '上传内容超过大小限制。',
    }
    const message = messages[status] || (status >= 500 ? '服务器处理失败，请稍后重试。' : '网络请求失败，请检查连接后重试。')
    alert(`${status ? `错误 ${status}：` : ''}${message}`)
  }

  function initAdmin() {
    const { role, short, passwd, ext } = parsePath(location.pathname)
    if (passwd.length > 0) {
      $('#advanced-settings').prop('open', true)
      $('#paste-url-admin-radio').click()
      $('#paste-admin-url-input').val(location.href)
      urlType = 'admin'
      adminUrl = location.href
      updateButtons()
      $.ajax({
        url: "/" + short,
        success: paste => {
          pasteEditArea.val(paste)
          updateButtons()
        },
        error: handleError,
      })
    }
  }

  initAdmin()
})
