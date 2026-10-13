import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import { Database } from "../../src/storage"

describe("Database.Path", () => {
  test("resolves to a single stable canonical database for local persistence", () => {
    expect(Database.getChannelPath()).toBe(path.join(Global.Path.data, "aegisec.db"))
  })
})
