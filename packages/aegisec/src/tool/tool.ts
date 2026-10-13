import z from "zod"
import { Effect, Exit } from "effect"
import type { MessageV2 } from "../session/message-v2"
import type { Permission } from "../permission"
import type { SessionID, MessageID } from "../session/schema"
import * as Truncate from "./truncate"
import { Agent } from "@/agent/agent"
import { Cyber } from "@/core/cyber"
import { Operation } from "@/core/operation"
import * as OperationResolver from "@/core/operation/resolver"
import * as OperationSnapshot from "@/core/operation/snapshot"
import { Instance } from "@/project/instance"

interface Metadata {
  [key: string]: any
}

export const SIDE_EFFECT_CATEGORIES = [
  "read_only",
  "writes_ledger",
  "writes_facts",
  "writes_evidence",
  "network",
  "mutates_target",
  "mutates_workspace",
] as const

export type SideEffectCategory = (typeof SIDE_EFFECT_CATEGORIES)[number]

// TODO: remove this hack
export type DynamicDescription = (agent: Agent.Info) => Effect.Effect<string>

export type Context<M extends Metadata = Metadata> = {
  sessionID: SessionID
  messageID: MessageID
  agent: string
  abort: AbortSignal
  callID?: string
  operation?: OperationResolver.OperationResolution
  extra?: { [key: string]: any }
  messages: MessageV2.WithParts[]
  metadata(input: { title?: string; metadata?: M }): Effect.Effect<void>
  ask(input: Omit<Permission.Request, "id" | "sessionID" | "tool">): Effect.Effect<void>
}

export interface ExecuteResult<M extends Metadata = Metadata> {
  title: string
  metadata: M
  output: string
  attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
}

export interface Def<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  description: string
  parameters: Parameters
  execute(args: z.infer<Parameters>, ctx: Context): Effect.Effect<ExecuteResult<M>>
  formatValidationError?(error: z.ZodError): string
}
export type DefWithoutID<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> = Omit<
  Def<Parameters, M>,
  "id"
>

export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  init: () => Effect.Effect<DefWithoutID<Parameters, M>>
}

type Init<Parameters extends z.ZodType, M extends Metadata> =
  | DefWithoutID<Parameters, M>
  | (() => Effect.Effect<DefWithoutID<Parameters, M>>)

export type InferParameters<T> =
  T extends Info<infer P, any> ? z.infer<P> : T extends Effect.Effect<Info<infer P, any>, any, any> ? z.infer<P> : never
export type InferMetadata<T> =
  T extends Info<any, infer M> ? M : T extends Effect.Effect<Info<any, infer M>, any, any> ? M : never

export type InferDef<T> =
  T extends Info<infer P, infer M>
    ? Def<P, M>
    : T extends Effect.Effect<Info<infer P, infer M>, any, any>
      ? Def<P, M>
      : never

export function sideEffects(...categories: SideEffectCategory[]) {
  return categories
}

export function resolveOperationSlug(ctx: Context, workspace: string, explicitSlug?: string) {
  if (explicitSlug) return Effect.succeed(explicitSlug)
  if (ctx.operation?.slug) return Effect.succeed(ctx.operation.slug)
  return Effect.promise(() =>
    OperationResolver.resolveOperation({
      workspace,
      sessionID: ctx.sessionID,
      allowWorkspaceDefault: true,
    }).then((operation) => operation.slug),
  )
}

function normalizedSideEffects(metadata: Metadata) {
  const effects = Array.isArray(metadata.side_effects) ? metadata.side_effects.map(String) : []
  return effects
}

function sideEffectContract<M extends Metadata>(
  metadata: M,
  input: {
    auditLogged: boolean
    contextWritten: boolean
    workflowProgressWritten: boolean
  },
) {
  const effects = normalizedSideEffects(metadata)
  const domainWrites = effects.filter((effect) => !["read_only", "network", "writes_ledger"].includes(effect))
  return {
    ...metadata,
    side_effects: effects,
    audit_logged: input.auditLogged,
    domain_writes: domainWrites,
    context_written: input.contextWritten,
    evidence_written: effects.includes("writes_evidence"),
    facts_written: effects.includes("writes_facts"),
    workflow_progress_written: input.workflowProgressWritten,
  } as M
}

