import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const AEGISEC_STREAM_TIMEOUT = process.env["AEGISEC_STREAM_TIMEOUT"]
  export const OTEL_EXPORTER_OTLP_ENDPOINT = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
  export const OTEL_EXPORTER_OTLP_HEADERS = process.env["OTEL_EXPORTER_OTLP_HEADERS"]

  export const AEGISEC_AUTO_SHARE = truthy("AEGISEC_AUTO_SHARE")
  export const AEGISEC_AUTO_HEAP_SNAPSHOT = truthy("AEGISEC_AUTO_HEAP_SNAPSHOT")
  export const AEGISEC_GIT_BASH_PATH = process.env["AEGISEC_GIT_BASH_PATH"]
  export const AEGISEC_CONFIG = process.env["AEGISEC_CONFIG"]
  export declare const AEGISEC_PURE: boolean
  export declare const AEGISEC_TUI_CONFIG: string | undefined
  export declare const AEGISEC_CONFIG_DIR: string | undefined
  export declare const AEGISEC_PLUGIN_META_FILE: string | undefined
  export const AEGISEC_CONFIG_CONTENT = process.env["AEGISEC_CONFIG_CONTENT"]
  export const AEGISEC_DISABLE_AUTOUPDATE = truthy("AEGISEC_DISABLE_AUTOUPDATE")
  export const AEGISEC_ALWAYS_NOTIFY_UPDATE = truthy("AEGISEC_ALWAYS_NOTIFY_UPDATE")
  export const AEGISEC_DISABLE_PRUNE = truthy("AEGISEC_DISABLE_PRUNE")
  export const AEGISEC_DISABLE_TERMINAL_TITLE = truthy("AEGISEC_DISABLE_TERMINAL_TITLE")
  export const AEGISEC_SHOW_TTFD = truthy("AEGISEC_SHOW_TTFD")
  export const AEGISEC_PERMISSION = process.env["AEGISEC_PERMISSION"]
  export const AEGISEC_DISABLE_DEFAULT_PLUGINS = truthy("AEGISEC_DISABLE_DEFAULT_PLUGINS")
  export const AEGISEC_DISABLE_LSP_DOWNLOAD = truthy("AEGISEC_DISABLE_LSP_DOWNLOAD")
  export const AEGISEC_ENABLE_EXPERIMENTAL_MODELS = truthy("AEGISEC_ENABLE_EXPERIMENTAL_MODELS")
  export const AEGISEC_DISABLE_AUTOCOMPACT = truthy("AEGISEC_DISABLE_AUTOCOMPACT")
  export const AEGISEC_DISABLE_MODELS_FETCH = truthy("AEGISEC_DISABLE_MODELS_FETCH")
  export const AEGISEC_DISABLE_MOUSE = truthy("AEGISEC_DISABLE_MOUSE")
  export const AEGISEC_DISABLE_CLAUDE_CODE = truthy("AEGISEC_DISABLE_CLAUDE_CODE")
  export const AEGISEC_DISABLE_CLAUDE_CODE_PROMPT =
    AEGISEC_DISABLE_CLAUDE_CODE || truthy("AEGISEC_DISABLE_CLAUDE_CODE_PROMPT")
  export const AEGISEC_DISABLE_CLAUDE_CODE_SKILLS =
    AEGISEC_DISABLE_CLAUDE_CODE || truthy("AEGISEC_DISABLE_CLAUDE_CODE_SKILLS")
  export const AEGISEC_DISABLE_EXTERNAL_SKILLS =
    AEGISEC_DISABLE_CLAUDE_CODE_SKILLS || truthy("AEGISEC_DISABLE_EXTERNAL_SKILLS")
  export declare const AEGISEC_DISABLE_PROJECT_CONFIG: boolean
  export const AEGISEC_FAKE_VCS = process.env["AEGISEC_FAKE_VCS"]
  export declare const AEGISEC_CLIENT: string
  export const AEGISEC_SERVER_PASSWORD = process.env["AEGISEC_SERVER_PASSWORD"]
  export const AEGISEC_SERVER_USERNAME = process.env["AEGISEC_SERVER_USERNAME"]
  export const AEGISEC_ENABLE_QUESTION_TOOL = truthy("AEGISEC_ENABLE_QUESTION_TOOL")

  // Experimental
  export const AEGISEC_EXPERIMENTAL = truthy("AEGISEC_EXPERIMENTAL")
  export const AEGISEC_EXPERIMENTAL_FILEWATCHER = Config.boolean("AEGISEC_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )
  export const AEGISEC_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "AEGISEC_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))
  export const AEGISEC_EXPERIMENTAL_ICON_DISCOVERY =
    AEGISEC_EXPERIMENTAL || truthy("AEGISEC_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["AEGISEC_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const AEGISEC_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("AEGISEC_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const AEGISEC_ENABLE_EXA =
    truthy("AEGISEC_ENABLE_EXA") || AEGISEC_EXPERIMENTAL || truthy("AEGISEC_EXPERIMENTAL_EXA")
  export const AEGISEC_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("AEGISEC_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const AEGISEC_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("AEGISEC_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const AEGISEC_EXPERIMENTAL_OXFMT = AEGISEC_EXPERIMENTAL || truthy("AEGISEC_EXPERIMENTAL_OXFMT")
  export const AEGISEC_EXPERIMENTAL_LSP_TY = truthy("AEGISEC_EXPERIMENTAL_LSP_TY")
  export const AEGISEC_EXPERIMENTAL_LSP_TOOL = AEGISEC_EXPERIMENTAL || truthy("AEGISEC_EXPERIMENTAL_LSP_TOOL")
  export const AEGISEC_DISABLE_FILETIME_CHECK = Config.boolean("AEGISEC_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )
  export const AEGISEC_EXPERIMENTAL_PLAN_MODE = AEGISEC_EXPERIMENTAL || truthy("AEGISEC_EXPERIMENTAL_PLAN_MODE")
  export const AEGISEC_EXPERIMENTAL_MARKDOWN = !falsy("AEGISEC_EXPERIMENTAL_MARKDOWN")
  export const AEGISEC_MODELS_URL = process.env["AEGISEC_MODELS_URL"]
  export const AEGISEC_MODELS_PATH = process.env["AEGISEC_MODELS_PATH"]
  export const AEGISEC_DISABLE_EMBEDDED_WEB_UI = truthy("AEGISEC_DISABLE_EMBEDDED_WEB_UI")
  export const AEGISEC_DB = process.env["AEGISEC_DB"]
  export const AEGISEC_DISABLE_CHANNEL_DB = truthy("AEGISEC_DISABLE_CHANNEL_DB")
  // Opt-in to a channel-scoped database (e.g. aegisec-beta.db). Off by default so
  // every launch — dev, preview or release — reads and writes ONE canonical local
  // database. This keeps sessions permanently stored and reachable across restarts.
  export const AEGISEC_CHANNEL_DB = truthy("AEGISEC_CHANNEL_DB")
  export const AEGISEC_SKIP_MIGRATIONS = truthy("AEGISEC_SKIP_MIGRATIONS")
  export const AEGISEC_STRICT_CONFIG_DEPS = truthy("AEGISEC_STRICT_CONFIG_DEPS")

  export const AEGISEC_WORKSPACE_ID = process.env["AEGISEC_WORKSPACE_ID"]
  export const AEGISEC_EXPERIMENTAL_HTTPAPI = AEGISEC_EXPERIMENTAL || truthy("AEGISEC_EXPERIMENTAL_HTTPAPI")
  export const AEGISEC_EXPERIMENTAL_WORKSPACES = AEGISEC_EXPERIMENTAL || truthy("AEGISEC_EXPERIMENTAL_WORKSPACES")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for AEGISEC_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "AEGISEC_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("AEGISEC_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AEGISEC_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "AEGISEC_TUI_CONFIG", {
  get() {
    return process.env["AEGISEC_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AEGISEC_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "AEGISEC_CONFIG_DIR", {
  get() {
    return process.env["AEGISEC_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AEGISEC_PURE
// This must be evaluated at access time, not module load time,
// because the CLI can set this flag at runtime
Object.defineProperty(Flag, "AEGISEC_PURE", {
  get() {
    return truthy("AEGISEC_PURE")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AEGISEC_PLUGIN_META_FILE
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "AEGISEC_PLUGIN_META_FILE", {
  get() {
    return process.env["AEGISEC_PLUGIN_META_FILE"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AEGISEC_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "AEGISEC_CLIENT", {
  get() {
    return process.env["AEGISEC_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
