// Single source of truth for every extra directory tree the vault serves alongside an
// item's own folder — the vendored animation libraries, and now the ingested template
// archives that some items are only a pointer into.
//
// This existing in one place is not tidiness — the capture harness and the built site
// previously resolved /vendor/ and /three/ through separate code, so an item could capture
// perfectly and still 404 on its own detail page. That is exactly the failure that is
// invisible until you click, which at 400 items means never.
export const VENDOR = {
  '/vendor/': 'node_modules/gsap/dist',
  '/three/': 'node_modules/three/build',
  // OrbitControls and friends are not in three/build — they live in examples/jsm
  // and are imported as "three/addons/…". Six components in the CodeGrid corpus
  // died on exactly that specifier: the page loads, three resolves through the
  // importmap, and the addon throws "Failed to resolve module specifier", which
  // shows up as a still frame and `motion: DEAD` rather than as a missing file.
  '/three-addons/': 'node_modules/three/examples/jsm',
  '/lenis/': 'node_modules/lenis/dist',
  // ── Added for the CodeGrid component corpus ───────────────────────────────
  // Each of these is a library the deliveries load from a CDN, which an item
  // that has to run offline cannot do. The MAJOR is pinned to what the source
  // actually calls, not to what is newest: anime 4 replaced the global `anime`
  // with named ESM exports and locomotive 5 rewrote its API, so vendoring the
  // current major would leave the page loading a file that cannot run it.
  '/anime/': 'node_modules/animejs/lib',
  '/matter/': 'node_modules/matter-js/build',
  '/split-type/': 'node_modules/split-type/umd',
  '/locomotive/': 'node_modules/locomotive-scroll/dist',
  '/lottie/': 'node_modules/lottie-web/build/player',
  '/p5/': 'node_modules/p5/lib',
  // Not a library. `archives/<name>/` is a whole ingested third-party template —
  // source, package.json, node_modules, build cache — of which only the built
  // export is servable. resolveVendor() splices that in; see below.
  '/archive/': 'archives',
}

// The URL an archive is mounted at, on BOTH surfaces: capture serves it out of
// archives/<name>/out, the built site out of site/archive/<name>. Same URL either
// way, so an item that captures clean also runs on its detail page.
export const ARCHIVE_PREFIX = '/archive/'
export const archiveMount = (name) => ARCHIVE_PREFIX + name

// The ONLY servable part of an archive. `archives/<name>/` is a buildable project —
// src/, package.json, node_modules/, .next/ — and all of it is licensed source that
// must not be republished. Its built static export is the part that is a website.
//
// build.mjs must copy THIS, not the archive directory, into site/archive/<name>. Copying
// the whole VENDOR entry the way the library mounts do would publish src/ and put the
// export one level too deep, so every archive-backed item's detail page 404s.
export const archiveRoot = (root, name, path) => path.join(root, VENDOR[ARCHIVE_PREFIX], name, 'out')

// Where an archive-backed item's page lives, relative to whichever root is being
// served. One definition, so capture's goto, build's href and check's navigation
// cannot drift apart.
export function archiveEntry(archive) {
  const route = archive.route ?? '/'
  return archiveMount(archive.name) + (route.startsWith('/') ? route : '/' + route)
}

export function resolveVendor(url, root, path) {
  for (const [prefix, dir] of Object.entries(VENDOR)) {
    if (!url.startsWith(prefix)) continue
    const rel = url.slice(prefix.length)
    if (prefix !== ARCHIVE_PREFIX) return path.join(root, dir, rel)
    // /archive/<name>/work  ->  archives/<name>/out/work.  Routing through
    // archiveRoot() rather than joining `dir` directly is deliberate: the rule about
    // what an archive exposes is written down once, and a caller cannot accidentally
    // serve src/ or node_modules by resolving the mount the obvious way.
    const cut = rel.indexOf('/')
    return cut === -1
      ? archiveRoot(root, rel, path)
      : path.join(archiveRoot(root, rel.slice(0, cut), path), rel.slice(cut + 1))
  }
  return null
}
