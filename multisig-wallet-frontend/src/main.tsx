import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import { ToastProvider } from './components/ToastProvider'
import CreateWallet from './pages/CreateWallet'
import WalletDashboard from './pages/WalletDashboard'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/create" replace />} />
          <Route path="/create" element={<CreateWallet />} />
          <Route path="/wallet/:address" element={<WalletDashboard />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)