// Keep application navigation local; delegate ordinary web links to the
// configured browser surface. Never grant a remote page the desktop preload.
export function navigationTarget(raw) {
  try {
    const url = new URL(raw)
    if (url.username || url.password) return 'blocked'
    if (url.protocol === 'dsh-app:' && ['app', 'shell'].includes(url.hostname)) return 'internal'
    if (url.protocol === 'https:' || url.protocol === 'http:') return 'external'
  } catch {}
  return 'blocked'
}

export function attachExternalNavigation(contents, openExternal, onError = () => {}) {
  const open = url => {
    // Both synchronous launch failures and rejected OS calls are contained.
    void Promise.resolve().then(() => openExternal(url)).catch(onError)
  }
  contents.setWindowOpenHandler(({ url }) => {
    if (navigationTarget(url) === 'external') open(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, legacyURL) => {
    const url = legacyURL ?? event.url
    const target = navigationTarget(url)
    if (target === 'internal') return
    event.preventDefault()
    if (target === 'external') open(url)
  })
}
