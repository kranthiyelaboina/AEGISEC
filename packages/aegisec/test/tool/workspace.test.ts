import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { AppFileSystem } from "@aegisec/shared/filesystem"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Operation } from "../../src/core/operation"
import { Cyber } from "../../src/core/cyber"
import { Evidence } from "../../src/core/evidence"
import { saveVault } from "../../src/core/vault"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Format } from "../../src/format"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { Truncate } from "../../src/tool"
import { ReportTool } from "../../src/tool/report"
import { WorkspaceTool } from "../../src/tool/workspace"
import * as OperationSnapshot from "../../src/core/operation/snapshot"
import { tmpdir } from "../fixture/fixture"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    AppFileSystem.defaultLayer,
    Format.defaultLayer,
    Bus.layer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    Session.defaultLayer,
  ),
)

const baseCtx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "security",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  extra: {},
  ask: () => Effect.succeed(undefined as any),
} as any

async function exec(params: Record<string, unknown>) {
  return await runtime.runPromise(
    Effect.gen(function* () {
      const info = yield* WorkspaceTool
      const tool = yield* info.init()
      return yield* tool.execute(params as any, baseCtx)
    }) as any,
  )
}

async function buildReport() {
  return await runtime.runPromise(
    Effect.gen(function* () {
      const info = yield* ReportTool
      const tool = yield* info.init()
      return yield* tool.execute({ action: "build", format: "md" } as any, baseCtx)
    }) as any,
  )
}

