// Single source of truth for vendored library paths.
//
// This existing in one place is not tidiness — the capture harness and the built site
// previously resolved /vendor/ and /three/ through separate code, so an item could capture
// perfectly and still 404 on its own detail page. That is exactly the failure that is
// invisible until you click, which at 400 items means never.
export const VENDOR = {
  '/vendor/': 'node_modules/gsap/dist',
  '/three/': 'node_modules/three/build',
  '/lenis/': 'node_modules/lenis/dist',
}

export function resolveVendor(url, root, path) {
  for (const [prefix, dir] of Object.entries(VENDOR)) {
    if (url.startsWith(prefix)) return path.join(root, dir, url.slice(prefix.length))
  }
  return null
}
