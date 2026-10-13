import { describe, expect, test } from "bun:test"
import {
  evidenceRows,
  findingsBadgeCount,
  findingsRows,
  replayCoveredCount,
  replayRows,
  reportGateRows,
  reportStatus,
  restoreSelectedIndex,
  loadOperationConsoleSnapshot,
  shouldRefreshOperationConsoleSnapshotForPart,
  stabilizeOperationConsoleSnapshot,
  type OperationConsoleSnapshot,
} from "../../../src/cli/cmd/tui/component/operation-lens/snapshot"
import { Operation } from "../../../src/core/operation"
import { AppRuntime } from "../../../src/effect/app-runtime"
import { Instance } from "../../../src/project/instance"
import { Session } from "../../../src/session"
import { tmpdir } from "../../fixture/fixture"

function makeSnapshot() {
  return {
    directory: "/tmp/project",
    evidenceCount: 3,
    evidenceEntries: [
      {
        sha256: "evidence1234567890",
        ext: "json",
        size: 123,
        label: "http response",
        source: "https://target/api",
        at: 1,
      },
      {
        sha256: "replay1234567890",
        ext: "replay",
        size: 88,
        label: "search replay",
        source: "finding replay",
        at: 2,
      },
      {
        sha256: "orphan1234567890",
        ext: "txt",
        size: 12,
        label: "notes",
        source: "tool scratch",
        at: 3,
      },
    ],
    timeline: [],
    deliverable: {
      key: "bundle",
      bundle_dir: "/tmp/project/.aegisec/operation/demo/deliverable/bundle-1",
      manifest_path: "/tmp/project/.aegisec/operation/demo/deliverable/bundle-1/manifest.json",
      report_path: "/tmp/project/.aegisec/operation/demo/deliverable/bundle-1/report.md",
      time_updated: 10,
    },
    projected: {
      findings: [
        {
          key: "cand-low",
          kind: "candidate",
          status: "candidate",
          title: "Candidate low",
          severity: "low",
        },
        {
          key: "sus-high",
          kind: "finding",
          status: "observed",
          title: "Suspected high",
          severity: "high",
          evidence_refs: ["evidence1234567890"],
          replay_present: false,
        },
        {
          key: "rep-high",
          kind: "finding",
          status: "verified",
          title: "Reportable high",
          severity: "high",
          evidence_refs: ["evidence1234567890", "replay1234567890"],
          replay_present: true,
          oracle_status: "pass",
          oracle_reason: "replay bundle present",
        },
        {
          key: "ver-missing",
          kind: "finding",
          status: "verified",
          title: "Verified missing replay",
          severity: "medium",
          evidence_refs: ["evidence1234567890"],
          replay_present: false,
        },
        {
          key: "rej-critical",
          kind: "finding",
          status: "rejected",
          title: "Rejected critical",
          severity: "critical",
        },
      ],
      relations: [
        {
          src_kind: "finding",
          src_key: "rep-high",
          relation: "backed_by",
          dst_kind: "evidence_artifact",
          dst_key: "evidence1234567890",
          status: "verified",
          time_created: 1,
          time_updated: 1,
        },
        {
          src_kind: "finding",
          src_key: "rep-high",
          relation: "backed_by",
          dst_kind: "replay_artifact",
          dst_key: "replay1234567890",
          status: "verified",
          time_created: 1,
          time_updated: 1,
        },
      ],
      summary: {
        reportable_findings: 1,
        verified_findings: 2,
        replay_backed_findings: 1,
        replay_exempt_findings: 0,
        findings: 4,
        candidate_findings: 1,
        rejected_findings: 1,
      },
      workflow_steps: [
        {
          key: "step-1",
          workflow: "runbook:pwn",
          index: 1,
          tool: "browser",
          label: "probe target",
          outcome: "completed",
        },
        {
          key: "step-2",
          workflow: "runbook:pwn",
          index: 2,
          tool: "sqlmap",
          label: "check sqli",
          outcome: "failed",
          outcome_error: "sqlmap missing",
        },
      ],
      workflows: [
        {
          key: "pwn",
          kind: "runbook",
          steps: 2,
          skipped: 0,
          completed_steps: 1,
          failed_steps: 1,
          pending_steps: 0,
          degraded: true,
        },
      ],
    },
    activeWorkflow: {
      kind: "runbook",
      id: "pwn",
    },
    workflow: {
      key: "pwn",
      kind: "runbook",
      steps: 2,
      skipped: 0,
      completed_steps: 1,
      failed_steps: 1,
      pending_steps: 0,
      degraded: true,
    },
    active: {
      slug: "demo",
      label: "Demo",
      kind: "pentest",
      updated_at: 1,
    },
  } as unknown as OperationConsoleSnapshot
}

