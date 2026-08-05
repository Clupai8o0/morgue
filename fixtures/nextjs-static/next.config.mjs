export default {
  output: 'export',
  images: { unoptimized: true },
  // A static export hardcodes absolute /_next/... asset URLs. The vault serves each item from
  // /item/<slug>/, so without assetPrefix every chunk 404s — and it 404s ONLY in the built
  // site, not during capture (which serves the item at root). Set this at ingest time.
  assetPrefix: '/item/nextjs-static',
}
