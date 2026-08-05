#!/usr/bin/env node
// Static server for the built site. Binds 0.0.0.0 so you can browse the morgue from a
// phone or iPad on the same network — which is most of the point of a reference collection.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = path.join(ROOT, 'site')
const PORT = Number(process.env.PORT || 8910)

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.webp': 'image/webp',
  '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary',
}

createServer(async (req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0])
  if (url.endsWith('/')) url += 'index.html'
  const file = path.join(SITE, url)
  // Never serve outside site/ — items are third-party code and some of it is hostile-shaped.
  if (!file.startsWith(SITE)) return res.writeHead(403).end('forbidden')
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`morgue → http://localhost:${PORT}`)
})
