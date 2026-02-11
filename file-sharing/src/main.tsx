import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <React.Suspense fallback="Loading...">
      <App />
    </React.Suspense>
  </StrictMode>,
)
