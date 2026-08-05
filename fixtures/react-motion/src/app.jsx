import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { motion, AnimatePresence } from 'motion/react'

const ITEMS = ['Layout', 'Spring', 'Presence', 'Stagger']

function Demo() {
  const [open, setOpen] = useState(1)
  return (
    <div className="stage">
      <div className="stack">
        {ITEMS.map((label, i) => (
          <motion.button
            key={label}
            className="row"
            onHoverStart={() => setOpen(i)}
            animate={{ flexGrow: open === i ? 3 : 1 }}
            transition={{ type: 'spring', stiffness: 210, damping: 26 }}
          >
            <span className="lbl">{label}</span>
            <AnimatePresence>
              {open === i && (
                <motion.span
                  className="dot"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ duration: 0.35 }}
                />
              )}
            </AnimatePresence>
          </motion.button>
        ))}
      </div>
      <motion.div
        className="cap"
        animate={{ opacity: [0.25, 0.7, 0.25] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        react 19 · motion
      </motion.div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Demo />)
window.__ready = true
