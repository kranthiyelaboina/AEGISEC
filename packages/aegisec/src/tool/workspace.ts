import z from "zod"
import { Effect, Exit } from "effect"
import * as Tool from "./tool"
import { inferMode } from "./autonomy"
import { Operation, KINDS } from "@/core/operation"
import { Cyber } from "@/core/cyber"
import * as OperationSnapshot from "@/core/operation/snapshot"
import { activeIdentity } from "@/core/vault"
import { Instance } from "@/project/instance"
import { Session } from "@/session"

const workspaceQueries = ["routes", "route", "findings_by_route", "evidence_by_finding", "components", "open_observations", "workflow", "next_workflow_step"] as const

const parameters = z.object({
  action: z.enum(["status", "list", "start", "rename", "graph_digest", "timeline", "snapshot", "capabilities", "query"]).default("status"),
  label: z.string().optional().describe("Required when action = start or rename"),
  slug: z.string().optional().describe("Optional operation slug for rename, snapshot, capabilities, or query; defaults to active operation"),
  kind: z.enum(KINDS).optional().describe("Required when action = start"),
  target: z.string().optional().describe("Optional target when action = start"),
  query: z.enum(workspaceQueries).optional().describe("Required when action = query"),
  key: z.string().optional().describe("Route, finding, or component key for query actions that need one"),
  limit: z.coerce.number().int().min(1).max(100).optional().describe("Maximum rows for action = query"),
})

type Params = z.infer<typeof parameters>
type Metadata = Record<string, unknown>

