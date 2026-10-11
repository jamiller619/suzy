import { createServer, type ServerResponse } from 'node:http'
import { loadTheme, watchConfig } from '../cli/files.js'
import { renderPreview } from './page.js'

export async function startPreview(configPath: string, port: number) {
  const current = await loadTheme(configPath)
  let revision = 0
  let error = ''
  let html = renderPreview(current.theme, revision)
  const clients = new Set<ServerResponse>()
  const state = () => `data: ${JSON.stringify({ revision, error })}\n\n`
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (request.method !== 'GET') {
      response.writeHead(405).end()
      return
    }
    if (request.url === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
      })
      clients.add(response)
      response.write(state())
      request.on('close', () => clients.delete(response))
    } else if (request.url === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      })
      response.end(html)
    } else {
      response.writeHead(404).end('Not found')
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  let stopWatch: () => Promise<void>
  try {
    stopWatch = watchConfig(
      configPath,
      async () => {
        try {
          const next = await loadTheme(configPath)
          const nextHtml = renderPreview(next.theme, revision + 1)
          revision++
          html = nextHtml
          error = ''
        } catch (e) {
          error = `Configuration error; showing last valid theme. ${(e as Error).message}`
        }
        for (const client of clients) {
          client.write(state())
        }
      },
      (e) => {
        error = e.message
        for (const client of clients) {
          client.write(state())
        }
      },
    )
  } catch (e) {
    server.close()
    throw e
  }
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      client.write(': heartbeat\n\n')
    }
  }, 15000)
  const address = server.address()
  return {
    url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`,
    close: async () => {
      clearInterval(heartbeat)
      await stopWatch()
      for (const client of clients) {
        client.end()
      }
      clients.clear()
      await new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()))
        server.closeAllConnections()
      })
    },
  }
}
