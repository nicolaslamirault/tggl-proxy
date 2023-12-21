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

  if (rejectUnauthorized) {
    app.use((req, res, next) => {
      if (!clientApiKeys.includes(req.header('x-tggl-api-key') as string)) {
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
    client.onConfigChange((c) =>
      storage.setConfig(JSON.stringify([...c.values()]))
    )

    storage
      .getConfig()
      .then((str) => {
        if (!str) {
          return
        }

        const config = new Map()

        for (const flag of JSON.parse(str)) {
          config.set(flag.slug, flag)
        }

        client.setConfig(config)
        setReady()
      })
      .catch((err) => {
        console.error('Could not fetch config from storage')
        console.error(err)
      })
  }

  client
    .fetchConfig()
    .catch((err) => console.error(err))
    .finally(setReady)

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
