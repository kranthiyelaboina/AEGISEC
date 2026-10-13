import z from "zod"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpExa from "./mcp-exa"
import DESCRIPTION from "./knowledge.txt"
import { Cyber } from "@/core/cyber"
import { Evidence } from "@/core/evidence"
import { Instance } from "@/project/instance"
import { KnowledgeActions, KnowledgeBroker, KnowledgeIntents, KnowledgeModes, persistKnowledgeResult, workspaceKnowledgeCache } from "@/core/knowledge"

const parameters = z
  .object({
    source: z.enum(["cve", "web"]).optional().describe("legacy knowledge source. Prefer intent/action; source=cve maps to vuln_intel lookup, source=web delegates to optional websearch."),
    intent: z.enum(KnowledgeIntents).optional().describe("knowledge intent: vuln intelligence, methodology, tradecraft, exploit signal, local tool docs, or curated field research"),
    action: z.enum(KnowledgeActions).optional().describe("knowledge action: lookup, match/enrich observed state, prioritize, or suggest safe next actions"),
    query: z.string().min(1).describe("CVE id, package spec, observed technology, technique, tool name, or cyber research query"),
    observed_refs: z.array(z.string()).max(25).optional().describe("optional cyber-kernel refs that this knowledge should be evaluated against"),
    mode: z.enum(KnowledgeModes).optional().describe("live uses public no-key sources, offline uses local/cache only, opsec_strict sanitizes target-specific data"),
    severity: z.enum(["low", "medium", "high", "critical"]).optional().describe("optional severity floor"),
    limit: z.coerce.number().int().min(1).max(50).optional().describe("max results/cards to return"),
    numResults: z.number().optional().describe("number of web search results to return"),
    livecrawl: z.enum(["fallback", "preferred"]).optional().describe("live crawl preference"),
    type: z.enum(["auto", "fast", "deep"]).optional().describe("search depth"),
    contextMaxCharacters: z.number().optional().describe("max web context size"),
    persist: z.boolean().default(false).describe("Persist the full result as evidence and cyber facts. Defaults to false for inspection-style calls."),
  })
  .superRefine((value, issue) => {
    if (value.source === "web" && value.severity) {
      issue.addIssue({
        code: "custom",
        path: ["severity"],
        message: "severity is only valid when source=cve",
      })
    }

    if (value.source === "web" && value.limit != null) {
      issue.addIssue({
        code: "custom",
        path: ["limit"],
        message: "limit is only valid when source=cve",
      })
    }

    if ((value.source === "cve" || value.intent) && value.numResults != null) {
      issue.addIssue({
        code: "custom",
        path: ["numResults"],
        message: "numResults is only valid for legacy source=web",
      })
    }

    if ((value.source === "cve" || value.intent) && value.livecrawl) {
      issue.addIssue({
        code: "custom",
        path: ["livecrawl"],
        message: "livecrawl is only valid for legacy source=web",
      })
    }

    if ((value.source === "cve" || value.intent) && value.type) {
      issue.addIssue({
        code: "custom",
        path: ["type"],
        message: "type is only valid for legacy source=web",
      })
    }

    if ((value.source === "cve" || value.intent) && value.contextMaxCharacters != null) {
      issue.addIssue({
        code: "custom",
        path: ["contextMaxCharacters"],
        message: "contextMaxCharacters is only valid for legacy source=web",
      })
    }
  })

type Params = z.infer<typeof parameters>
type Metadata = {
  surface: "knowledge"
  delegated_to: "broker" | "websearch"
  source?: Params["source"]
  intent?: string
  action?: string
  mode?: string
  cards?: number
  degraded?: boolean
  available?: boolean
  applicable?: number
  conditional?: number
  possible?: number
  kev_checked?: boolean
  epss_checked?: boolean
  persist?: boolean
  [key: string]: unknown
}

function brokerOutput(result: Awaited<ReturnType<typeof KnowledgeBroker.query>>, persisted: boolean) {
  return JSON.stringify(
    {
      operator_summary: result.operator_summary ?? result.summary,
      request: result.request,
      cards_compact: result.cards_compact ?? [],
      sources: result.sources.map((item) => ({
        name: item.name,
        source_type: item.source_type,
        trust: item.trust,
        degraded: item.degraded ?? false,
        error: item.error,
      })),
      degraded: result.degraded,
      errors: result.errors,
      full_result_persisted_as_evidence: persisted,
    },
    null,
    2,
  )
}

function vulnStateCounts(result: Awaited<ReturnType<typeof KnowledgeBroker.query>>) {
  const counts = { applicable: 0, conditional: 0, possible: 0 }
  for (const card of result.cards) {
    if (card.kind !== "vuln_intel") continue
    if (card.applicability.state === "applicable") counts.applicable++
    if (card.applicability.state === "conditional") counts.conditional++
    if (card.applicability.state === "possible") counts.possible++
  }
  return counts
}

