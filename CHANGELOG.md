# Changelog

## 1.2.1

aegisec 1.2.1 is about making the operator experience tighter.

1.2.0 gave aegisec a real cyber operation model: scope, tools, findings, evidence, replay, reports, and AppSec/Pentest workflows. 1.2.1 makes that foundation easier to trust during real work: multiple terminals, multiple operations, long sessions, model switching, evidence lookup, workflow state, and cleaner context.

### Highlights

- Sessions now attach to their own operation, so multi-terminal work feels much cleaner.
- The startup flow now lets you choose which operation this session should use, or create a new one just for this session.
- The operation picker now shows all operations in the workspace, with cleaner labels and useful metadata.
- Operation state is easier for the agent to read through canonical snapshot/query flows.
- Evidence, findings, routes, reports, and share state are more consistent across the TUI and tools.
- Evidence search and graph navigation are more useful for real investigation work.
- Read-only tools now communicate their behavior more clearly.
- Workflow progress is tracked more reliably, including read-only workflow steps.
- Model reasoning/thinking controls are clearer, with better provider-specific mappings.
- Long model runs now expose better status while connecting, waiting, streaming, running tools, finalizing, or interrupting.
- Provider timeout diagnostics are cleaner and less misleading.
- aegisec is now licensed under AGPL-3.0-or-later.

### Multi-operation sessions

aegisec now handles multiple operations in the same workspace in a much more natural way.

When you start a fresh session and aegisec finds existing operations, it asks what this session should use. You can pick an existing operation or create a new operation for this session.

That means you can keep separate terminals open for separate targets or tasks without everything drifting toward the workspace default.

The workspace default still exists, but an already-running session now has its own operation binding. That is the important part.

### Cleaner operation picker

The startup operation picker now lists every operation in the workspace.

The default operation is shown first, but the rest are visible too. Operation names are shown cleanly, with kind, slug, and target kept in the details.

Small thing, but it makes the product feel much less confusing when you actually use it with several operations.

### Stronger operation context

The agent now gets a better view of the active operation through snapshot/query flows instead of relying on generated markdown context as truth.

That improves orientation around:

- routes
- observations
- findings
- evidence
- deliverables
- shares
- workflow state
- capability readiness

The result is a cleaner separation between canonical operation state and human-readable context artifacts.

### Better graph and evidence navigation

The cyber graph is more useful now.

You can query links like:

- route to findings
- finding to evidence
- evidence search across linked finding and observation text

This makes aegisec feel more like an investigation workspace and less like a pile of disconnected tool output.

### More honest read-only behavior

Read-only tools now expose clearer metadata about what they did.

The goal is simple: when the agent inspects workspace, report, share, or evidence state, it should be clear whether it only read state or actually changed something.

This matters a lot for security work, where evidence, findings, and reports need to be traceable.

### Better workflow tracking

Workflow progress is cleaner, especially for steps that are intentionally read-only.

A knowledge or inspection step can be read-only and still count as workflow progress. Read-only should mean "do not mutate facts/evidence/context", not "leave the workflow stuck".

### Better model reasoning controls

Model reasoning/thinking controls are clearer across supported providers.

aegisec now handles provider-specific reasoning options more carefully, including OpenAI-style reasoning effort, Claude thinking budgets, Gemini thinking config, OpenRouter reasoning effort, and DeepSeek V4 thinking controls.

DeepSeek V4 support was tightened in this release: supported DeepSeek V4, V4 Flash, and V4 Pro models now expose honest high/max controls instead of hiding thinking options or showing fake levels.

### Better model run lifecycle

The TUI now gives clearer status during model runs.

You should see better state while aegisec is connecting, waiting for model output, streaming, running tools, finalizing, or interrupting.

Interrupt handling is also more deterministic, so a session is better at returning to a clean ready state after you stop a run.

### License update

aegisec is now licensed under AGPL-3.0-or-later.

The project stays open source, but the license now better matches where aegisec is going: a serious open security agent platform, not just a small CLI experiment.

### Summary

1.2.1 is not a flashy release. It is a trust release.

The theme is:

```text
better sessions, better state, better evidence, better control
```

aegisec should now feel smoother when used the way security people actually work: multiple terminals, multiple targets, long sessions, local tools, evidence, reports, and model runs that sometimes need to be interrupted.

## 1.2.0

aegisec 1.2.0 is the release where the project becomes a real cyber operator console.

It gives the agent an operation, a scope, local tools, evidence, replay material, findings with lifecycle, cyber knowledge, and reports that come from proof instead of vibes. The point is simple: if AI agents are becoming normal for coding, security deserves one built for the way hackers, pentesters, AppSec engineers, and bug bounty hunters actually work.

### Highlights

- Operations now have real state: ledger events, projected facts, relations, evidence, replay, workflow, and deliverables.
- The TUI now behaves like an operation console, with lenses for findings, evidence, replay, workflow, and report state.
- AppSec and Pentest are the hard-gated 1.2 domains. Other cyber domains exist, but they are maturity-labeled instead of overclaimed.
- Findings now move through candidate, observed, verified, rejected, stale, and reportable states.
- A finding is not reportable just because the model sounds confident. It needs evidence and replay material, or an explicit structured replay exemption.
- The `knowledge` tool now acts as a Cyber Knowledge Broker for vulnerability intelligence, KEV/EPSS enrichment, applicability states, and safe next actions.
- Reports are built from operation state, not from a polished chat transcript.
- Runtime readiness now matters: aegisec tracks installed tools, degraded capabilities, and what the local environment can actually do.

### Operator workflow

- Start with `/pwn <target>` to create a scoped pentest operation and kick off the right starter capsule.
- Use `/runbook run web-surface <target>` to map a web target through the runbook surface.
- Use `/runbook run appsec-web-triage <target>` for AppSec triage with evidence and candidate findings.
- Use `/doctor` to see which local tools are ready, degraded, or missing.
- Build reports only after the operation has enough state to support them.

### Release gates

The CI/CD release gate for 1.2.0 is:

- `bun typecheck`
- `cd packages/aegisec && bun test --timeout 30000`
- `cd packages/aegisec && bun run build`

AppSec and Pentest benchmarks remain local/manual validation tools for release confidence and product claims. They are not run inside GitHub Actions.

### Community

Thanks to the bug bounty hunters, security researchers, and early users who tested aegisec in real workflows and shared candid feedback.

Special thanks to Deafen, a bug bounty hunter who tested aegisec in real bounty work, shared useful feedback, and told me about successful results using it. That is the kind of signal that matters: aegisec has to work outside demos.

Special thanks to @wendellmeset for putting real time into the project and opening detailed public issues. Those reports caught rough edges in the terminal UX and helped make this release harder to break.

### Compatibility

- `aegisec.md` remains available as a derived context pack, but it is not canonical operation state.
- `cve` remains as a compatibility alias for CVE-style lookup. New cyber research should use `knowledge`.
- aegisec uses installed tools. It does not bundle Kali, Burp, nuclei, nmap, ffuf, sqlmap, trivy, or similar binaries.

### Known limitations

- AppSec and Pentest are the only maturity-gated domains in this release.
- OSINT, CTF/hacking, cloud/container/IaC, forensics, and binary workflows are present with maturity labels and should not be marketed as equally benchmarked yet.
- The oracle layer verifies proof shape and lifecycle constraints; it is not an automatic exploitability oracle.
- Live benchmark runs require a configured model provider credential when executed manually.
