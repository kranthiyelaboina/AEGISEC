import path from "node:path"
import { Effect } from "effect"
import z from "zod"
import * as Tool from "./tool"
import DESCRIPTION from "./report.txt"
import { Cyber } from "@/core/cyber"
import { Deliverable } from "@/core/deliverable"
import * as OperationSnapshot from "@/core/operation/snapshot"
import { Instance } from "@/project/instance"

const REPORT_BUILD_TIMEOUT = "20 seconds"

const parameters = z.object({
  action: z.enum(["build", "status"]).default("build"),
  format: z.enum(["md", "json"]).default("md"),
})

type Params = z.infer<typeof parameters>
type Metadata = Record<string, unknown>

function formatCounts(counts?: {
  plan?: number
  observations?: number
  observations_projected?: number
  evidence?: number
  cyber_findings?: number
  plan_nodes_projected?: number
  knowledge_queries?: number
  identities?: number
  active_identities?: number
  tool_adapters_present?: number
  tool_adapters_missing?: number
  capsules?: number
  recommended_capsules?: number
  ready_capsules?: number
  degraded_capsules?: number
  unavailable_capsules?: number
  executed_capsules?: number
  ready_verticals?: number
  degraded_verticals?: number
  unavailable_verticals?: number
  reportable_findings?: number
  suspected_findings?: number
  rejected_findings?: number
  verified_findings?: number
  evidence_backed_findings?: number
  replay_backed_findings?: number
  replay_exempt_findings?: number
  relations_projected?: number
  workflows?: number
  completed_steps?: number
  ledger_events?: number
  context_artifacts?: number
  scope_policy_facts?: number
  operation_state_facts?: number
  autonomy_policy_facts?: number
}) {
  if (!counts) return undefined
  return [
    `plan=${counts.plan ?? 0}`,
    `observations=${counts.observations ?? 0}`,
    `observations_projected=${counts.observations_projected ?? 0}`,
    `evidence=${counts.evidence ?? 0}`,
    `cyber_findings=${counts.cyber_findings ?? 0}`,
    `plan_nodes_projected=${counts.plan_nodes_projected ?? 0}`,
    `knowledge_queries=${counts.knowledge_queries ?? 0}`,
    `identities=${counts.identities ?? 0}`,
    `active_identities=${counts.active_identities ?? 0}`,
    `tool_adapters_present=${counts.tool_adapters_present ?? 0}`,
    `tool_adapters_missing=${counts.tool_adapters_missing ?? 0}`,
    `capsules=${counts.capsules ?? 0}`,
    `recommended_capsules=${counts.recommended_capsules ?? 0}`,
    `ready_capsules=${counts.ready_capsules ?? 0}`,
    `degraded_capsules=${counts.degraded_capsules ?? 0}`,
    `unavailable_capsules=${counts.unavailable_capsules ?? 0}`,
    `executed_capsules=${counts.executed_capsules ?? 0}`,
    `ready_verticals=${counts.ready_verticals ?? 0}`,
    `degraded_verticals=${counts.degraded_verticals ?? 0}`,
    `unavailable_verticals=${counts.unavailable_verticals ?? 0}`,
    `reportable_findings=${counts.reportable_findings ?? 0}`,
    `suspected_findings=${counts.suspected_findings ?? 0}`,
    `rejected_findings=${counts.rejected_findings ?? 0}`,
    `verified_findings=${counts.verified_findings ?? 0}`,
    `evidence_backed_findings=${counts.evidence_backed_findings ?? 0}`,
    `replay_backed_findings=${counts.replay_backed_findings ?? 0}`,
    `replay_exempt_findings=${counts.replay_exempt_findings ?? 0}`,
    `relations_projected=${counts.relations_projected ?? 0}`,
    `workflows=${counts.workflows ?? 0}`,
    `completed_steps=${counts.completed_steps ?? 0}`,
    `ledger_events=${counts.ledger_events ?? 0}`,
    `context_artifacts=${counts.context_artifacts ?? 0}`,
    `scope_policy_facts=${counts.scope_policy_facts ?? 0}`,
    `operation_state_facts=${counts.operation_state_facts ?? 0}`,
    `autonomy_policy_facts=${counts.autonomy_policy_facts ?? 0}`,
  ].join(" ")
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export const ReportTool = Tool.define<typeof parameters, Metadata, never>(
  "report",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const workspace = Instance.directory
          const slug = yield* Tool.resolveOperationSlug(ctx, workspace)
          if (!slug) {
            return {
              title: "report · no active operation",
              output: "No active operation.",
              metadata: { action: params.action, active: false, side_effects: Tool.sideEffects("read_only") },
            }
          }

          if (params.action === "status") {
            const snapshot = yield* Effect.promise(() => OperationSnapshot.build(workspace, { slug, includeDoctor: false }))
            const latest = snapshot.deliverables.latest
            if (!latest) {
              return {
                title: "report · none",
                output: [
                  "No report bundle generated yet.",
                  `Snapshot: ${snapshot.generated_at}`,
                  `Counts: findings=${snapshot.counts.findings} reportable=${snapshot.counts.reportable_findings} evidence=${snapshot.counts.evidence} relations=${snapshot.counts.relations}`,
                  ...(snapshot.warnings.length ? ["Warnings:", ...snapshot.warnings.map((item) => `- ${item}`)] : []),
                ].join("\n"),
                metadata: {
                  action: "status",
                  slug,
                  available: false,
                  counts: snapshot.counts,
                  warnings: snapshot.warnings,
                  source_latest: snapshot.source_latest,
                  source_semantic_latest: snapshot.source_semantic_latest,
                  source_audit_latest: snapshot.source_audit_latest,
                  audit_after_context: snapshot.audit_after_context,
                  stale_context: snapshot.stale_context,
                  stale_capability_readiness: snapshot.stale_capability_readiness,
                  side_effects: Tool.sideEffects("read_only"),
                },
              }
            }
            return {
              title: `report · ${path.basename(latest.bundle_dir ?? latest.report_path ?? latest.key)}`,
              output: [
                `Bundle: ${latest.bundle_dir ?? "-"}`,
                `Manifest: ${latest.manifest_path ?? "-"}`,
                `Report: ${latest.report_path ?? "-"}`,
                `Snapshot: ${snapshot.generated_at}`,
                `Counts: findings=${snapshot.counts.findings} reportable=${snapshot.counts.reportable_findings} evidence=${snapshot.counts.evidence} relations=${snapshot.counts.relations}`,
                ...(snapshot.warnings.length ? ["Warnings:", ...snapshot.warnings.map((item) => `- ${item}`)] : []),
              ]
                .filter(Boolean)
                .join("\n"),
              metadata: {
                action: "status",
                slug,
                available: true,
                bundle_dir: latest.bundle_dir,
                report_path: latest.report_path,
                manifest_path: latest.manifest_path,
                counts: snapshot.counts,
                warnings: snapshot.warnings,
                source_latest: snapshot.source_latest,
                source_semantic_latest: snapshot.source_semantic_latest,
                source_audit_latest: snapshot.source_audit_latest,
                audit_after_context: snapshot.audit_after_context,
                stale_context: snapshot.stale_context,
                stale_capability_readiness: snapshot.stale_capability_readiness,
                source: "snapshot",
                side_effects: Tool.sideEffects("read_only"),
              },
            }
          }

          let currentPhase: Deliverable.BuildPhase | "starting" = "starting"
          yield* ctx.metadata({
            title: "report · building",
            metadata: { action: "build", slug, phase: currentPhase, side_effects: Tool.sideEffects("writes_ledger", "writes_facts", "mutates_workspace") },
          }).pipe(Effect.catch(() => Effect.void))
          const build = yield* Effect.tryPromise({
            try: () =>
              Deliverable.build(workspace, slug, {
                format: params.format,
                onPhase: (phase) => {
                  currentPhase = phase
                },
              }),
            catch: (error) => error,
          }).pipe(
            Effect.timeoutOrElse({
              duration: REPORT_BUILD_TIMEOUT,
              orElse: () =>
                Effect.fail(new Error(`report build timed out during ${currentPhase}`)),
            }),
            Effect.map((built) => ({ _tag: "built" as const, built })),
            Effect.catch((error) => Effect.succeed({ _tag: "failed" as const, error })),
          )
          if (build._tag === "failed") {
            const message = errorMessage(build.error)
            yield* Cyber.appendLedger({
              operation_slug: slug,
              kind: "tool.error",
              source: "report",
              session_id: ctx.sessionID,
              message_id: ctx.messageID,
              status: "error",
              summary: `report build failed during ${currentPhase}`,
              data: {
                action: "build",
                format: params.format,
                phase: currentPhase,
                error: message,
              },
            }).pipe(Effect.catch(() => Effect.succeed("")))
            return {
              title: "report · failed",
              output: `Report build failed during ${currentPhase}: ${message}`,
              metadata: {
                action: "build",
                slug,
                phase: currentPhase,
                available: false,
                error: message,
                side_effects: Tool.sideEffects("writes_ledger", "mutates_workspace"),
              },
            }
          }
          const built = build.built
          const eventID = yield* Cyber.appendLedger({
            operation_slug: slug,
            kind: "fact.verified",
            source: "report",
            session_id: ctx.sessionID,
            message_id: ctx.messageID,
            status: "completed",
            summary: `built report bundle ${path.basename(built.bundleDir)}`,
            data: {
              action: "build",
              format: params.format,
              bundle_dir: built.bundleDir,
              report_path: built.reportPath,
              manifest_path: built.manifestPath,
              counts: built.manifest.counts,
            },
          }).pipe(Effect.catch(() => Effect.succeed("")))
          const deliverableKey = path.basename(built.bundleDir)
          yield* Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "deliverable",
            entity_key: deliverableKey,
            fact_name: "report_bundle",
            value_json: {
              bundle_dir: built.bundleDir,
              report_path: built.reportPath,
              manifest_path: built.manifestPath,
              counts: built.manifest.counts,
              format: params.format,
            },
            writer_kind: "tool",
            status: "verified",
            confidence: 1000,
            source_event_id: eventID || undefined,
          }).pipe(Effect.catch(() => Effect.succeed("")))
          yield* Cyber.upsertRelation({
            operation_slug: slug,
            src_kind: "operation",
            src_key: slug,
            relation: "exports",
            dst_kind: "deliverable",
            dst_key: deliverableKey,
            writer_kind: "tool",
            status: "verified",
            confidence: 1000,
            source_event_id: eventID || undefined,
          }).pipe(Effect.catch(() => Effect.succeed("")))

          return {
            title: `report · ${deliverableKey}`,
            output: [
              `Report bundle: ${built.bundleDir}`,
              `Manifest: ${built.manifestPath}`,
              `Report: ${built.reportPath}`,
              `Counts: ${formatCounts(built.manifest.counts)}`,
            ].join("\n"),
            metadata: {
              action: "build",
              slug,
              phase: currentPhase,
              bundle_dir: built.bundleDir,
              report_path: built.reportPath,
              manifest_path: built.manifestPath,
              counts: built.manifest.counts,
              side_effects: Tool.sideEffects("writes_ledger", "writes_facts", "mutates_workspace"),
            },
          }
        }),
    }
  }),
)
