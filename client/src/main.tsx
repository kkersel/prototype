import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Home } from './pages/Home'
import { Editor } from './pages/Editor'
import { Player } from './pages/Player'
import { Heatmaps } from './pages/Heatmaps'
import './styles/index.css'

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/editor/:id', element: <Editor /> },
  { path: '/play/:id', element: <Player /> },
  { path: '/heatmaps/:id', element: <Heatmaps /> },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)

// Register the runtime-cache service worker (no-op over plain LAN http).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
