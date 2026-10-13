import { Context } from "effect"
import type { InstanceContext } from "@/project/instance"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~aegisec/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<string | undefined>("~aegisec/WorkspaceRef", {
  defaultValue: () => undefined,
})
