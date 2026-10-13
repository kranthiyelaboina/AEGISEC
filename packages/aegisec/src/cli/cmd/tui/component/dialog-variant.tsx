import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { ProviderTransform } from "@/provider"

export function DialogVariant() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()

  const model = createMemo(() => {
    const current = local.model.current()
    if (!current) return undefined
    const provider = sync.data.provider.find((item) => item.id === current.providerID)
    return provider?.models[current.modelID]
  })

  const options = createMemo(() => {
    return [
      {
        value: "default",
        title: "Default",
        description: "Provider default thinking",
        onSelect: () => {
          dialog.clear()
          local.model.variant.set(undefined)
        },
      },
      ...local.model.variant.list().map((variant) => {
        const current = model()
        return {
          value: variant,
          title: variant,
          description: current ? ProviderTransform.variantDescription(current, variant) : undefined,
          onSelect: () => {
            dialog.clear()
            local.model.variant.set(variant)
          },
        }
      }),
    ]
  })

  return (
    <DialogSelect<string>
      options={options()}
      title={"Select thinking level"}
      current={local.model.variant.selected()}
      flat={true}
    />
  )
}
