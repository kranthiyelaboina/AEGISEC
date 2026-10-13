import { eq } from "@/storage"
import { Database } from "@/storage"
import { SessionTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"
import * as Operation from "./operation"

export type OperationResolutionSource = "explicit" | "session" | "session_attachment" | "workspace_default" | "none"

export type OperationResolution = {
  slug?: string
  source: OperationResolutionSource
}

export type ResolveOperationInput = {
  workspace: string
  explicitSlug?: string
  sessionID?: SessionID | string
  allowWorkspaceDefault?: boolean
}

async function existingOperation(workspace: string, slug: string | undefined) {
  if (!slug) return undefined
  const info = await Operation.read(workspace, slug).catch(() => undefined)
  return info ? slug : undefined
}

function sessionOperationSlug(sessionID: string | undefined) {
  if (!sessionID) return undefined
  try {
    return Database.use((db) =>
      db
        .select({ operation_slug: SessionTable.operation_slug })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID as SessionID))
        .get(),
    )?.operation_slug ?? undefined
  } catch {
    return undefined
  }
}

export async function resolveOperation(input: ResolveOperationInput): Promise<OperationResolution> {
  const explicit = await existingOperation(input.workspace, input.explicitSlug)
  if (explicit) return { slug: explicit, source: "explicit" }

  const fromSession = await existingOperation(input.workspace, sessionOperationSlug(input.sessionID))
  if (fromSession) return { slug: fromSession, source: "session" }

  const fromAttachment = await existingOperation(
    input.workspace,
    input.sessionID ? await Operation.findSessionOperation(input.workspace, String(input.sessionID)).catch(() => undefined) : undefined,
  )
  if (fromAttachment) return { slug: fromAttachment, source: "session_attachment" }

  if (input.allowWorkspaceDefault !== false) {
    const fallback = await existingOperation(input.workspace, await Operation.activeSlug(input.workspace).catch(() => undefined))
    if (fallback) return { slug: fallback, source: "workspace_default" }
  }

  return { source: "none" }
}
