import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
const SITE=process.cwd()+'/site'
const SRC=process.env.MORGUE_SRC||'items'
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.mp4':'video/mp4','.webp':'image/webp','.avif':'image/avif','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain'}

// A Next static export emits about.html, but <Link href="/about"> navigates to the
// extension-less URL. A bare readFile 404s it, which would report every archive-backed
// item as broken for a reason that has nothing to do with the item. Mirrors readAny()
// in capture.mjs — same three candidates, so the two servers agree about what exists.
async function readAny(file){
  const cands = path.extname(file) ? [file] : [file, file+'.html', path.join(file,'index.html')]
  for(const c of cands){ try{ return {body:await readFile(c), file:c} }catch{} }
  return null
}
const srv=createServer(async(req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'
  const hit=await readAny(path.join(SITE,u))
  if(!hit) return void res.writeHead(404).end('nf')
  res.writeHead(200,{'content-type':MIME[path.extname(hit.file)]??'application/octet-stream'});res.end(hit.body)})
await new Promise(r=>srv.listen(8917,r))
const br=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-angle=metal']})
let bad=0

// How many internal links to click per item. Every one is a real navigation, so this is
// the whole cost knob. 6 covers a template's primary nav, which is where the links are.
const MAX_LINKS=6

// Where the items are is build.mjs's answer, not ours. Reading site/items.json means there
// is exactly ONE definition of an item's URL — the same reason bin/vendor.mjs exists. It
// also means an archive-backed item, which has no items/<slug>/index.html to navigate to,
// is checked at the route it actually lives at.
let records
try{
  records=JSON.parse(await readFile(path.join(SITE,'items.json'),'utf8')).map(r=>({slug:r.slug,href:'/'+String(r.href).replace(/^\//,'')}))
}catch{
  // No build yet. Fall back to the old directory scan so `check` says something useful
  // rather than a stack trace. Directories only: items/ also holds .gitkeep.
  console.warn('  ! site/items.json missing — run `pnpm build` first; falling back to a directory scan')
  records=(await readdir(process.cwd()+'/'+SRC,{withFileTypes:true}))
    .filter(d=>d.isDirectory()).map(d=>({slug:d.name,href:`/item/${d.name}/index.html`}))
}
records.sort((a,b)=>a.slug.localeCompare(b.slug))

for (const {slug,href} of records) {
  // 1280x800 matches capture.json's default viewport. It used to be 1000x700, which sits
  // below the 1200px desktop gate a real template uses and exactly ON a 1000px mobile
  // breakpoint — so check exercised a different code path than the video it is vouching
  // for, and could report green for a build in which none of the effects ran.
  const pg=await br.newPage({viewport:{width:1280,height:800}})
  const errs=[]
  pg.on('pageerror',e=>errs.push('JS:'+String(e).slice(0,50)))
  pg.on('response',r=>{ if(r.status()>=400) errs.push(r.status()+' '+r.url().replace(/^http:\/\/[^/]+/,'')) })
  await pg.goto(`http://127.0.0.1:8917${href}`,{waitUntil:'load'}).catch(e=>errs.push('GOTO'))
  await pg.waitForTimeout(1400)
  const ok = await pg.evaluate(()=>document.body && document.body.innerHTML.length>50).catch(()=>false)
  if(!ok) errs.push('EMPTY body')

  // ─── click-through ───────────────────────────────────────────────────────────
  // One goto per item proved the entry page loads and nothing more. An item lifted out of
  // a multi-page template keeps its nav, and those hrefs are written for the site it came
  // from — so they resolve against the VAULT root instead of the item's. `href="/about"`
  // 404s and `href="/"` serves the vault grid, and neither is visible until you click.
  const base=href.replace(/[^/]*$/,'')       // /item/<slug>/  — the item's own root
  const links=await pg.evaluate((max)=>{
    const seen=[]
    for(const a of document.querySelectorAll('a[href]')){
      if(a.origin!==location.origin) continue          // external, mailto:, javascript:
      if(a.pathname===location.pathname) continue      // self / pure #hash
      if(!seen.includes(a.pathname)) seen.push(a.pathname)
      if(seen.length>=max) break
    }
    return seen
  },MAX_LINKS).catch(()=>[])

  for(const link of links){
    const r=await pg.goto(`http://127.0.0.1:8917${link}`,{waitUntil:'domcontentloaded'}).catch(()=>null)
    const status=r?r.status():'ERR'
    // Escaping the item's own root is a failure even at 200. `href="/"` resolves to
    // site/index.html — the vault grid — which is a broken item link that returns OK.
    // Status alone cannot see it; the path can.
    // `base` always ends in '/', so an item's own root in its bare form
    // (/archive/blunt-main vs base /archive/blunt-main/) failed startsWith and was
    // reported as an escape at 200 while serving exactly the right document. That
    // was every archive-backed item's only "failure". Compare against the bare
    // form too — this still catches blunt-preloader's real one, where base is
    // /item/blunt-preloader/ and the links are / and /about.
    const escapes=!link.startsWith(base) && link!==base.replace(/\/$/,'')
    if(status>=400||status==='ERR'||escapes)
      errs.push(`LINK ${link} → ${status}${escapes?' (escapes '+base+')':''}`)
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const u=[...new Set(errs)]
  if(u.length) bad++
  console.log(`  ${slug.padEnd(20)} ${links.length?`[${links.length} link${links.length>1?'s':''}] `:''}${u.length?'FAIL  '+u.slice(0,3).join(' | '):'ok'}`)
  await pg.close()
}
console.log(bad?`\n${bad} item page(s) broken in the built site`:'\nall item pages run')
await br.close(); srv.close()
