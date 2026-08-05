export const metadata = { title: 'Next static export' }
export default function RootLayout({ children }) {
  return (<html lang="en"><body style={{margin:0,background:'#0b0b0d',color:'#f2f2f0',
    font:'400 16px/1.4 -apple-system,system-ui,sans-serif',overflow:'hidden'}}>{children}</body></html>)
}