export const WorkspaceTool = Tool.define<typeof parameters, Metadata, Session.Service>(
  "workspace",
  Effect.gen(function* () {
    const session = yield* Session.Service
    return {
      description:
        "Manage and inspect the active security workspace. At operation start, prefer action=snapshot for agent orientation; use capabilities for domain readiness, query for routes/findings/evidence/components, status for compatibility, and timeline/graph_digest for raw kernel views.",
      parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const workspace = Instance.directory

          if (params.action === "start") {
            if (!params.label || !params.kind) {
              return {
                title: "workspace start",
                output: "Provide both label and kind when action = start.",
                metadata: { action: "start", side_effects: Tool.sideEffects("mutates_workspace") },
              }
            }
            const label = params.label
            const kind = params.kind
            yield* ctx.ask({
              permission: "workspace",
              patterns: [label],
              always: [],
              metadata: { action: "start", kind, target: params.target },
            })
            const info = yield* Effect.promise(() =>
              Operation.create({
                workspace,
                label,
                kind,
                target: params.target,
              }),
            )
            const boundary =
              (yield* Effect.promise(() => Operation.readBoundary(workspace, info.slug).catch(() => undefined))) ?? {
                default: "allow" as const,
                in_scope: [],
                out_of_scope: [],
              }
            yield* Cyber.upsertOperationState({
              slug: info.slug,
              label: info.label,
              kind: info.kind,
              target: info.target,
              opsec: info.opsec,
              in_scope: boundary.in_scope,
              out_of_scope: boundary.out_of_scope,
              session_id: ctx.sessionID,
              message_id: ctx.messageID,
              source: "workspace",
              summary: `started operation ${info.slug}`,
            }).pipe(Effect.catch(() => Effect.succeed("")))
            yield* Cyber.upsertScopePolicy({
              operation_slug: info.slug,
              default: boundary.default === "allow" ? "allow" : "ask",
              in_scope: boundary.in_scope,
              out_of_scope: boundary.out_of_scope,
              opsec: info.opsec,
              session_id: ctx.sessionID,
              message_id: ctx.messageID,
              source: "workspace",
              summary: `scope policy ${info.slug}`,
            }).pipe(Effect.catch(() => Effect.succeed("")))
            yield* Effect.exit(session.attachOperation({ sessionID: ctx.sessionID, operationSlug: info.slug }))
            return {
              title: `workspace · ${info.slug}`,
              output: `Started operation ${info.label} (${info.slug}) of kind ${info.kind}.`,
              metadata: { action: "start", slug: info.slug, side_effects: Tool.sideEffects("mutates_workspace", "writes_ledger", "writes_facts") },
            }
          }

          if (params.action === "rename") {
            const label = params.label?.trim()
            if (!label) {
              return {
                title: "workspace rename",
                output: "Provide label when action = rename.",
                metadata: { action: "rename", side_effects: Tool.sideEffects("mutates_workspace") },
              }
            }
            const slug = yield* Tool.resolveOperationSlug(ctx, workspace, params.slug)
            if (!slug) {
              return {
                title: "workspace rename",
                output: "No active operation. Provide slug when action = rename.",
                metadata: { action: "rename", active: false, side_effects: Tool.sideEffects("mutates_workspace") },
              }
            }
            yield* ctx.ask({
              permission: "workspace",
              patterns: [`rename:${slug}`],
              always: [],
              metadata: { action: "rename", slug, label },
            })
            const renamed = yield* Effect.promise(() => Operation.rename(workspace, slug, label))
            return {
              title: `workspace · ${renamed.slug}`,
              output: `Renamed operation ${renamed.slug} to ${renamed.label}.`,
              metadata: { action: "rename", slug: renamed.slug, label: renamed.label, side_effects: Tool.sideEffects("mutates_workspace", "writes_ledger", "writes_facts") },
            }
          }

          if (params.action === "list") {
            const ops = yield* Effect.promise(() => Operation.list(workspace))
            const active = yield* Effect.promise(() => Operation.activeSlug(workspace).catch(() => undefined))
            const output =
              ops.length === 0
                ? "No operations."
                : ops
                    .map((op) => `${op.slug === active ? "*" : "-"} ${op.slug} · ${op.kind} · ${op.label}`)
                    .join("\n")
            return {
              title: "workspace · operations",
              output,
              metadata: { action: "list", count: ops.length, side_effects: Tool.sideEffects("read_only") },
            }
          }

          if (params.action === "snapshot") {
            const slug = yield* Tool.resolveOperationSlug(ctx, workspace, params.slug)
            const snapshot = yield* Effect.promise(() => OperationSnapshot.build(workspace, { slug, includeDoctor: false }))
            return {
              title: snapshot.operation ? `workspace · snapshot · ${snapshot.operation.slug}` : "workspace · snapshot",
              output: OperationSnapshot.renderSnapshot(snapshot),
              metadata: {
                action: "snapshot",
                active: Boolean(snapshot.operation),
                slug: snapshot.operation?.slug,
                warnings: snapshot.warnings,
                context_file_stale: snapshot.context_file_stale,
                stale_context: snapshot.stale_context,
                stale_capability_readiness: snapshot.stale_capability_readiness,
                source_latest: snapshot.source_latest,
                source_semantic_latest: snapshot.source_semantic_latest,
                source_audit_latest: snapshot.source_audit_latest,
                source_ledger_latest: snapshot.source_ledger_latest,
                source_fact_latest: snapshot.source_fact_latest,
                source_evidence_latest: snapshot.source_evidence_latest,
                source_context_mtime: snapshot.source_context_mtime,
                capability_source_latest: snapshot.capability_source_latest,
                audit_after_context: snapshot.audit_after_context,
                projection_lag_ms: snapshot.projection_lag_ms,
                counts: snapshot.counts,
                facts: snapshot.counts.facts,
                relations: snapshot.counts.relations,
                ledger: snapshot.counts.ledger,
                routes: snapshot.counts.routes,
                route_facts: snapshot.counts.route_facts,
                evidence: snapshot.counts.evidence,
                observations: snapshot.counts.observations,
                open_observations: snapshot.counts.open_observations,
                reportable_findings: snapshot.counts.reportable_findings,
                suspected_findings: snapshot.counts.suspected_findings,
                rejected_findings: snapshot.counts.rejected_findings,
                deliverables: snapshot.counts.deliverables,
                share_bundles: snapshot.counts.share_bundles,
                side_effects: Tool.sideEffects("read_only"),
              },
            }
          }

          if (params.action === "capabilities") {
            const slug = yield* Tool.resolveOperationSlug(ctx, workspace, params.slug)
            const snapshot = yield* Effect.promise(() => OperationSnapshot.build(workspace, { slug, includeDoctor: false }))
            return {
              title: "workspace · capabilities",
              output: OperationSnapshot.renderCapabilities(snapshot),
              metadata: {
                action: "capabilities",
                active: Boolean(snapshot.operation),
                slug: snapshot.operation?.slug,
                tools_present: snapshot.capabilities.tools_present,
                tools_total: snapshot.capabilities.tools_total,
                missing_binaries: snapshot.capabilities.missing_binaries,
                browser_present: snapshot.capabilities.browser_present,
                stale_capability_readiness: snapshot.stale_capability_readiness,
                capability_source_latest: snapshot.capability_source_latest,
                domains: snapshot.capabilities.domains,
                side_effects: Tool.sideEffects("read_only"),
              },
            }
          }

          if (params.action === "query") {
            if (!params.query) {
              return {
                title: "workspace · query",
                output: `Provide query when action = query. Valid queries: ${workspaceQueries.join(", ")}.`,
                metadata: { action: "query", side_effects: Tool.sideEffects("read_only") },
              }
            }
            if (["route", "findings_by_route", "evidence_by_finding"].includes(params.query) && !params.key) {
              return {
                title: `workspace · query · ${params.query}`,
                output: `Provide key for query=${params.query}.`,
                metadata: { action: "query", query: params.query, side_effects: Tool.sideEffects("read_only") },
              }
            }
            const slug = yield* Tool.resolveOperationSlug(ctx, workspace, params.slug)
            const snapshot = yield* Effect.promise(() =>
              OperationSnapshot.build(workspace, {
                slug,
                includeDoctor: false,
                maxFindings: 10_000,
                maxObservations: 10_000,
                maxEvidence: 10_000,
                maxRoutes: 10_000,
                maxComponents: 10_000,
              }),
            )
            const result = OperationSnapshot.query(snapshot, { query: params.query, key: params.key, limit: params.limit })
            return {
              title: `workspace · query · ${params.query}`,
              output: JSON.stringify(
                {
                  query: params.query,
                  key: params.key,
                  count: result.count,
                  rows: result.rows,
                },
                null,
                2,
              ),
              metadata: {
                action: "query",
                query: params.query,
                key: params.key,
                count: result.count,
                source_semantic_latest: snapshot.source_semantic_latest,
                source_audit_latest: snapshot.source_audit_latest,
                audit_after_context: snapshot.audit_after_context,
                side_effects: Tool.sideEffects("read_only"),
              },
            }
          }

          if (params.action === "graph_digest") {
            const sessionExit = yield* Effect.exit(session.get(ctx.sessionID))
            const sessionInfo = Exit.isFailure(sessionExit) ? undefined : sessionExit.value
            const autonomyMode = inferMode(sessionInfo?.permission)
            const identity = yield* Effect.promise(() => activeIdentity().catch(() => undefined)).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
            const slug = yield* Tool.resolveOperationSlug(ctx, workspace, params.slug)
            const [output, facts, relations] = yield* Effect.all([
              Cyber.contextPack({ operation_slug: slug }),
              Cyber.listFacts({ operation_slug: slug, limit: 100 }).pipe(Effect.catch(() => Effect.succeed([]))),
              Cyber.listRelations({ operation_slug: slug, limit: 100 }).pipe(Effect.catch(() => Effect.succeed([]))),
            ])
            const summary = Cyber.summarizeFacts(facts)
            return {
              title: "workspace · graph digest",
              output: output ?? "No active operation or no cyber context yet.",
              metadata: {
                action: "graph_digest",
                facts: facts.length,
                relations: relations.length,
                ...summary,
                autonomy_mode: autonomyMode,
                active_identity: identity?.key,
                side_effects: Tool.sideEffects("read_only"),
              },
            }
          }

          if (params.action === "timeline") {
            const slug = yield* Tool.resolveOperationSlug(ctx, workspace, params.slug)
            const events = yield* Cyber.listLedger({ operation_slug: slug, limit: 30 })
            const output =
              events.length === 0
                ? "No cyber ledger events for the active operation."
                : events
                    .slice()
                    .reverse()
                    .map((event) => {
                      const summary = event.summary ?? JSON.stringify(event.data)
                      return `${new Date(event.time_created).toISOString()} · ${event.kind} · ${summary}`
                    })
                    .join("\n")
            return {
              title: "workspace · timeline",
              output,
              metadata: { action: "timeline", count: events.length, side_effects: Tool.sideEffects("read_only") },
            }
          }

          const slug = yield* Tool.resolveOperationSlug(ctx, workspace, params.slug)
          const snapshot = yield* Effect.promise(() => OperationSnapshot.build(workspace, { slug, includeDoctor: false }))
          if (!snapshot.operation) {
            return {
              title: "workspace · no active operation",
              output: "No active operation.",
              metadata: { action: "status", active: false, side_effects: Tool.sideEffects("read_only") },
            }
          }
          const summary = snapshot.projected?.summary
          const workflowSteps = snapshot.active_workflow
            ? snapshot.projected?.workflow_steps
                .filter((item) => item.workflow === `${snapshot.active_workflow?.kind}:${snapshot.active_workflow?.id}`)
                .sort((a, b) => a.index - b.index)
                .slice(0, 12) ?? []
            : []
          const displayWorkflowSteps = workflowSteps.filter(
            (step) => step.outcome !== "pending" || (snapshot.active_workflow?.pending_steps ?? 0) > 0,
          )
          const hiddenPendingWorkflowDefinitions = workflowSteps.length - displayWorkflowSteps.length
          const workflowCount = Math.max(snapshot.projected?.workflows.length ?? 0, snapshot.active_workflow ? 1 : 0)
          const compatibilityLines = [
            `Facts: ${snapshot.counts.facts} · Relations: ${snapshot.counts.relations} · Ledger: ${snapshot.counts.ledger} · Workflows: ${workflowCount}`,
            summary
              ? `Surface entities: hosts=${summary.hosts} services=${summary.services} web_pages=${summary.web_pages} routes=${snapshot.counts.routes} route_facts=${summary.route_facts} identities=${Math.max(summary.identities, snapshot.active_identity ? 1 : 0)} active_identities=${Math.max(summary.active_identities, snapshot.active_identity ? 1 : 0)}`
              : undefined,
            summary ? `Projected observations: ${summary.observations_projected}` : undefined,
            summary ? `Tool adapters: present=${summary.tool_adapters_present} missing=${summary.tool_adapters_missing}` : undefined,
            summary ? `Knowledge queries: ${summary.knowledge_queries}` : undefined,
            summary
              ? `Capsules: ready=${summary.ready_capsules} degraded=${summary.degraded_capsules} unavailable=${summary.unavailable_capsules} recommended=${summary.recommended_capsules} executed=${summary.executed_capsules}`
              : undefined,
            summary ? `Verticals: ready=${summary.ready_verticals} degraded=${summary.degraded_verticals} unavailable=${summary.unavailable_verticals}` : undefined,
            `Workflows: ${workflowCount}`,
            `Autonomy: ${snapshot.autonomy?.mode ?? "custom"}`,
            `Identity: ${snapshot.active_identity?.key ?? "none"}`,
            `Deliverables: ${snapshot.counts.deliverables}`,
            `Share bundles: ${snapshot.counts.share_bundles}`,
            snapshot.deliverables.latest ? `Latest deliverable: ${snapshot.deliverables.latest.report_path ?? snapshot.deliverables.latest.bundle_dir ?? snapshot.deliverables.latest.key}` : undefined,
            snapshot.sharing.latest ? `Latest share bundle: ${snapshot.sharing.latest.path ?? snapshot.sharing.latest.key}` : undefined,
            `Candidate findings: ${snapshot.counts.candidate_findings}`,
            `Reportable: ${snapshot.counts.reportable_findings}`,
            `Suspected: ${snapshot.counts.suspected_findings}`,
            `Rejected: ${snapshot.counts.rejected_findings}`,
            summary ? `Replay-backed: ${summary.replay_backed_findings}` : undefined,
            summary ? `Evidence-backed: ${summary.evidence_backed_findings}` : undefined,
            snapshot.active_workflow
              ? `Progress: done=${snapshot.active_workflow.completed_steps} failed=${snapshot.active_workflow.failed_steps} skipped=${snapshot.active_workflow.skipped} pending=${snapshot.active_workflow.pending_steps}`
              : undefined,
            hiddenPendingWorkflowDefinitions
              ? `Workflow planned pending definitions: ${hiddenPendingWorkflowDefinitions} (not counted as active pending)`
              : undefined,
            displayWorkflowSteps.length ? "Workflow steps:" : undefined,
            ...displayWorkflowSteps.map((step) => {
              const detail = step.outcome_title ?? step.outcome_error
              return `step ${step.index} · ${step.outcome}${step.label ? ` · ${step.label}` : ""}${detail ? ` · ${detail}` : ""}`
            }),
          ].filter(Boolean)
          return {
            title: `workspace · ${snapshot.operation.slug}`,
            output: [OperationSnapshot.renderSnapshot(snapshot), "", ...compatibilityLines].join("\n"),
            metadata: {
              action: "status",
              slug: snapshot.operation.slug,
              kind: snapshot.operation.kind,
              active: true,
              counts: snapshot.counts,
              warnings: snapshot.warnings,
              facts: snapshot.counts.facts,
              relations: snapshot.counts.relations,
              ledger: snapshot.counts.ledger,
              routes: snapshot.counts.routes,
              route_facts: snapshot.counts.route_facts,
              evidence: snapshot.counts.evidence,
              observations: snapshot.counts.observations,
              open_observations: snapshot.counts.open_observations,
              deliverables: snapshot.counts.deliverables,
              share_bundles: snapshot.counts.share_bundles,
              active_workflow: snapshot.active_workflow?.id,
              completed_steps: snapshot.active_workflow?.completed_steps ?? 0,
              failed_steps: snapshot.active_workflow?.failed_steps ?? 0,
              pending_steps: snapshot.active_workflow?.pending_steps ?? 0,
              autonomy_mode: snapshot.autonomy?.mode ?? "custom",
              active_identity: snapshot.active_identity?.key,
              latest_deliverable_path: snapshot.deliverables.latest?.report_path ?? snapshot.deliverables.latest?.bundle_dir,
              latest_share_bundle_path: snapshot.sharing.latest?.path,
              workflows: workflowCount,
              workflow_step_statuses: snapshot.projected?.workflow_steps.length ?? 0,
              ...summary,
              candidate_findings: snapshot.counts.candidate_findings,
              reportable_findings: snapshot.counts.reportable_findings,
              suspected_findings: snapshot.counts.suspected_findings,
              rejected_findings: snapshot.counts.rejected_findings,
              identities: Math.max(summary?.identities ?? 0, snapshot.active_identity ? 1 : 0),
              active_identities: Math.max(summary?.active_identities ?? 0, snapshot.active_identity ? 1 : 0),
              stale_context: snapshot.stale_context,
              stale_capability_readiness: snapshot.stale_capability_readiness,
              source_latest: snapshot.source_latest,
              source_semantic_latest: snapshot.source_semantic_latest,
              source_audit_latest: snapshot.source_audit_latest,
              source_ledger_latest: snapshot.source_ledger_latest,
              source_fact_latest: snapshot.source_fact_latest,
              source_evidence_latest: snapshot.source_evidence_latest,
              source_context_mtime: snapshot.source_context_mtime,
              capability_source_latest: snapshot.capability_source_latest,
              audit_after_context: snapshot.audit_after_context,
              projection_lag_ms: snapshot.projection_lag_ms,
              side_effects: Tool.sideEffects("read_only"),
            },
          }
        }),
    }
  }),
)
