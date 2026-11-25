import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ToastHost from './components/ui/ToastHost'
import App from './App.tsx'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import queryClient from './config/queryClient.ts'
import { ThemeProvider } from './context/ThemeContext.tsx'

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({
        default: m.ReactQueryDevtools,
      }))
    )
  : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
  <ThemeProvider>
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
      <ToastHost />
      {ReactQueryDevtools ? (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      ) : null}
    </BrowserRouter>
  </QueryClientProvider>
  </ThemeProvider>
  </StrictMode>,
)
