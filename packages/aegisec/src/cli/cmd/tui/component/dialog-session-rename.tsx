import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal } from "solid-js"
import { useSDK } from "../context/sdk"
import { useToast } from "@tui/ui/toast"

interface DialogSessionRenameProps {
  session: string
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const session = createMemo(() => sync.session.get(props.session))
  const [busy, setBusy] = createSignal(false)

  return (
    <DialogPrompt
      title="Rename Session"
      value={session()?.title}
      busy={busy()}
      busyText="Renaming session..."
      onConfirm={(value) => {
        const trimmed = value.trim()
        const current = session()?.title
        // Nothing changed or empty input — just close instead of making a no-op
        // server call (which used to swallow errors and lose the rename).
        if (busy() || !trimmed || trimmed === current) {
          if (!busy()) dialog.clear()
          return
        }
        setBusy(true)
        void sdk.client.session
          .update({
            sessionID: props.session,
            title: trimmed,
          })
          .then((result) => {
            if (!result.data) {
              toast.show({ message: "Failed to rename session", variant: "error" })
              return
            }
            // Apply the rename to the local sync store immediately so the
            // session list ("/session" → Runs) reflects the new title even
            // if the live `session.updated` event arrives late or is lost.
            // The event-driven handler in `sync.tsx` will reconcile this
            // with the authoritative server state when it does arrive.
            const updated = result.data
            sync.session.set(updated.id, updated)
            dialog.clear()
          })
          .catch(() => {
            toast.show({ message: "Failed to rename session", variant: "error" })
          })
          .finally(() => setBusy(false))
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
