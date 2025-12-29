import './styles/global.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './_app'

const root = document.getElementById('root') as HTMLElement

console.log('Running renderer process code')
console.log(import.meta.env)

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
