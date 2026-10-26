import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App'
import '../../src/styles.css'
import '../../src/motion.css'

// The actual application; the browser suite intercepts every API and external request.
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
