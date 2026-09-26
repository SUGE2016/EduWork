import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'

export async function pageBrowser(connection, signal, nodeEnvironment = process.env.DSH_MEDIA_NODE_ENV) {
  signal?.throwIfAborted()
  const url = new URL(connection.baseURL)
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !/^[A-Za-z0-9_-]{43}$/u.test(connection.token)) throw Error('Invalid browser connection')
  const require = createRequire(join(nodeEnvironment, 'package.json'))
  const browser = await require('playwright-core').chromium.connectOverCDP(`${url.origin}/render`, { headers: { authorization: 'Bearer ' + connection.token }, timeout: 15000 })
  if (signal?.aborted) { await browser.close(); signal.throwIfAborted() }
  return browser
}

export async function renderBrowser(connection, signal, nodeEnvironment = process.env.DSH_MEDIA_NODE_ENV) {
  signal?.throwIfAborted()
  const url = new URL(connection.baseURL)
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !/^[A-Za-z0-9_-]{43}$/u.test(connection.token)) throw Error('Invalid browser connection')
  const require = createRequire(join(nodeEnvironment, 'package.json'))
  const root = dirname(require.resolve('@remotion/renderer'))
  if (JSON.parse(await readFile(join(root, '../package.json'))).version !== '4.0.520') throw Error('Requalify Electron renderer adapter for this Remotion version')
  const { NodeWebSocketTransport } = require(join(root, 'browser/NodeWebSocketTransport.js'))
  const { Connection } = require(join(root, 'browser/Connection.js'))
  const { HeadlessBrowser } = require(join(root, 'browser/Browser.js'))
  const WS = require('ws')
  const socket = new WS(`${url.origin}/render`, { headers: { authorization: 'Bearer ' + connection.token }, handshakeTimeout: 15000 })
  const abort = () => socket.terminate()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    signal?.throwIfAborted()
    const transport = new NodeWebSocketTransport(socket)
    const protocol = new Connection(transport)
    const runner = { connection: protocol, listeners: [], deleteBrowserCaches() {},
      forgetEventLoop: () => transport.forgetEventLoop(), rememberEventLoop: () => transport.rememberEventLoop(),
      closeProcess: async () => { signal?.removeEventListener('abort', abort); protocol.dispose() } }
    const browser = new HeadlessBrowser({ connection: protocol, runner, defaultViewport: { width: 800, height: 600, deviceScaleFactor: 1 } })
    await protocol.send('Target.setDiscoverTargets', { discover: true })
    return browser
  } catch (error) { signal?.removeEventListener('abort', abort); socket.terminate(); throw error }
}
