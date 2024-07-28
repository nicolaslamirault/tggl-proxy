import * as process from 'process'
import express, { Application } from 'express'
import cors from 'cors'
import compression from 'compression'
import { TgglLocalClient } from 'tggl-client'
import promClient from 'prom-client'
import { Reporting } from './reporting'
import { TgglProxyConfig } from './types'
import winston from 'winston'

promClient.collectDefaultMetrics()

const allRequestsRejected =
  'rejectUnauthorized is set to true but no clientApiKeys is provided, all requests will end in a 401. ' +
  'Either set rejectUnauthorized to false or provide a list of clientApiKeys. ' +
  'More information: https://tggl.io/developers/evaluating-flags/tggl-proxy#security'

const evalContext = (
  client: TgglLocalClient,
  context: any,
  reporting: Reporting
) => {
  reporting.reportContext(context)

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
    metricsPath = process.env.TGGL_METRICS_PATH ?? '/metrics',
    pollingInterval = Number(process.env.TGGL_POLLING_INTERVAL ?? 5000),
    cors: corsOptions = {},
    logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.simple(),
        }),
      ],
    }),
  }: TgglProxyConfig = {},
  app: Application = express()
) => {
  const client = new TgglLocalClient(apiKey as string, {
    url,
    pollingInterval,
    log: false,
  })
  const reporting = new Reporting(apiKey as string)

  client.onFetchSuccessful(() => {
    logger?.info('Fetched config from API')
  })

  client.onFetchFail((error) => {
    logger?.error('Failed to fetch config from API', { error })
  })

  if (rejectUnauthorized && !clientApiKeys.length) {
    logger?.error(allRequestsRejected)
  }

  app.disable('x-powered-by')
  app.use(cors(corsOptions))
  app.use(compression())
  app.use(express.json())
  app.use((req, res, next) => {
    const start = process.hrtime()

    res.on('finish', () => {
      const diff = process.hrtime(start)
      const duration = Number((diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2))
      logger?.info('Request', {
        duration,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        body: req.body,
      })
    })

    next()
  })

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
      .catch((error) => {
        logger?.error('Failed to fetch config from cache', { error })
      })
  }

  ready = ready.then(async () => {
    const config = await client.fetchConfig().catch(() => null)

    if (config) {
      configFromClient = true
    }
  })

  app.post(path, async (req, res) => {
    if (rejectUnauthorized) {
      if (!clientApiKeys.length) {
        res.status(401).json({ error: allRequestsRejected })
        return
      }

      if (!clientApiKeys.includes(req.header('x-tggl-api-key') as string)) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
    }

    await ready

    if (Array.isArray(req.body)) {
      res.send(
        req.body.map((context) => evalContext(client, context, reporting))
      )
    } else {
      res.send(evalContext(client, req.body, reporting))
    }
  })

  if (healthCheckPath && healthCheckPath !== 'false') {
    app.get(healthCheckPath, async (req, res) => {
      await ready

      if (!configFromStorage && !configFromClient) {
        res.status(503).send('Could not fetch config from storage or API')
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

  if (metricsPath && metricsPath !== 'false') {
    app.get(metricsPath, async (req, res) => {
      try {
        res.set('Content-Type', promClient.register.contentType)
        res.end(await promClient.register.metrics())
      } catch (err) {
        res.status(500).end(err)
      }
    })
  }

  app.use((req, res) => {
    res.status(404)
    res.json({ error: 'Not found' })
  })

  return app
}
