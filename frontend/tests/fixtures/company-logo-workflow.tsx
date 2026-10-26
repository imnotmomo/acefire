import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App'
import { setApiAccessTokenProvider } from '../../src/backend'
import '../../src/styles.css'
import '../../src/motion.css'

// Test-only optional auth adapter, registered before the real application mounts.
setApiAccessTokenProvider(async () => 'fixture-logo-token')
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
