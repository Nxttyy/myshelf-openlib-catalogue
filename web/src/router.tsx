// The route table defines lazy page components; hot reload doesn't apply here.
/* oxlint-disable react/only-export-components */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import AppLayout from './layout/AppLayout'
import Home from './routes/Home'

// Home ships in the first download (it's the landing page); every other page
// is its own chunk. AppLayout prefetches them once the first page is idle,
// so moving around still feels instant.
export const pageImports = {
  explore: () => import('./routes/Explore'),
  guide: () => import('./routes/Guide'),
  profile: () => import('./routes/Profile'),
  notFound: () => import('./routes/NotFound'),
  login: () => import('./routes/auth/Login'),
  register: () => import('./routes/auth/Register'),
  forgot: () => import('./routes/auth/ForgotPassword'),
  reset: () => import('./routes/auth/ResetPassword'),
}

const Explore = lazy(pageImports.explore)
const Guide = lazy(pageImports.guide)
const MyProfile = lazy(() => pageImports.profile().then((m) => ({ default: m.MyProfile })))
const PublicProfile = lazy(() => pageImports.profile().then((m) => ({ default: m.PublicProfile })))
const NotFound = lazy(pageImports.notFound)
const Login = lazy(pageImports.login)
const Register = lazy(pageImports.register)
const ForgotPassword = lazy(pageImports.forgot)
const ResetPassword = lazy(pageImports.reset)

const page = (C: ComponentType, fallback: ReactNode = null) => <Suspense fallback={fallback}><C /></Suspense>

// Mirrors the old Jinja pages. Views that used to be #hash tabs on `/` are
// real history entries now, so Back works. Explore lives at /explore because
// /books is an API prefix. /mobile-scan/:token stays a standalone FastAPI
// page so phones don't download the whole app just to scan.
const pages: RouteObject[] = [
  { index: true, element: <Home /> },
  { path: 'explore', element: page(Explore) },
  { path: 'guide', element: page(Guide) },
  { path: 'profile', element: page(MyProfile) },
  { path: 'u/:handle', element: page(PublicProfile) },
  { path: '*', element: page(NotFound) },
]

if (import.meta.env.DEV) {
  const Kit = lazy(() => import('./routes/Kit'))
  pages.unshift({ path: 'dev/kit', element: page(Kit) })
}

export const router = createBrowserRouter([
  { path: '/', element: <AppLayout />, children: pages },
  // Full-screen, outside the shell: on phones the design's sign-in covers the tab bar.
  { path: '/login', element: page(Login) },
  { path: '/register', element: page(Register) },
  { path: '/forgot-password', element: page(ForgotPassword) },
  { path: '/reset-password', element: page(ResetPassword) },
])
