export * from "./client.js"
export * from "./server.js"

import { createAegisecClient } from "./client.js"
import { createAegisecServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createAegisec(options?: ServerOptions) {
  const server = await createAegisecServer({
    ...options,
  })

  const client = createAegisecClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