export const KnowledgeTool = Tool.define<typeof parameters, Metadata, HttpClient.HttpClient>(
  "knowledge",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: Params, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const workspace = Instance.directory
          const slug = yield* Tool.resolveOperationSlug(ctx, workspace)
          const persist = params.persist ?? false
          if (params.source === "web" && !params.intent) {
            yield* ctx.ask({
              permission: "websearch",
              patterns: [params.query],
              always: ["*"],
              metadata: {
                query: params.query,
                numResults: params.numResults,
                livecrawl: params.livecrawl,
                type: params.type,
                contextMaxCharacters: params.contextMaxCharacters,
              },
            })
            const raw = yield* McpExa.call(
              http,
              "web_search_exa",
              McpExa.SearchArgs,
              {
                query: params.query,
                type: params.type || "auto",
                numResults: params.numResults || 8,
                livecrawl: params.livecrawl || "fallback",
                contextMaxCharacters: params.contextMaxCharacters,
              },
              "25 seconds",
            ).pipe(Effect.orDie)
            const output = raw ?? "No search results found. Please try a different query."
            const evidence =
              !slug || !persist
                ? undefined
                : yield* Effect.promise(() =>
                    Evidence.put(workspace, slug, output, {
                      mime: "text/plain",
                      ext: "txt",
                      label: `knowledge web ${params.query}`,
                      source: "knowledge",
                    }),
                  )
            const evidenceRefs = evidence ? [evidence.sha256] : undefined
            if (persist) {
              const eventID = yield* Cyber.appendLedger({
                operation_slug: slug,
                kind: "fact.observed",
                source: "knowledge",
                summary: `web knowledge query ${params.query}`,
                session_id: ctx.sessionID,
                message_id: ctx.messageID,
                evidence_refs: evidenceRefs,
                data: {
                  query: params.query,
                  num_results: params.numResults ?? null,
                  livecrawl: params.livecrawl ?? "fallback",
                  type: params.type ?? "auto",
                },
              }).pipe(Effect.catch(() => Effect.succeed("")))
              yield* Cyber.upsertFact({
                operation_slug: slug,
                entity_kind: "knowledge_query",
                entity_key: `web:${params.query}`,
                fact_name: "web_result",
                value_json: {
                  query: params.query,
                  output,
                  num_results: params.numResults ?? null,
                  livecrawl: params.livecrawl ?? "fallback",
                  type: params.type ?? "auto",
                },
                writer_kind: "tool",
                status: raw ? "observed" : "stale",
                confidence: raw ? 700 : 300,
                source_event_id: eventID || undefined,
                evidence_refs: evidenceRefs,
              }).pipe(Effect.catch(() => Effect.succeed("")))
            }
            return {
              title: `Web search: ${params.query}`,
              output,
              metadata: {
                surface: "knowledge",
                delegated_to: "websearch",
                source: "web",
                persist,
                side_effects: persist
                  ? Tool.sideEffects("network", "writes_ledger", "writes_evidence", "writes_facts")
                  : Tool.sideEffects("read_only", "network"),
              } satisfies Metadata,
            }
          }

          yield* ctx.ask({
            permission: "knowledge",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              source: params.source,
              intent: params.intent,
              action: params.action,
              mode: params.mode,
              query: params.query,
            },
          })

          const request = KnowledgeBroker.normalize({
            source: params.source,
            intent: params.intent,
            action: params.action,
            query: params.query,
            observed_refs: params.observed_refs,
            mode: params.mode,
            limit: params.limit,
          })
          const result = yield* Effect.promise(() => KnowledgeBroker.query(request, workspaceKnowledgeCache(workspace)))
          if (persist) {
            yield* persistKnowledgeResult({
              workspace,
              operation_slug: slug,
              result,
              session_id: ctx.sessionID,
              message_id: ctx.messageID,
              source: "knowledge",
              fact_name: params.source === "cve" && !params.intent ? "cve_result" : "result",
              legacy_query_key: params.source === "cve" && !params.intent ? `cve:${params.query}` : undefined,
            })
          }

          return {
            title: `${result.request.intent}: ${result.cards.length} card${result.cards.length === 1 ? "" : "s"} for "${result.request.query}"`,
            output: brokerOutput(result, persist),
            metadata: {
              surface: "knowledge",
              delegated_to: "broker",
              source: params.source,
              intent: result.request.intent,
              action: result.request.action,
              mode: result.request.mode,
              cards: result.cards.length,
              degraded: result.degraded,
              available: !result.degraded,
              persist,
              ...vulnStateCounts(result),
              kev_checked: result.sources.some((item) => item.name.includes("cisa.gov")),
              epss_checked: result.sources.some((item) => item.name.includes("api.first.org")),
              side_effects: persist
                ? Tool.sideEffects("network", "writes_ledger", "writes_evidence", "writes_facts")
                : result.request.mode === "offline"
                  ? Tool.sideEffects("read_only")
                  : Tool.sideEffects("read_only", "network"),
            } satisfies Metadata,
          }
        }),
    }
  }),
)
