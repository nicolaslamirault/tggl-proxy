import * as process from 'process'
import express, { Application } from 'express'
import cors, { CorsOptions } from 'cors'
import compression from 'compression'
import { TgglLocalClient } from 'tggl-client'

export interface Storage {
  getConfig(): Promise<string | null>
  setConfig(config: string): Promise<void>
}

export type TgglProxyConfig = {
  url?: string
  apiKey?: string
  clientApiKeys?: string[]
  rejectUnauthorized?: boolean
  storage?: Storage
  path?: string
  healthCheckPath?: string
  pollingInterval?: number
  cors?: CorsOptions
}

const evalContext = (client: TgglLocalClient, context: any) => {
  const config = client.getConfig()

  return [...config.keys()].reduce((acc, cur) => {
    acc[cur] = client.get(context, cur)
    return acc
  }, {} as Record<string, any>)
}

export const createApp = (
  {
    url = process.env.TGGL_URL,
    apiKey = process.env.TGGL_API_KEY,
    clientApiKeys = process.env.TGGL_CLIENT_API_KEYS?.split(',') ?? [],
    rejectUnauthorized = process.env.TGGL_REJECT_UNAUTHORIZED !== 'false',
    storage,
    path = process.env.TGGL_PROXY_PATH ?? '/flags',
    healthCheckPath = process.env.TGGL_HEALTH_CHECK_PATH ?? '/health',
    pollingInterval = Number(process.env.TGGL_POLLING_INTERVAL ?? 5000),
    cors: corsOptions = {},
  }: TgglProxyConfig = {},
  app: Application = express()
) => {
  const client = new TgglLocalClient(apiKey as string, { url, pollingInterval })

  app.disable('x-powered-by')
  app.use(cors(corsOptions))
  app.use(compression())
  app.use(express.json())

  let configFromStorage = false
  let configFromClient = false

  let ready = Promise.resolve()

  if (storage) {
    client.onConfigChange((c) =>
      storage.setConfig(JSON.stringify([...c.values()]))
    )

    ready = ready
      .then(async () => {
        const str = await storage.getConfig()

        if (!str) {
          return
        }

        const config = new Map()

        for (const flag of JSON.parse(str)) {
          config.set(flag.slug, flag)
        }

        client.setConfig(config)
        configFromStorage = true
      })
      .catch((err) => {
        console.error('Could not fetch config from storage')
        console.error(err)
      })
  }

  ready = ready
    .then(async () => {
      const config = await client.fetchConfig()

      if (config) {
        configFromClient = true
      }
    })
    .catch((err) => console.error(err))

  app.post(path, async (req, res, next) => {
    if (rejectUnauthorized) {
      if (!clientApiKeys.includes(req.header('x-tggl-api-key') as string)) {
        res.status(401).send('Unauthorized')
        return
      }

      return next()
    }

    await ready

    if (Array.isArray(req.body)) {
      res.send(req.body.map((context) => evalContext(client, context)))
    } else {
      res.send(evalContext(client, req.body))
    }
  })

  if (healthCheckPath === path || healthCheckPath === path + '/') {
    console.error(
      'Health check path cannot be the same as the proxy path, health check disabled'
    )
  }

  if (
    healthCheckPath &&
    healthCheckPath !== path &&
    healthCheckPath !== path + '/' &&
    healthCheckPath !== 'false'
  ) {
    app.get(healthCheckPath, async (req, res) => {
      await ready

      if (!configFromStorage && !configFromClient) {
        res.status(500).send('Could not fetch config from storage or API')
        return
      }

      if (!configFromClient) {
        res
          .status(200)
          .send(
            'Could not fetch config from API, falling back to storage but may be stale'
          )
        return
      }

      res.status(200).send('OK')
    })
  }

  return app
}
