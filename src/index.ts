import * as process from 'process'
import express, { Application } from 'express'
import cors from 'cors'
import compression from 'compression'
import { TgglConfig, TgglLocalClient, TgglReporting } from 'tggl-client'
import promClient from 'prom-client'
import { Storage, TgglProxyConfig } from './types'
import winston from 'winston'
import { RedisStorage } from './storage/redis'
import { PostgresStorage } from './storage/pg'
import { S3Storage } from './storage/s3'
import { RequestHandler } from 'express-serve-static-core'
import requestIp from 'request-ip'

export type { Storage, TgglProxyConfig } from './types'
export { PostgresStorage } from './storage/pg'
export { RedisStorage } from './storage/redis'
export { S3Storage } from './storage/s3'

promClient.collectDefaultMetrics()

const allRequestsRejected =
  'rejectUnauthorized is set to true but no clientApiKeys is provided, all requests will end in a 401. ' +
  'Either set rejectUnauthorized to false or provide a list of clientApiKeys. ' +
  'More information: https://tggl.io/developers/evaluating-flags/tggl-proxy#security'

const stripSpecialCharacters = (str?: string) =>
  str?.replace(/[^\x20-\x7E]/g, '')

const formatError = (error: any) => {
  if (error instanceof Error) {
    return error.message
  }

  return error
}