function isReadOnlyResult(metadata: Metadata) {
  const effects = normalizedSideEffects(metadata)
  return (
    effects.includes("read_only") &&
    !effects.some((item) =>
      ["writes_facts", "writes_evidence", "mutates_target", "mutates_workspace"].includes(item),
    )
  )
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map(asRecord)
  if (!items.every((item): item is Record<string, unknown> => Boolean(item))) return undefined
  return items
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return "unknown error"
  }
}

function isOrientationToolCall(id: string, args: unknown) {
  const parsed = z.record(z.string(), z.unknown()).safeParse(args)
  const action = parsed.success && typeof parsed.data["action"] === "string" ? parsed.data["action"] : undefined
  if (id === "workspace") {
    return ["status", "list", "snapshot", "capabilities", "query", "graph_digest", "timeline"].includes(action ?? "status")
  }
  if (id === "report") return (action ?? "status") === "status"
  if (id === "share") return (action ?? "status") === "status"
  if (id === "evidence") return ["list", "search", "get"].includes(action ?? "list")
  if (id === "runbook") return (action ?? "list") === "list"
  return false
}

function explicitOperationSlug(args: unknown) {
  const parsed = z.record(z.string(), z.unknown()).safeParse(args)
  if (!parsed.success) return undefined
  return typeof parsed.data["slug"] === "string" ? parsed.data["slug"] : undefined
}

function refreshDerivedContext(workspace: string, slug?: string) {
  return Effect.gen(function* () {
    const active = yield* Effect.promise(() =>
      slug ? Operation.read(workspace, slug).catch(() => undefined) : Operation.active(workspace).catch(() => undefined),
    )
    if (!active) return false
    const snapshot = yield* Effect.promise(() =>
      OperationSnapshot.build(workspace, { slug: active.slug, includeDoctor: false }).catch(() => undefined),
    )
    if (!snapshot) return false
    const derived = OperationSnapshot.renderContext(snapshot, { mode: "write_context" })
    return yield* Effect.promise(() => Operation.writeContextPack(workspace, active.slug, derived).then(() => true)).pipe(
      Effect.catch(() => Effect.succeed(false)),
    )
  })
}

function currentInstance() {
  try {
    return Instance.current
  } catch {
    return undefined
  }
}

