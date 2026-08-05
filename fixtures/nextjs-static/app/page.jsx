'use client'
import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'

export default function Page() {
  const root = useRef(null)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    setHydrated(true)
    const ctx = gsap.context(() => {
      gsap.timeline({ repeat: -1, yoyo: true })
        .to('.blk', { y: -60, rotate: 8, stagger: 0.08, duration: 0.9, ease: 'power3.inOut' })
        .to('.blk', { y: 0, rotate: 0, stagger: 0.08, duration: 0.9, ease: 'power3.inOut' }, '>')
      gsap.to('.halo', { scale: 1.35, opacity: 0.15, duration: 1.6, repeat: -1, yoyo: true, ease: 'sine.inOut' })
    }, root)
    // Signal only after hydration + first GSAP tick, so capture never starts on SSR markup.
    requestAnimationFrame(() => { window.__ready = true })
    return () => ctx.revert()
  }, [])
  return (
    <main ref={root} style={{height:'100vh',display:'grid',placeItems:'center'}}>
      <div className="halo" style={{position:'absolute',width:340,height:340,borderRadius:'50%',
        border:'1px solid rgba(242,242,240,.35)'}} />
      <div style={{display:'flex',gap:14}}>
        {['N','E','X','T'].map((c) => (
          <div key={c} className="blk" style={{width:74,height:96,background:'#16161c',
            border:'1px solid rgba(242,242,240,.12)',borderRadius:8,display:'grid',placeItems:'center',
            fontSize:13,letterSpacing:'.2em'}}>{c}</div>
        ))}
      </div>
      <div style={{position:'absolute',bottom:'12%',fontSize:11,letterSpacing:'.3em',
        textTransform:'uppercase',opacity:.35}}>
        next {hydrated ? 'hydrated' : 'ssr'} · gsap
      </div>
    </main>
  )
}
