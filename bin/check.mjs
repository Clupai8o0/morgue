import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
const SITE=process.cwd()+'/site'
const SRC=process.env.MORGUE_SRC||'items'
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.mp4':'video/mp4','.webp':'image/webp','.avif':'image/avif','.png':'image/png','.txt':'text/plain'}
const srv=createServer(async(req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'
  try{const b=await readFile(path.join(SITE,u));res.writeHead(200,{'content-type':MIME[path.extname(u)]??'application/octet-stream'});res.end(b)}catch{res.writeHead(404).end('nf')}})
await new Promise(r=>srv.listen(8917,r))
const br=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-angle=metal']})
let bad=0
for (const slug of (await readdir(process.cwd()+'/'+SRC)).sort()) {
  const pg=await br.newPage({viewport:{width:1000,height:700}})
  const errs=[]
  pg.on('pageerror',e=>errs.push('JS:'+String(e).slice(0,50)))
  pg.on('response',r=>{ if(r.status()>=400) errs.push(r.status()+' '+r.url().replace(/^http:\/\/[^/]+/,'')) })
  await pg.goto(`http://127.0.0.1:8917/item/${slug}/index.html`,{waitUntil:'load'}).catch(e=>errs.push('GOTO'))
  await pg.waitForTimeout(1400)
  const ok = await pg.evaluate(()=>document.body && document.body.innerHTML.length>50)
  const u=[...new Set(errs)]
  if(u.length) bad++
  console.log(`  ${slug.padEnd(20)} ${u.length?'FAIL  '+u.slice(0,2).join(' | '):'ok'}`)
  await pg.close()
}
console.log(bad?`\n${bad} item page(s) broken in the built site`:'\nall item pages run')
await br.close(); srv.close()
