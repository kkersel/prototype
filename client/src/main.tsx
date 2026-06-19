import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Home } from './pages/Home'
import { Editor } from './pages/Editor'
import { Player } from './pages/Player'
import { Toaster } from './components/ui'
import './styles/index.css'

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/editor/:id', element: <Editor /> },
  { path: '/play/:id', element: <Player /> },
  // Heatmaps is a view of the editor — deep-link opens it on the Карты tab.
  { path: '/heatmaps/:id', element: <Editor initialView="heat" /> },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
    <Toaster />
  </React.StrictMode>
)

// Register the runtime-cache service worker (no-op over plain LAN http).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
