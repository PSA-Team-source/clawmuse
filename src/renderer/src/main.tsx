// Must stay first: copies pre-rename localStorage keys before any store reads them.
import '@/lib/migrate-storage'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import '@/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
