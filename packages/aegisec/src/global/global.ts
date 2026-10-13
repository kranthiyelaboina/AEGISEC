import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util"
import { Flock } from "@aegisec/shared/util/flock"

const app = "aegisec"

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

export const Path = {
  // Allow override via AEGISEC_TEST_HOME for test isolation
  get home() {
    return process.env.AEGISEC_TEST_HOME || os.homedir()
  },
  data,
  archives: path.join(data, "sessions"),
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  cache,
  config,
  state,
}

// Initialize Flock with global state path
Flock.setGlobal({ state })

// NOTE: This module is imported by the TUI worker. Bun (>=1.4) drops Worker
// message delivery when a worker entry graph contains top-level await, so
// initialization must run as a promise instead of blocking module evaluation.
// Anything that needs the directories to exist should await `ready`.
export const ready = Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.archives, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
]).then(() => undefined)

const CACHE_VERSION = "21"

void ready.then(async () => {
  const version = await Filesystem.readText(path.join(Path.cache, "version")).catch(() => "0")
  if (version === CACHE_VERSION) return
  try {
    const contents = await fs.readdir(Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch {}
  await Filesystem.write(path.join(Path.cache, "version"), CACHE_VERSION).catch(() => {})
})
