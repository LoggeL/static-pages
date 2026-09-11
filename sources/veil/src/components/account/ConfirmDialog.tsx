import type { ReactNode } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  tone?: 'danger' | 'primary'
  children?: ReactNode
}

/** Destructive actions in both Account and Library go through this, so the
    confirmation copy and focus behaviour cannot drift between them. */
export function ConfirmDialog({ open, onClose, title, description, confirmLabel, onConfirm, tone = 'danger', children }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={tone}
            data-autofocus
            onClick={() => {
              void onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
