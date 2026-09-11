import { create } from 'zustand'
import { uid, type ToastTone } from '@/lib/types'

export interface Toast {
  id: string
  title: string
  description?: string
  tone: ToastTone
}

interface ToastState {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>) => string
  dismiss: (id: string) => void
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = uid()
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    return id
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