function wrap<Parameters extends z.ZodType, Result extends Metadata>(
  id: string,
  init: Init<Parameters, Result>,
  truncate: Truncate.Interface,
  agents: Agent.Interface,
) {
  const workflowAware = id !== "play"
  return () =>
    Effect.gen(function* () {
      const toolInfo = typeof init === "function" ? { ...(yield* init()) } : { ...init }
      const execute = toolInfo.execute
      toolInfo.execute = (args, ctx) => {
        const attrs = {
          "tool.name": id,
          "session.id": ctx.sessionID,
          "message.id": ctx.messageID,
          ...(ctx.callID ? { "tool.call_id": ctx.callID } : {}),
        }
        return Effect.gen(function* () {
          const instance = currentInstance()
          const operation: OperationResolver.OperationResolution = instance
            ? yield* Effect.promise(() =>
                OperationResolver.resolveOperation({
                  workspace: instance.directory,
                  sessionID: ctx.sessionID,
                  explicitSlug: explicitOperationSlug(args),
                }),
              ).pipe(Effect.catch(() => Effect.succeed({ source: "none" as const })))
            : { source: "none" as const }
          const toolCtx = { ...ctx, operation }
          yield* Effect.try({
            try: () => toolInfo.parameters.parse(args),
            catch: (error) => {
              if (error instanceof z.ZodError && toolInfo.formatValidationError) {
                return new Error(toolInfo.formatValidationError(error), { cause: error })
              }
              return new Error(
                `The ${id} tool was called with invalid arguments: ${formatUnknownError(error)}.\nPlease rewrite the input so it satisfies the expected schema.`,
                { cause: error },
              )
            },
          })
          const callEvent = yield* Cyber.appendLedger({
              operation_slug: operation.slug,
              kind: "tool.called",
              source: id,
              session_id: ctx.sessionID,
              message_id: ctx.messageID,
              summary: `${id} called`,
              data: {
                tool: id,
                call_id: ctx.callID,
                input: args,
              },
            })
            .pipe(Effect.catch(() => Effect.succeed("")))
          const exit = yield* Effect.exit(execute(args, toolCtx))
          if (Exit.isFailure(exit)) {
            yield* Cyber.appendLedger({
                operation_slug: operation.slug,
                kind: "tool.error",
                source: id,
                session_id: ctx.sessionID,
                message_id: ctx.messageID,
                status: "error",
                summary: `${id} failed`,
                data: {
                  tool: id,
                  call_id: ctx.callID,
                  source_event_id: callEvent,
                },
              })
              .pipe(Effect.catch(() => Effect.void))
	            if (workflowAware && instance && !isOrientationToolCall(id, args)) {
	              const workspace = instance.directory
	              const slug = operation.slug
              if (slug) {
                const match = yield* Effect.promise(() =>
                  Operation.recordWorkflowStep(workspace, slug, {
                    tool: id,
                    success: false,
                    error: "tool execution failed",
                    args,
                  }).catch(() => undefined),
                ).pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (match) {
                  const workflow = yield* Effect.promise(() =>
                    Operation.readWorkflow(workspace, slug, {
                      kind: match.kind,
                      id: match.id,
                    }).catch(() => undefined),
                  ).pipe(Effect.catch(() => Effect.succeed(undefined)))
                  const workflowRecord = asRecord(workflow)
                  const trace = asRecordArray(workflowRecord?.trace)
                  const skipped = asRecordArray(workflowRecord?.skipped)
                  if (workflowRecord && trace && skipped) {
                    yield* Cyber.syncWorkflowProgress({
                      operation_slug: slug,
                      workflow_kind: match.kind,
                      workflow_id: match.id,
                      trace,
                      skipped,
                      completed_steps: Number(workflowRecord.completed_steps ?? 0),
                      failed_steps: Number(workflowRecord.failed_steps ?? 0),
                      pending_steps: Number(workflowRecord.pending_steps ?? 0),
                      session_id: ctx.sessionID,
                      message_id: ctx.messageID,
                      source: "workflow",
                      summary: `${match.kind} ${match.id} progress after ${id} failure`,
                    }).pipe(Effect.catch(() => Effect.succeed("")))
                  }
                  yield* Cyber.appendLedger({
                    operation_slug: slug,
                    kind: "fact.observed",
                    source: "workflow",
                    session_id: ctx.sessionID,
                    message_id: ctx.messageID,
                    summary: `${match.kind} ${match.id} step ${match.step_index} failed via ${id}`,
                    data: {
                      workflow_kind: match.kind,
                      workflow_id: match.id,
                      step_index: match.step_index,
                      status: match.status,
                      tool: id,
                    },
	                  }).pipe(Effect.catch(() => Effect.succeed("")))
	                }
	                if (id !== "report") {
	                  yield* refreshDerivedContext(workspace, slug).pipe(Effect.catch(() => Effect.void))
	                }
	              }
	            }
	            return yield* Effect.failCause(exit.cause)
          }
          const result = exit.value
          const readOnlyResult = isReadOnlyResult(result.metadata)
          const workflowProgressEligible = workflowAware && !isOrientationToolCall(id, args)
          let workflowProgressWritten = false
          let contextWritten = false
          yield* Cyber.appendLedger({
              operation_slug: operation.slug,
              kind: "tool.completed",
              source: id,
              session_id: ctx.sessionID,
              message_id: ctx.messageID,
              status: "completed",
              summary: `${id} completed`,
              data: {
                tool: id,
                call_id: ctx.callID,
                source_event_id: callEvent,
                title: result.title,
                metadata: { ...result.metadata, operation },
              },
            })
            .pipe(Effect.catch(() => Effect.succeed("")))
	          if (workflowProgressEligible && instance) {
	            const workspace = instance.directory
	            const slug = operation.slug
            if (slug) {
              const match = yield* Effect.promise(() =>
                Operation.recordWorkflowStep(workspace, slug, {
                  tool: id,
                  success: true,
                  title: result.title,
                  args,
                }).catch(() => undefined),
              ).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (match) {
                const workflow = yield* Effect.promise(() =>
                  Operation.readWorkflow(workspace, slug, {
                    kind: match.kind,
                    id: match.id,
                  }).catch(() => undefined),
                ).pipe(Effect.catch(() => Effect.succeed(undefined)))
                const workflowRecord = asRecord(workflow)
                const trace = asRecordArray(workflowRecord?.trace)
                const skipped = asRecordArray(workflowRecord?.skipped)
                if (workflowRecord && trace && skipped) {
                  yield* Cyber.syncWorkflowProgress({
                    operation_slug: slug,
                    workflow_kind: match.kind,
                    workflow_id: match.id,
                    trace,
                    skipped,
                    completed_steps: Number(workflowRecord.completed_steps ?? 0),
                    failed_steps: Number(workflowRecord.failed_steps ?? 0),
                    pending_steps: Number(workflowRecord.pending_steps ?? 0),
                    session_id: ctx.sessionID,
                    message_id: ctx.messageID,
                    source: "workflow",
                    summary: `${match.kind} ${match.id} progress after ${id} completion`,
                  }).pipe(Effect.catch(() => Effect.succeed("")))
                }
                yield* Cyber.appendLedger({
                  operation_slug: slug,
                  kind: "fact.observed",
                  source: "workflow",
                  session_id: ctx.sessionID,
                  message_id: ctx.messageID,
                  summary: `${match.kind} ${match.id} step ${match.step_index} completed via ${id}`,
                  data: {
                    workflow_kind: match.kind,
                    workflow_id: match.id,
                    step_index: match.step_index,
                    status: match.status,
                    tool: id,
                  },
	                }).pipe(Effect.catch(() => Effect.succeed("")))
                  workflowProgressWritten = true
	              }
	              if (id !== "report" && (match || !readOnlyResult)) {
	                contextWritten = yield* refreshDerivedContext(workspace, slug).pipe(Effect.catch(() => Effect.succeed(false)))
	              }
	            }
	          }
          const finalResult = {
            ...result,
            metadata: sideEffectContract(result.metadata, {
              auditLogged: Boolean(callEvent),
              contextWritten,
              workflowProgressWritten,
            }),
          }
          const finalMetadata = finalResult.metadata as Record<string, unknown>
          finalMetadata.operation_slug = operation.slug
          finalMetadata.operation_source = operation.source
          if (finalResult.metadata.truncated !== undefined) {
            return finalResult
          }
          const agent = yield* agents.get(ctx.agent)
          const truncated = yield* truncate.output(finalResult.output, {}, agent)
          return {
            ...finalResult,
            output: truncated.content,
            metadata: {
              ...finalResult.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }).pipe(Effect.orDie, Effect.withSpan("Tool.execute", { attributes: attrs }))
      }
      return toolInfo
    })
}

export function define<Parameters extends z.ZodType, Result extends Metadata, R, ID extends string = string>(
  id: ID,
  init: Effect.Effect<Init<Parameters, Result>, never, R>,
): Effect.Effect<Info<Parameters, Result>, never, R | Truncate.Service | Agent.Service> & { id: ID } {
  return Object.assign(
    Effect.gen(function* () {
      const resolved = yield* init
      const truncate = yield* Truncate.Service
      const agents = yield* Agent.Service
      return { id, init: wrap(id, resolved, truncate, agents) }
    }),
    { id },
  )
}

export function init<P extends z.ZodType, M extends Metadata>(info: Info<P, M>): Effect.Effect<Def<P, M>> {
  return Effect.gen(function* () {
    const init = yield* info.init()
    return {
      ...init,
      id: info.id,
    }
  })
}
