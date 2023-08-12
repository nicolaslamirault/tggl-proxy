import * as process from 'process'
import express, { Application } from 'express'
import cors, { CorsOptions } from 'cors'
import compression from 'compression'
import { TgglLocalClient } from 'tggl-client'

export interface Storage {
  getConfig(): Promise<string>
  setConfig(config: string): Promise<void>
}

export type TgglProxyConfig = {
  url?: string
  apiKey?: string
  clientKeys?: string[]
  rejectUnauthorized?: boolean
  clientKeyHeader?: string
  storage?: Storage
  path?: string
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
    clientKeys = process.env.TGGL_CLIENT_KEYS?.split(',') ?? [],
    rejectUnauthorized = process.env.TGGL_REJECT_UNAUTHORIZED !== 'false',
    clientKeyHeader = process.env.TGGL_CLIENT_KEY_HEADER ?? 'Authorization',
    storage,
    path = process.env.TGGL_PROXY_PATH ?? '/flags',
    pollingInterval = Number(process.env.TGGL_POLLING_INTERVAL ?? 5000),
    cors: corsOptions = {},
  }: TgglProxyConfig = {},
  app: Application = express()
) => {
  const client = new TgglLocalClient(apiKey as string, { url, pollingInterval })
  client.fetchConfig().catch((err) => console.error(err))

  app.disable('x-powered-by')
  app.use(cors(corsOptions))
  app.use(compression())
  app.use(express.json())

  if (rejectUnauthorized) {
    app.use((req, res, next) => {
      if (!clientKeys.includes(req.header(clientKeyHeader) as string)) {
        res.status(401).send('Unauthorized')
        return
      }

      next()
    })
  }

  let setReady: () => void = () => null
  const ready = new Promise<void>((resolve) => {
    setReady = resolve
  })

  if (storage) {
    storage
      .getConfig()
      .then((str) => {
        const config = new Map()

        for (const flag of JSON.parse(str)) {
          config.set(flag.slug, flag)
        }

        client.setConfig(config)
        client.onConfigChange((c) =>
          storage.setConfig(JSON.stringify([...c.values()]))
        )
      })
      .catch((err) => {
        console.error('Could not fetch config from storage')
        console.error(err)
      })
      .finally(setReady)
  } else {
    setReady()
  }

  app.post(path, async (req, res) => {
    await ready

    if (Array.isArray(req.body)) {
      res.send(req.body.map((context) => evalContext(client, context)))
    } else {
      res.send(evalContext(client, req.body))
    }
  })

  return app
}
