import { describe, expect, test } from "bun:test"
import path from "node:path"

const PROMPTS = [
  "security.txt",
  "pentest.txt",
  "appsec.txt",
  "osint.txt",
  "hacking.txt",
]

describe("cyber agent prompts", () => {
  test("use snapshot-first tool guidance instead of legacy CLI orientation", async () => {
    const dir = path.join(import.meta.dir, "../../src/agent/prompt")
    for (const file of PROMPTS) {
      const prompt = await Bun.file(path.join(dir, file)).text()
      expect(prompt).toContain("workspace action=snapshot")
      expect(prompt).toContain("workspace action=query")
      expect(prompt).not.toContain("Tool palette (1.2.0)")
      expect(prompt).not.toContain("Operation.activeSlug()")
      expect(prompt).not.toContain("aegisec observation add")
      expect(prompt).not.toContain("observation evidence add")
    }
  })
})
