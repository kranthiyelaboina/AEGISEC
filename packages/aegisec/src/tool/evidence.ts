import { Effect } from "effect"
import z from "zod"
import * as Tool from "./tool"
import { Evidence } from "@/core/evidence"
import { Cyber } from "@/core/cyber"
import * as OperationSnapshot from "@/core/operation/snapshot"
import { Instance } from "@/project/instance"

const parameters = z.object({
  action: z.enum(["list", "search", "get", "add_text", "add_file"]).default("list"),
  label: z.string().optional(),
  text: z.string().optional(),
  path: z.string().optional(),
  mime: z.string().optional(),
  query: z.string().optional().describe("Evidence search string for action = search"),
  sha256: z.string().optional().describe("Evidence sha256 for action = get"),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  max_bytes: z.coerce.number().int().min(128).max(20000).optional(),
})

type Params = z.infer<typeof parameters>
type Metadata = Record<string, unknown>

function searchForms(value: string) {
  const lower = value.toLowerCase()
  const spaced = lower.replace(/[^a-z0-9]+/g, " ").trim()
  const compact = lower.replace(/[^a-z0-9]+/g, "")
  return [lower, spaced, compact].filter(Boolean)
}

function searchValues(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (typeof value === "string") return [value]
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return [String(value)]
  if (Array.isArray(value)) return value.flatMap(searchValues)
  return []
}

function matchesNeedle(value: unknown, needleForms: string[]) {
  return searchValues(value).some((item) => {
    const forms = searchForms(item)
    return needleForms.some((needle) => forms.some((form) => form.includes(needle)))
  })
}

function textLike(entry: { mime?: string; ext: string }) {
  return (
    entry.mime?.startsWith("text/") ||
    entry.mime === "application/json" ||
    ["txt", "md", "json", "html", "har", "replay"].includes(entry.ext)
  )
}

function matchedFieldNames(fields: Array<{ name: string; value: unknown }>, needleForms: string[]) {
  if (needleForms.length === 0) return []
  return fields.filter((field) => matchesNeedle(field.value, needleForms)).map((field) => field.name)
}