describe("tool/workspace", () => {
  test("start writes operation state into the cyber kernel immediately", async () => {
    await using fixture = await tmpdir({ git: true })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const result: any = await exec({
          action: "start",
          label: "Immediate State",
          kind: "appsec",
          target: "https://target.test",
        })
        const slug = String(result.metadata.slug)
        const facts = await AppRuntime.runPromise(Cyber.listFacts({ operation_slug: slug, limit: 100 }))
        const relations = await AppRuntime.runPromise(Cyber.listRelations({ operation_slug: slug, limit: 100 }))

        expect(
          facts.some(
            (item) =>
              item.entity_kind === "operation" &&
              item.entity_key === slug &&
              item.fact_name === "operation_state",
          ),
        ).toBe(true)
        expect(
          relations.some(
            (item) =>
              item.src_kind === "operation" &&
              item.src_key === slug &&
              item.relation === "targets" &&
              item.dst_key === "https://target.test",
          ),
        ).toBe(true)
      },
    })
  })

  test("rename updates the active operation label through the workspace tool", async () => {
    await using fixture = await tmpdir({ git: true })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const started: any = await exec({
          action: "start",
          label: "Original Name",
          kind: "pentest",
          target: "https://target.test",
        })
        const slug = String(started.metadata.slug)

        const result: any = await exec({
          action: "rename",
          label: "Renamed Operation",
        })
        const reread = await Operation.read(fixture.path, slug)
        const facts = await AppRuntime.runPromise(Cyber.listFacts({ operation_slug: slug, limit: 100 }))

        expect(result.metadata.action).toBe("rename")
        expect(result.metadata.slug).toBe(slug)
        expect(reread?.label).toBe("Renamed Operation")
        expect(
          facts.some(
            (item) =>
              item.entity_kind === "operation" &&
              item.entity_key === slug &&
              item.fact_name === "operation_state" &&
              (item.value_json as { label?: string }).label === "Renamed Operation",
          ),
        ).toBe(true)
      },
    })
  })

  test("graph_digest exposes relation counts and relation lines", async () => {
    await using fixture = await tmpdir({ git: true })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const op = await Operation.create({ workspace: fixture.path, label: "Digest", kind: "pentest" })
        const eventID = await AppRuntime.runPromise(
          Cyber.appendLedger({
            operation_slug: op.slug,
            kind: "fact.observed",
            source: "test",
            summary: "seed workspace digest",
            data: {},
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertRelation({
            operation_slug: op.slug,
            src_kind: "host",
            src_key: "api.example.test",
            relation: "serves",
            dst_kind: "http_route",
            dst_key: "GET /status",
            writer_kind: "parser",
            status: "observed",
            confidence: 900,
            source_event_id: eventID,
          }),
        )

        const result: any = await exec({ action: "graph_digest" })
        expect(result.metadata.action).toBe("graph_digest")
        expect(result.metadata.relations).toBeGreaterThan(0)
        expect(result.metadata.route_facts).toBe(0)
        expect(result.metadata.candidate_findings).toBe(0)
        expect(result.metadata.autonomy_mode).toBe("custom")
        expect(result.output).toContain("## Relations")
        expect(result.output).toContain("host:api.example.test -serves-> http_route:GET /status")
      },
    })
  })

  test("status reports kernel and workflow counts for the active operation", async () => {
    await using fixture = await tmpdir({ git: true })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const started: any = await exec({
          action: "start",
          label: "Status Counts",
          kind: "pentest",
          target: "https://target.test",
        })
        const slug = String(started.metadata.slug)
        const workflowDir = path.join(fixture.path, ".aegisec", "operation", slug, "workflow")
        await Bun.write(
          path.join(workflowDir, "runbook-web-surface.json"),
          JSON.stringify({ kind: "runbook", id: "web-surface" }, null, 2),
        )
        await Operation.setActiveWorkflow(fixture.path, slug, { kind: "runbook", id: "web-surface" })
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "host",
            entity_key: "target.test",
            fact_name: "last_seen_url",
            value_json: "https://target.test",
            writer_kind: "tool",
            status: "observed",
            confidence: 1000,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "service",
            entity_key: "target.test:443",
            fact_name: "transport",
            value_json: "https",
            writer_kind: "tool",
            status: "observed",
            confidence: 1000,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "web_page",
            entity_key: "https://target.test/page",
            fact_name: "fetch_result",
            value_json: {
              url: "https://target.test/page",
              host: "target.test",
              preview: "hello",
            },
            writer_kind: "tool",
            status: "observed",
            confidence: 900,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "finding",
            entity_key: "target.test:authz",
            fact_name: "record",
            value_json: {
              title: "Confirmed authz issue",
              summary: "reproducible by replay",
              replay_present: true,
              oracle_status: "passed",
            },
            writer_kind: "operator",
            status: "verified",
            confidence: 1000,
            evidence_refs: ["sha256:evidence-authz"],
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "runbook",
            entity_key: "web-surface",
            fact_name: "capsule_readiness",
            value_json: {
              name: "Web Surface",
              status: "ready",
              missing_required: [],
              missing_optional: [],
            },
            writer_kind: "tool",
            status: "observed",
            confidence: 1000,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "runbook",
            entity_key: "api-surface",
            fact_name: "capsule_recommendation",
            value_json: {
              name: "API Surface",
              operation_kind: "pentest",
              status: "degraded",
            },
            writer_kind: "tool",
            status: "observed",
            confidence: 1000,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "knowledge_query",
            entity_key: "cve:openssl",
            fact_name: "cve_result",
            value_json: {
              query: "openssl",
              returned: 2,
              severity: "high",
            },
            writer_kind: "tool",
            status: "observed",
            confidence: 900,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "tool_adapter",
            entity_key: "nmap",
            fact_name: "presence",
            value_json: { name: "nmap", present: true },
            writer_kind: "tool",
            status: "observed",
            confidence: 1000,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "tool_adapter",
            entity_key: "zap",
            fact_name: "presence",
            value_json: { name: "zap", present: false },
            writer_kind: "tool",
            status: "stale",
            confidence: 1000,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "vertical",
            entity_key: "pentest",
            fact_name: "readiness",
            value_json: { id: "pentest", status: "ready" },
            writer_kind: "tool",
            status: "observed",
            confidence: 1000,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "observation",
            entity_key: "obs_status",
            fact_name: "record",
            value_json: {
              id: "obs_status",
              subtype: "risk",
              title: "Projected observation",
              status: "open",
              evidence: [],
            },
            writer_kind: "tool",
            status: "observed",
            confidence: 1000,
          }),
        )
        await saveVault({
          secrets: {
            alice: {
              value: "Bearer testing-token",
              updated_at: new Date().toISOString(),
            },
          },
          active_identity: "alice",
          active_identity_set_at: new Date().toISOString(),
        })
        await buildReport()
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: slug,
            entity_kind: "share_bundle",
            entity_key: "share-status.tar.gz",
            fact_name: "archive",
            value_json: {
              path: "/tmp/share-status.tar.gz",
              size: 2048,
              signed: false,
              redacted: true,
            },
            writer_kind: "tool",
            status: "verified",
            confidence: 1000,
          }),
        )
        const result: any = await exec({ action: "status" })
        expect(result.metadata.action).toBe("status")
        expect(result.metadata.side_effects).toEqual(["read_only"])
        expect(result.metadata.slug).toBe(slug)
        expect(result.metadata.facts).toBeGreaterThan(0)
        expect(result.metadata.workflows).toBeGreaterThan(0)
        expect(result.metadata.autonomy_mode).toBe("custom")
        expect(result.metadata.active_identity).toBe("alice")
        expect(result.metadata.hosts).toBe(1)
        expect(result.metadata.services).toBe(1)
        expect(result.metadata.web_pages).toBe(1)
        expect(result.metadata.identities).toBe(1)
        expect(result.metadata.active_identities).toBe(1)
        expect(result.metadata.tool_adapters_present).toBe(1)
        expect(result.metadata.tool_adapters_missing).toBe(1)
        expect(result.metadata.knowledge_queries).toBe(1)
        expect(result.metadata.ready_verticals).toBe(1)
        expect(result.metadata.observations_projected).toBe(1)
        expect(result.metadata.ready_capsules).toBe(1)
        expect(result.metadata.recommended_capsules).toBe(1)
        expect(result.metadata.deliverables).toBeGreaterThanOrEqual(1)
        expect(result.metadata.share_bundles).toBe(1)
        expect(String(result.metadata.latest_deliverable_path)).toContain("report.md")
        expect(result.metadata.latest_share_bundle_path).toBe("/tmp/share-status.tar.gz")
        expect(result.metadata.reportable_findings).toBe(1)
        expect(result.metadata.suspected_findings).toBe(0)
        expect(result.metadata.rejected_findings).toBe(0)
        expect(result.metadata.verified_findings).toBe(1)
        expect(result.metadata.evidence_backed_findings).toBe(1)
        expect(result.metadata.replay_backed_findings).toBe(1)
        expect(result.output).toContain("Facts:")
        expect(result.output).toContain(
          "Surface entities: hosts=1 services=1 web_pages=1 routes=0 route_facts=0 identities=1 active_identities=1",
        )
        expect(result.output).toContain("Projected observations: 1")
        expect(result.output).toContain("Tool adapters: present=1 missing=1")
        expect(result.output).toContain("Knowledge queries: 1")
        expect(result.output).toContain("Capsules: ready=1")
        expect(result.output).toContain("Verticals: ready=1 degraded=0 unavailable=0")
        expect(result.output).toContain("Workflows:")
        expect(result.output).toContain("Autonomy: custom")
        expect(result.output).toContain("Identity: alice")
        expect(result.output).toContain("Deliverables:")
        expect(result.output).toContain("Share bundles: 1")
        expect(result.output).toContain("Latest deliverable:")
        expect(result.output).toContain("Latest share bundle: /tmp/share-status.tar.gz")
        expect(result.output).toContain("Candidate findings:")
        expect(result.metadata.candidate_findings).toBe(0)
        expect(result.output).toContain("Reportable: 1")
        expect(result.output).toContain("Suspected: 0")
        expect(result.output).toContain("Rejected: 0")
        expect(result.output).toContain("Replay-backed: 1")
        expect(result.output).toContain("Evidence-backed: 1")
        const derived = await Operation.readContextPack(fixture.path, slug)
        expect(derived).toContain("# Active Operation Context")
        expect(derived).toContain(`slug: ${slug}`)
      },
    })
  })

  test("workspace status is read-only and does not update active workflow progress", async () => {
    await using fixture = await tmpdir({ git: true })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const op = await Operation.create({ workspace: fixture.path, label: "Workflow Step", kind: "pentest" })
        await Operation.writeWorkflow(fixture.path, op.slug, {
          kind: "play",
          id: "custom-play",
          payload: {
            trace: [{ kind: "tool", tool: "workspace", args: { action: "status" } }],
            skipped: [],
          },
        })
        await Operation.setActiveWorkflow(fixture.path, op.slug, { kind: "play", id: "custom-play" })

        await exec({ action: "status" })

        const workflow = await Operation.readWorkflow(fixture.path, op.slug, {
          kind: "play",
          id: "custom-play",
        })
        const facts = await AppRuntime.runPromise(Cyber.listFacts({ operation_slug: op.slug, limit: 200 }))
        expect(Array.isArray(workflow?.trace)).toBe(true)
        const trace = (workflow?.trace ?? []) as Array<any>
        expect(trace[0]?.outcome).toBeUndefined()
        expect(workflow?.completed_steps).toBeUndefined()
        const status = facts.find(
          (item) =>
            item.entity_kind === "play" &&
            item.entity_key === "custom-play" &&
            item.fact_name === "workflow_status",
        )
        expect(status).toBeUndefined()
        const stepStatus = facts.find(
          (item) =>
            item.entity_kind === "workflow_step" &&
            item.entity_key === "play:custom-play:planned:1" &&
            item.fact_name === "step_status",
        )
        expect(stepStatus).toBeUndefined()
        const statusView: any = await exec({ action: "status" })
        expect(statusView.metadata.active_workflow).toBe("custom-play")
        expect(statusView.metadata.completed_steps).toBe(0)
        expect(statusView.metadata.pending_steps).toBe(0)
        expect(statusView.metadata.workflow_step_statuses).toBe(0)
        expect(statusView.metadata.autonomy_mode).toBe("custom")
        expect(statusView.metadata.side_effects).toEqual(["read_only"])
        expect(statusView.output).toContain("Progress: done=0")
      },
    })
  })

  test("snapshot reads kernel state when active-context.md is stale without rewriting it", async () => {
    await using fixture = await tmpdir({ git: true })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const op = await Operation.create({ workspace: fixture.path, label: "Snapshot Stale", kind: "appsec" })
        const staleContext = "# Active Operation Context\n\n## Findings\n_none yet_\n\n## Observations\n_none yet_"
        await Operation.writeContextPack(fixture.path, op.slug, staleContext)
        await new Promise((resolve) => setTimeout(resolve, 20))
        const evidence = await Evidence.put(fixture.path, op.slug, "replay proof", {
          mime: "text/plain",
          ext: "replay",
          label: "snapshot finding replay",
          source: "test",
        })
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "finding",
            entity_key: "app:authz",
            fact_name: "record",
            value_json: {
              title: "Confirmed authz issue",
              summary: "confirmed by replay",
              severity: "high",
              replay_present: true,
            },
            writer_kind: "operator",
            status: "verified",
            confidence: 1000,
            evidence_refs: [evidence.sha256],
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "finding",
            entity_key: "app:duplicate",
            fact_name: "record",
            value_json: {
              title: "Rejected duplicate issue",
              severity: "medium",
            },
            writer_kind: "operator",
            status: "rejected",
            confidence: 1000,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "http_route",
            entity_key: "https://target.test/account",
            fact_name: "last_response",
            value_json: { method: "GET", status: 200, route: "/account" },
            writer_kind: "tool",
            status: "observed",
            confidence: 1000,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "http_route",
            entity_key: "https://target.test/account",
            fact_name: "browser_request",
            value_json: true,
            writer_kind: "parser",
            status: "observed",
            confidence: 900,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "observation",
            entity_key: "obs_authz",
            fact_name: "record",
            value_json: {
              title: "Authz observation",
              status: "open",
              severity: "high",
              evidence: [evidence.sha256],
            },
            writer_kind: "tool",
            status: "observed",
            confidence: 900,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "observation",
            entity_key: "obs_closed",
            fact_name: "record",
            value_json: {
              title: "Closed duplicate observation",
              status: "closed",
              severity: "low",
              evidence: [],
            },
            writer_kind: "tool",
            status: "observed",
            confidence: 900,
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "deliverable",
            entity_key: "bundle-snapshot",
            fact_name: "report_bundle",
            value_json: {
              report_path: "/tmp/snapshot-report.md",
              counts: { reportable_findings: 1 },
            },
            writer_kind: "tool",
            status: "verified",
            confidence: 1000,
          }),
        )

        const before = await Operation.readContextPack(fixture.path, op.slug)
        const result: any = await exec({ action: "snapshot" })
        const after = await Operation.readContextPack(fixture.path, op.slug)

        expect(result.metadata.action).toBe("snapshot")
        expect(result.metadata.context_file_stale).toBe(true)
        expect(result.metadata.reportable_findings).toBe(1)
        expect(result.metadata.rejected_findings).toBe(1)
        expect(result.metadata.routes).toBe(1)
        expect(result.metadata.route_facts).toBe(2)
        expect(result.metadata.observations).toBe(2)
        expect(result.metadata.open_observations).toBe(1)
        expect(result.metadata.deliverables).toBe(1)
        expect(result.output).toContain("Confirmed authz issue")
        expect(result.output).toContain("Rejected duplicate issue")
        expect(result.output).toContain("Authz observation")
        expect(result.output).not.toContain("Closed duplicate observation")
        expect(result.output).toContain("routes=1 route_facts=2")
        expect(result.output).toContain("observations=2 open_observations=1")
        expect(result.output).toContain("rejected=1")
        expect(result.output).toContain("shares=0")
        expect(after).toBe(before)
      },
    })
  })

  test("read-only audit events do not make freshly generated context stale", async () => {
    await using fixture = await tmpdir({ git: true })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const op = await Operation.create({ workspace: fixture.path, label: "Audit Freshness", kind: "appsec" })
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "finding",
            entity_key: "app:fresh",
            fact_name: "record",
            value_json: { title: "Fresh finding", replay_present: true },
            writer_kind: "operator",
            status: "verified",
            confidence: 1000,
          }),
        )
        const snapshot = await OperationSnapshot.build(fixture.path, { slug: op.slug, includeDoctor: false })
        await Operation.writeContextPack(fixture.path, op.slug, OperationSnapshot.renderContext(snapshot, { mode: "write_context" }))
        await new Promise((resolve) => setTimeout(resolve, 20))

        const result: any = await exec({ action: "snapshot" })

        expect(result.metadata.context_file_stale).toBe(false)
        expect(result.metadata.stale_context).toBe(false)
        expect(result.metadata.audit_after_context).toBe(true)
        expect(result.metadata.source_audit_latest?.at).toBeGreaterThan(result.metadata.source_context_mtime?.at)
        expect(result.metadata.source_semantic_latest?.at).toBeLessThanOrEqual(result.metadata.source_context_mtime?.at)
        expect(result.metadata.side_effects).toEqual(["read_only"])
        expect(result.metadata.audit_logged).toBe(true)
        expect(result.metadata.domain_writes).toEqual([])
        expect(result.metadata.context_written).toBe(false)
        expect(result.metadata.evidence_written).toBe(false)
        expect(result.metadata.facts_written).toBe(false)
      },
    })
  })

  test("capabilities groups readiness by cyber domain", async () => {
    await using fixture = await tmpdir({ git: true })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        await Operation.create({ workspace: fixture.path, label: "Capabilities", kind: "pentest" })
        const result: any = await exec({ action: "capabilities" })

        expect(result.metadata.action).toBe("capabilities")
        expect(Array.isArray(result.metadata.domains)).toBe(true)
        expect(String(result.output)).toContain("AppSec")
        expect(String(result.output)).toContain("Pentest")
        expect(Array.isArray(result.metadata.missing_binaries)).toBe(true)
      },
    })
  })

  test("query returns routes and evidence linked to findings", async () => {
    await using fixture = await tmpdir({ git: true })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const op = await Operation.create({ workspace: fixture.path, label: "Query", kind: "appsec" })
        const evidence = await Evidence.put(fixture.path, op.slug, "http evidence", {
          mime: "text/plain",
          ext: "txt",
          label: "query evidence",
          source: "test",
        })
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "http_route",
            entity_key: "https://target.test/account/1",
            fact_name: "last_response",
            value_json: { method: "GET", status: 200, route: "/account/1" },
            writer_kind: "tool",
            status: "observed",
            confidence: 1000,
            evidence_refs: [evidence.sha256],
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "finding",
            entity_key: "app:idor",
            fact_name: "record",
            value_json: { title: "IDOR", replay_present: true },
            writer_kind: "operator",
            status: "verified",
            confidence: 1000,
            evidence_refs: [evidence.sha256],
          }),
        )
        for (let i = 0; i < 22; i++) {
          await AppRuntime.runPromise(
            Cyber.upsertFact({
              operation_slug: op.slug,
              entity_kind: "observation",
              entity_key: `obs_query_${i}`,
              fact_name: "record",
              value_json: {
                title: `Open observation ${i}`,
                status: "open",
                severity: i % 2 === 0 ? "medium" : "low",
                evidence: [],
              },
              writer_kind: "tool",
              status: "observed",
              confidence: 900,
            }),
          )
        }

        const routes: any = await exec({ action: "query", query: "routes" })
        const byRoute: any = await exec({
          action: "query",
          query: "findings_by_route",
          key: "https://target.test/account/1",
        })
        const byFinding: any = await exec({ action: "query", query: "evidence_by_finding", key: "finding:app:idor" })
        const openObservations: any = await exec({ action: "query", query: "open_observations", limit: 20 })
        const openPayload = JSON.parse(openObservations.output)

        expect(routes.metadata.count).toBe(1)
        expect(routes.output).toContain("https://target.test/account/1")
        expect(byRoute.metadata.count).toBe(1)
        expect(byRoute.output).toContain("app:idor")
        expect(byFinding.metadata.count).toBe(1)
        expect(byFinding.output).toContain(evidence.sha256)
        expect(openObservations.metadata.count).toBe(22)
        expect(openPayload.count).toBe(22)
        expect(openPayload.rows).toHaveLength(20)
        expect(byFinding.metadata.side_effects).toEqual(["read_only"])
      },
    })
  })

  test("query exposes active workflow and next workflow step", async () => {
    await using fixture = await tmpdir({ git: true })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const op = await Operation.create({ workspace: fixture.path, label: "Next Step", kind: "appsec" })
        await Operation.writeWorkflow(fixture.path, op.slug, {
          kind: "runbook",
          id: "knowledge-runbook",
          payload: {
            available: true,
            trace: [
              {
                kind: "tool",
                tool: "knowledge",
                label: "Anchor methodology",
                args: { mode: "offline", persist: false },
              },
            ],
            skipped: [],
          },
        })
        await Operation.setActiveWorkflow(fixture.path, op.slug, { kind: "runbook", id: "knowledge-runbook" })

        const next: any = await exec({ action: "query", query: "next_workflow_step" })
        const workflow: any = await exec({ action: "query", query: "workflow" })

        expect(next.metadata.count).toBe(1)
        expect(next.output).toContain("knowledge")
        expect(next.output).toContain("read_only_hint")
        expect(workflow.output).toContain("knowledge-runbook")
        expect(next.metadata.side_effects).toEqual(["read_only"])
      },
    })
  })
})