export const createApp = (
  {
    url = stripSpecialCharacters(process.env.TGGL_URL),
    apiKey = stripSpecialCharacters(process.env.TGGL_API_KEY),
    clientApiKeys = stripSpecialCharacters(
      process.env.TGGL_CLIENT_API_KEYS
    )?.split(',') ?? [],
    rejectUnauthorized = stripSpecialCharacters(
      process.env.TGGL_REJECT_UNAUTHORIZED
    ) !== 'false',
    storages: rawStorages,
    path = stripSpecialCharacters(process.env.TGGL_PROXY_PATH) ?? '/flags',
    reportPath = stripSpecialCharacters(process.env.TGGL_REPORT_PATH) ??
      '/report',
    configPath = stripSpecialCharacters(process.env.TGGL_CONFIG_PATH) ??
      '/config',
    healthCheckPath = stripSpecialCharacters(
      process.env.TGGL_HEALTH_CHECK_PATH
    ) ?? '/health',
    metricsPath = stripSpecialCharacters(process.env.TGGL_METRICS_PATH) ??
      '/metrics',
    pollingInterval = Number(
      stripSpecialCharacters(process.env.TGGL_POLLING_INTERVAL) ?? 5_000
    ),
    maxConfigAge = Number(
      stripSpecialCharacters(process.env.TGGL_MAX_CONFIG_AGE) ?? 30_000
    ),
    maxStartupTime = Number(
      stripSpecialCharacters(process.env.TGGL_MAX_STARTUP_TIME) ?? 10_000
    ),
    cors: corsOptions = {},
    logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [new winston.transports.Console()],
    }),
  }: TgglProxyConfig = {},
  app: Application = express()
) => {
  const s3EnvVars = [
    process.env.S3_ACCESS_KEY_ID,
    process.env.S3_BUCKET_NAME,
    process.env.S3_REGION,
    process.env.S3_SECRET_ACCESS_KEY,
  ]
  if (s3EnvVars.some(Boolean) && !s3EnvVars.every(Boolean)) {
    logger?.error(
      'S3_ACCESS_KEY_ID, S3_BUCKET_NAME, S3_REGION, and S3_SECRET_ACCESS_KEY must all be set for S3 storage to work'
    )
  }

  const storages =
    rawStorages ??
    ([
      process.env.POSTGRES_URL
        ? new PostgresStorage(process.env.POSTGRES_URL)
        : null,
      process.env.REDIS_URL ? new RedisStorage(process.env.REDIS_URL) : null,
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY &&
      process.env.S3_BUCKET_NAME
        ? new S3Storage({
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            bucketName: process.env.S3_BUCKET_NAME,
            region: process.env.S3_REGION,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          })
        : null,
    ].filter(Boolean) as Storage[])

  app.on('close', (done: any) => {
    done(async () => {
      for (const storage of storages) {
        try {
          await storage.close?.()?.catch(() => null)
        } catch (error) {
          // Ignore
        }
        logger.info(`${storage.name} storage closed`)
      }
    })
  })

  const client = new TgglLocalClient(apiKey as string, {
    url,
    log: false,
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

  const updateConfig = async (
    previousConfig: TgglConfig | null,
    newConfig: TgglConfig,
    syncDate: Date,
    source?: string
  ) => {
    client.setConfig(newConfig)

    if (previousConfig) {
      const newFlags: string[] = []
      const deletedFlags: string[] = []
      const updatedFlags: string[] = []

      for (const [slug, flag] of newConfig) {
        if (!previousConfig.has(slug)) {
          newFlags.push(slug)
        } else if (
          JSON.stringify(previousConfig.get(slug)) !== JSON.stringify(flag)
        ) {
          updatedFlags.push(slug)
        }
      }

      for (const slug of previousConfig.keys()) {
        if (!newConfig.has(slug)) {
          deletedFlags.push(slug)
        }
      }

      if (newFlags.length || deletedFlags.length || updatedFlags.length) {
        logger?.info('Config has changed', {
          newFlags,
          deletedFlags,
          updatedFlags,
        })
      } else {
        logger?.info('Config has not changed')
      }
    }

    if (storages.length > (source ? 1 : 0)) {
      logger?.info('Saving config and sync date to storage')

      for (const storage of storages) {
        if (source === storage.name) {
          continue
        }

        const result = await storage
          .setConfig(JSON.stringify([...newConfig.values()]), syncDate)
          .then(() => ({ success: true as const }))
          .catch((error) => ({ success: false as const, error }))

        if (result.success) {
          logger?.info(
            `Successfully saved config and sync date to ${storage.name}`
          )
        } else {
          logger?.error(
            `Failed to save config and sync date to ${storage.name}`,
            {
              error: formatError(result.error),
            }
          )
        }
      }
    } else if (!storages.length) {
      logger?.info('No storage provided to save config and sync date')
    }
  }

  let lastSuccessfulSync: Date | null = null
  const fetchConfig = async (): Promise<boolean> => {
    const previousConfig: TgglConfig | null = lastSuccessfulSync
      ? new Map(client.getConfig())
      : null
    const result = await client
      .fetchConfig()
      .then((config) => ({ success: true as const, config }))
      .catch((error) => ({ success: false as const, error }))

    if (result.success) {
      logger?.info('Successfully fetched config from API')
      lastSuccessfulSync = new Date()

      await updateConfig(previousConfig, result.config, lastSuccessfulSync)
      return true
    }

    logger?.error('Failed to fetch config from API', {
      error: formatError(result.error),
    })

    for (const storage of storages) {
      logger?.info(`Falling back to ${storage.name} storage`)

      const config = await storage
        .getConfig()
        .then((config) => {
          try {
            const c = new Map()

            for (const flag of JSON.parse(config.config)) {
              c.set(flag.slug, flag)
            }

            return {
              success: true as const,
              config: { config: c, syncDate: config.syncDate },
            }
          } catch (error) {
            throw new Error(
              `Successfully fetched config from ${storage.name} but could not parse the value`
            )
          }
        })
        .catch((error) => ({ success: false as const, error }))

      if (config.success) {
        if (
          !lastSuccessfulSync ||
          config.config.syncDate > lastSuccessfulSync
        ) {
          logger?.info(
            `Successfully fetched a more recent config from ${storage.name} compared to last successful sync`,
            {
              lastSuccessfulSync,
              storageSyncDate: config.config.syncDate,
            }
          )
          lastSuccessfulSync = new Date(config.config.syncDate)

          await updateConfig(
            previousConfig,
            config.config.config,
            config.config.syncDate,
            storage.name
          )
          return true
        } else {
          logger?.error(
            `Successfully fetched config from ${storage.name} but that config is less recent than last successful sync`,
            {
              lastSuccessfulSync,
              storageSyncDate: config.config.syncDate,
            }
          )
        }
      } else {
        logger?.error(`Failed to fetch config from ${storage.name}`, {
          error: formatError(config.error),
        })
      }
    }

    if (storages?.length) {
      logger?.error(
        `Failed to fetch config from API and all provided storages, will keep polling`
      )
    } else {
      logger?.error(`No storage provided to fall back to, will keep polling`, {
        configAge: lastSuccessfulSync
          ? Date.now() - lastSuccessfulSync.getTime()
          : null,
      })
    }

    return false
  }

  let ready = new Promise<void>(async (resolve) => {
    if (!storages?.length) {
      logger?.info(
        'No storage provided, only relying on the API. Providing a storage allows for faster startup times and more redundancy in case of network failure.'
      )
    } else {
      logger?.info('Storage provided', {
        storage: storages.map((storage) => storage.name),
      })
    }

    const startedAt = Date.now()
    const RETRY_INTERVAL = 500
    let tries = 0

    logger?.info(
      'Initial config syncing started. All requests will be pending until a successful sync or after the allowed startup time has passed.',
      { maxStartupTime }
    )

    while (Date.now() - startedAt < maxStartupTime) {
      const success = await fetchConfig()
      tries++

      if (success) {
        logger?.info(
          'Initial config synced successfully, ready to serve requests',
          {
            startupTime: Date.now() - startedAt,
            numberOfTries: tries,
          }
        )
        return resolve()
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL))
    }

    logger?.info(
      'Could not sync config within the allowed startup time. Starting to serve requests using an empty config (no flags), and polling until the config can be synced.',
      { maxStartupTime, numberOfTries: tries }
    )
    return resolve()
  })

  let lastTimeout: NodeJS.Timeout | null = null

  const poll = async () => {
    await fetchConfig()
    lastTimeout = setTimeout(poll, pollingInterval)
  }

  app.on('close', () => {
    if (lastTimeout) {
      clearTimeout(lastTimeout)
    }
  })

  ready.then(async () => {
    logger?.info('Start polling for config updates', { pollingInterval })
    await poll()
  })

  const checkApiKeyMiddleware: RequestHandler = (req, res, next) => {
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

    next()
  }

  app.post(path, checkApiKeyMiddleware, async (req, res) => {
    await ready

    const defaultContext = {
      timestamp: Date.now(),
      ip: requestIp.getClientIp(req),
      referer: req.headers.referer,
    }

    if (Array.isArray(req.body)) {
      res.send(
        req.body.map((context) =>
          client.getActiveFlags({ ...defaultContext, ...context })
        )
      )
    } else {
      res.send(client.getActiveFlags({ ...defaultContext, ...req.body }))
    }
  })

  if (healthCheckPath && healthCheckPath !== 'false') {
    app.get(healthCheckPath, async (req, res) => {
      await ready

      const configAge = lastSuccessfulSync
        ? Date.now() - lastSuccessfulSync.getTime()
        : null

      res.setHeader('Cache-Control', 'no-cache')

      if (maxConfigAge > 0 && (!configAge || configAge > maxConfigAge)) {
        res
          .status(503)
          .send(
            configAge
              ? 'Last successful config sync is too old'
              : 'No successful config sync yet'
          )
        return
      }

      res.status(200).send('OK')
    })
  }

  if (metricsPath && metricsPath !== 'false') {
    new promClient.Gauge({
      name: 'config_age_milliseconds',
      help: 'The age in milliseconds of the last successful config sync. 999_999_999 means that the config was never successfully synced.',
      collect() {
        if (lastSuccessfulSync !== null) {
          this.set(Date.now() - lastSuccessfulSync.getTime())
        } else {
          this.set(999_999_999)
        }
      },
    })

    app.get(metricsPath, async (req, res) => {
      try {
        res.set('Content-Type', promClient.register.contentType)
        res.end(await promClient.register.metrics())
      } catch (err) {
        res.status(500).end(err)
      }
    })
  }

  if (reportPath && reportPath !== 'false') {
    const aggregator = new TgglReporting({
      apiKey: apiKey as string,
      reportInterval: 5000,
    })

    app.on('close', () => {
      aggregator.disable()
    })

    app.post(reportPath, checkApiKeyMiddleware, async (req, res) => {
      aggregator.mergeReport(req.body)
      res.send({ success: true })
    })
  }

  if (configPath && configPath !== 'false') {
    app.get(configPath, checkApiKeyMiddleware, async (req, res) => {
      await ready

      res.send([...client.getConfig().values()])
    })
  }

  app.use((req, res) => {
    res.status(404)
    res.json({ error: 'Not found' })
  })

  return app
}