describe("tui operation lens snapshot helpers", () => {
  test("findingsRows sorts by severity then proof status", () => {
    const rows = findingsRows(makeSnapshot())
    expect(rows.map((item) => `${item.severityCode}:${item.status}:${item.title}`)).toEqual([
      "C:rejected:Rejected critical",
      "H:reportable:Reportable high",
      "H:suspected:Suspected high",
      "M:verified:Verified missing replay",
      "L:candidate:Candidate low",
    ])
  })

  test("evidence rows link by evidence refs and relation state, and keep unlinked evidence", () => {
    const rows = evidenceRows(makeSnapshot())
    expect(rows.map((row) => `${row.compactRef}:${row.primaryRelationKind}:${row.findingTitles.join(",") || "unlinked"}`)).toEqual([
      "replay1234:replay_artifact:Reportable high",
      "evidence12:evidence_artifact:Reportable high,Suspected high,Verified missing replay",
      "orphan1234:unlinked:unlinked",
    ])
  })

  test("replay rows derive backed and missing states and resolve replay artifact", () => {
    const rows = replayRows(makeSnapshot())
    const backed = rows.find((row) => row.key === "rep-high")
    const missing = rows.find((row) => row.key === "ver-missing")
    expect(backed?.status).toBe("backed")
    expect(backed?.artifactSha).toBe("replay1234567890")
    expect(missing?.status).toBe("missing")
    expect(missing?.gap).toBe("verified finding missing replay bundle")
  })

  test("badge, replay, and report summaries derive from the snapshot", () => {
    const snapshot = makeSnapshot()
    expect(findingsBadgeCount(snapshot)).toBe(1)
    expect(replayCoveredCount(snapshot)).toBe(1)
    expect(reportStatus(snapshot)).toBe("ready")
  })

  test("report gates expose report-grade gaps", () => {
    const gates = reportGateRows(makeSnapshot())
    expect(gates.find((row) => row.key === "evidence")?.tone).toBe("success")
    expect(gates.find((row) => row.key === "replay")?.tone).toBe("error")
    expect(gates.find((row) => row.key === "replay")?.findingKeys).toEqual(["ver-missing"])
    expect(gates.find((row) => row.key === "workflow")?.tone).toBe("warning")
  })

  test("restoreSelectedIndex prefers focused key and clamps fallback", () => {
    const rows = findingsRows(makeSnapshot())
    expect(restoreSelectedIndex(rows, "ver-missing", 0)).toBe(3)
    expect(restoreSelectedIndex(rows, "missing-key", 99)).toBe(rows.length - 1)
  })

  test("snapshot refreshes only for completed tool mutations", () => {
    expect(shouldRefreshOperationConsoleSnapshotForPart(undefined)).toBe(false)
    expect(shouldRefreshOperationConsoleSnapshotForPart({ type: "text" })).toBe(false)
    expect(shouldRefreshOperationConsoleSnapshotForPart({ type: "tool", state: { status: "pending" } })).toBe(false)
    expect(shouldRefreshOperationConsoleSnapshotForPart({ type: "tool", state: { status: "running" } })).toBe(false)
    expect(shouldRefreshOperationConsoleSnapshotForPart({ type: "tool", state: { status: "completed" } })).toBe(true)
    expect(shouldRefreshOperationConsoleSnapshotForPart({ type: "tool", state: { status: "error" } })).toBe(true)
  })

  test("stabilizeOperationConsoleSnapshot keeps the last good snapshot during empty refreshes", () => {
    const previous = makeSnapshot()
    expect(stabilizeOperationConsoleSnapshot(previous, undefined)).toBe(previous)
  })

  test("stabilizeOperationConsoleSnapshot preserves projection for same operation on partial reads", () => {
    const previous = makeSnapshot()
    const next = {
      ...previous,
      projected: undefined,
      evidenceCount: 0,
      evidenceEntries: [],
      activeWorkflow: undefined,
      workflow: undefined,
      deliverable: undefined,
      timeline: [],
    } as OperationConsoleSnapshot

    const stable = stabilizeOperationConsoleSnapshot(previous, next)
    expect(stable?.active?.slug).toBe("demo")
    expect(stable?.projected).toBe(previous.projected)
    expect(stable?.evidenceEntries).toBe(previous.evidenceEntries)
    expect(stable?.evidenceCount).toBe(previous.evidenceCount)
    expect(stable?.workflow).toBe(previous.workflow)
    expect(stable?.deliverable).toBe(previous.deliverable)
  })

  test("stabilizeOperationConsoleSnapshot does not carry projection across operations", () => {
    const previous = makeSnapshot()
    const next = {
      ...previous,
      active: {
        ...previous.active!,
        slug: "other",
      },
      projected: undefined,
    } as OperationConsoleSnapshot

    const stable = stabilizeOperationConsoleSnapshot(previous, next)
    expect(stable?.active?.slug).toBe("other")
    expect(stable?.projected).toBeUndefined()
  })

  test("loadOperationConsoleSnapshot adapts OperationSnapshot as the UI source", async () => {
    await using tmp = await tmpdir()
    const op = await Operation.create({
      workspace: tmp.path,
      label: "UI Snapshot",
      kind: "pentest",
      target: "localhost:3000",
    })

    const loaded = await loadOperationConsoleSnapshot(tmp.path)

    expect(loaded?.active?.slug).toBe(op.slug)
    expect(loaded?.operationSnapshot?.operation?.slug).toBe(op.slug)
    expect(loaded?.projected).toBe(loaded?.operationSnapshot?.projected)
    expect(loaded?.evidenceCount).toBe(loaded?.operationSnapshot?.evidence.count)
    expect(loaded?.deliverable).toBe(loaded?.operationSnapshot?.deliverables.latest)
  })

  test("loadOperationConsoleSnapshot prefers the session-bound operation over workspace active", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const opA = await Operation.create({
          workspace: tmp.path,
          label: "Terminal A",
          kind: "pentest",
          target: "a.local",
        })
        const sessionA = await AppRuntime.runPromise(
          Session.Service.use((session) => session.create({ title: "terminal-a", operationSlug: opA.slug })),
        )
        const opB = await Operation.create({
          workspace: tmp.path,
          label: "Terminal B",
          kind: "ctf",
          target: "b.local",
        })

        const loadedA = await loadOperationConsoleSnapshot(tmp.path, { sessionID: sessionA.id })
        const loadedDefault = await loadOperationConsoleSnapshot(tmp.path)

        expect(await Operation.activeSlug(tmp.path)).toBe(opB.slug)
        expect(loadedA?.active?.slug).toBe(opA.slug)
        expect(loadedDefault?.active?.slug).toBe(opB.slug)
      },
    })
  })
})
