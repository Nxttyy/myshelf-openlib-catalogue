import { createContext, useContext } from 'react'

export type ToastKind = 'ok' | 'err'
export type Push = (msg: string, kind?: ToastKind) => void

export const ToastContext = createContext<Push>(() => {})

/** `const toast = useToast(); toast('Saved', 'ok')` */
export const useToast = () => useContext(ToastContext)