export const EvidenceTool = Tool.define<typeof parameters, Metadata, never>(
  "evidence",
  Effect.gen(function* () {
    return {
      description:
        "Manage evidence for the active operation. Use list/search/get for read-only inspection; add_text and add_file store immutable evidence artifacts.",
      parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const workspace = Instance.directory
          const slug = yield* Tool.resolveOperationSlug(ctx, workspace)
          if (!slug) {
            return {
              title: "evidence · no active operation",
              output: "No active operation.",
              metadata: { action: params.action, active: false, side_effects: Tool.sideEffects("read_only") },
            }
          }

          if (params.action === "list") {
            const entries = yield* Effect.promise(() => Evidence.list(workspace, slug))
            const output =
              entries.length === 0
                ? "No evidence stored."
                : entries
                    .map((entry) => `${entry.sha256} · ${entry.ext} · ${entry.size} bytes${entry.label ? ` · ${entry.label}` : ""}`)
                    .join("\n")
            return {
              title: `evidence · ${entries.length}`,
              output,
              metadata: { action: "list", count: entries.length, slug, side_effects: Tool.sideEffects("read_only") },
            }
          }

          if (params.action === "search") {
            const snapshot = yield* Effect.promise(() =>
              OperationSnapshot.build(workspace, {
                slug,
                includeDoctor: false,
                maxEvidence: 10_000,
              }),
            )
            const needleForms = searchForms(params.query ?? "")
            const rows: Array<Record<string, unknown>> = []
            for (const entry of snapshot.evidence.entries) {
              const linkedFindings = snapshot.findings.all.filter((finding) => entry.linked_finding_keys.includes(finding.key))
              const linkedObservations = snapshot.observations.filter((observation) => entry.linked_observation_ids.includes(observation.id))
              const linkedRoutes = snapshot.routes.filter((route) => entry.linked_routes.includes(route.key))
              let preview = ""
              let previewTruncated = false
              if (textLike(entry)) {
                const item = yield* Effect.promise(() => Evidence.get(workspace, slug, entry.sha256).catch(() => undefined))
                if (item) {
                  const bytes = item.bytes.slice(0, Math.min(item.bytes.length, 4000))
                  preview = new TextDecoder().decode(bytes)
                  previewTruncated = item.bytes.length > bytes.length
                }
              }
              const fields = [
                { name: "sha256", value: entry.sha256 },
                { name: "ext", value: entry.ext },
                { name: "mime", value: entry.mime },
                { name: "label", value: entry.label },
                { name: "source", value: entry.source },
                { name: "linked_finding_keys", value: entry.linked_finding_keys.join(" ") },
                { name: "linked_observation_ids", value: entry.linked_observation_ids.join(" ") },
                { name: "linked_routes", value: entry.linked_routes.join(" ") },
                { name: "replay_labels", value: entry.replay_labels.join(" ") },
                { name: "finding_text", value: linkedFindings.map((finding) => [finding.key, finding.title, finding.summary, finding.proof_summary].filter(Boolean).join(" ")).join("\n") },
                { name: "observation_text", value: linkedObservations.map((observation) => [observation.id, observation.title, observation.note, observation.tags.join(" ")].filter(Boolean).join(" ")).join("\n") },
                { name: "route_text", value: linkedRoutes.map((route) => [route.key, route.route, route.method, route.content_type].filter(Boolean).join(" ")).join("\n") },
                { name: "artifact_preview", value: preview },
              ]
              const matchedFields = matchedFieldNames(fields, needleForms)
              if (needleForms.length > 0 && matchedFields.length === 0) continue
              rows.push({
                ...entry,
                matched_fields: matchedFields,
                score: matchedFields.length,
                preview,
                preview_truncated: previewTruncated,
              })
            }
            rows.sort((a, b) => Number(b["score"] ?? 0) - Number(a["score"] ?? 0) || Number(b["at"] ?? 0) - Number(a["at"] ?? 0))
            const entries = rows.slice(0, params.limit ?? 20)
            return {
              title: `evidence · search · ${entries.length}`,
              output: JSON.stringify({ query: params.query ?? "", count: rows.length, entries }, null, 2),
              metadata: {
                action: "search",
                count: rows.length,
                slug,
                side_effects: Tool.sideEffects("read_only"),
              },
            }
          }

          if (params.action === "get") {
            const sha = params.sha256?.replace(/^sha256:/, "")
            if (!sha) {
              return {
                title: "evidence get",
                output: "Provide sha256 when action = get.",
                metadata: { action: "get", slug, side_effects: Tool.sideEffects("read_only") },
              }
            }
            const item = yield* Effect.promise(() => Evidence.get(workspace, slug, sha))
            if (!item) {
              return {
                title: `evidence · ${sha}`,
                output: "Evidence artifact not found.",
                metadata: { action: "get", slug, sha256: sha, found: false, side_effects: Tool.sideEffects("read_only") },
              }
            }
            const snapshot = yield* Effect.promise(() =>
              OperationSnapshot.build(workspace, { slug, includeDoctor: false, maxEvidence: 100 }),
            )
            const indexed = snapshot.evidence.entries.find((entry) => entry.sha256 === item.entry.sha256)
            const maxBytes = params.max_bytes ?? 4000
            const bytes = item.bytes.slice(0, Math.min(item.bytes.length, maxBytes))
            const preview = textLike(item.entry) ? new TextDecoder().decode(bytes) : `[binary preview omitted: ${bytes.length} bytes]`
            return {
              title: `evidence · ${item.entry.sha256}`,
              output: JSON.stringify(
                {
                  entry: item.entry,
                  linked_finding_keys: indexed?.linked_finding_keys ?? [],
                  linked_routes: indexed?.linked_routes ?? [],
                  replay_labels: indexed?.replay_labels ?? [],
                  preview,
                  truncated: item.bytes.length > bytes.length,
                },
                null,
                2,
              ),
              metadata: {
                action: "get",
                slug,
                sha256: item.entry.sha256,
                found: true,
                linked_finding_keys: indexed?.linked_finding_keys ?? [],
                linked_routes: indexed?.linked_routes ?? [],
                replay_labels: indexed?.replay_labels ?? [],
                truncated: item.bytes.length > bytes.length,
                side_effects: Tool.sideEffects("read_only"),
              },
            }
          }

          if (params.action === "add_text") {
            if (!params.text) {
              return {
                title: "evidence add_text",
                output: "Provide text when action = add_text.",
                metadata: { action: "add_text", slug, side_effects: Tool.sideEffects("writes_evidence") },
              }
            }
            const entry = yield* Effect.promise(() =>
              Evidence.put(workspace, slug, params.text!, {
                mime: params.mime ?? "text/plain",
                label: params.label,
                source: "evidence tool",
              }),
            )
            yield* Cyber.appendLedger({
              operation_slug: slug,
              kind: "evidence.added",
              source: "evidence",
              evidence_refs: [entry.sha256],
              summary: `added evidence ${entry.sha256}`,
              data: { action: "add_text", label: params.label, mime: params.mime ?? "text/plain", sha256: entry.sha256 },
            }).pipe(Effect.catch(() => Effect.succeed("")))
            return {
              title: `evidence · ${entry.sha256}`,
              output: `Stored text evidence ${entry.sha256}.${entry.ext}`,
              metadata: { action: "add_text", sha256: entry.sha256, slug, side_effects: Tool.sideEffects("writes_ledger", "writes_evidence") },
            }
          }

          if (!params.path) {
            return {
              title: "evidence add_file",
              output: "Provide path when action = add_file.",
              metadata: { action: "add_file", slug, side_effects: Tool.sideEffects("writes_evidence") },
            }
          }
          const entry = yield* Effect.promise(() =>
            Evidence.put(workspace, slug, { path: params.path! }, { mime: params.mime, label: params.label, source: params.path }),
          )
          yield* Cyber.appendLedger({
            operation_slug: slug,
            kind: "evidence.added",
            source: "evidence",
            evidence_refs: [entry.sha256],
            summary: `imported evidence ${entry.sha256}`,
            data: { action: "add_file", path: params.path, label: params.label, mime: params.mime, sha256: entry.sha256 },
          }).pipe(Effect.catch(() => Effect.succeed("")))
          return {
            title: `evidence · ${entry.sha256}`,
            output: `Stored file evidence ${entry.sha256}.${entry.ext}`,
            metadata: { action: "add_file", sha256: entry.sha256, slug, side_effects: Tool.sideEffects("writes_ledger", "writes_evidence") },
          }
        }),
    }
  }),
)
