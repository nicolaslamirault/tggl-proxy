import { createApp } from './index'
import fs from 'fs/promises'
import { createClient } from 'redis'
import { PostgresStorage } from './storage/pg'
import winston from 'winston'

const REDIS_URL = process.env.REDIS_URL

const pgClient = new PostgresStorage(process.env.POSTGRES_URL)

const redisClient = REDIS_URL
  ? createClient({
      url: REDIS_URL,
    })
  : null
let redisReady = false

const initRedis = async () => {
  if (!redisClient || redisReady) {
    return
  }

  redisReady = true

  try {
    await redisClient.connect()
  } catch (error) {
    console.error(`Failed to connect to redis: ${error}`)
    return
  }
}

const logger = winston.createLogger({
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
})

createApp({
  storage: {
    async getConfig(): Promise<string | null> {
      if (pgClient.enabled()) {
        try {
          const value = await pgClient.getConfig()

          logger.info(
            `Fetched config from Postgres${value ? '' : ' (nothing yet)'}`
          )

          return value
        } catch (error) {
          logger.error(`Failed to fetch config from Postgres: ${error}`)
        }
      }

      if (REDIS_URL) {
        try {
          await initRedis()
          const value = await redisClient!.get('tggl_flags')

          logger.info(
            `Fetched config from Redis${value ? '' : ' (nothing yet)'}`
          )

          return value
        } catch (error) {
          logger.error(`Failed to fetch config from Redis: ${error}`)
        }
      }

      return fs
        .readFile('./config.json', 'utf8')
        .then((value) => {
          logger.info(
            `Fetched config from file${value ? '' : ' (nothing yet)'}`
          )
          return value
        })
        .catch((error) => {
          logger.error(`Failed to fetch config from file: ${error}`)
          return null
        })
    },
    async setConfig(config: string): Promise<void> {
      if (pgClient.enabled()) {
        try {
          await pgClient.setConfig(config)
          logger.info(`Saved config in Postgres`)
        } catch (error) {
          logger.error(String(error))
        }
      }

      if (REDIS_URL) {
        try {
          await initRedis()
          await redisClient!.set('tggl_flags', config)
          logger.info(`Saved config in Redis`)
        } catch (error) {
          logger.error(`Failed to save config in Redis: ${error}`)
        }
      }

      await fs
        .writeFile('./config.json', config)
        .then(() => logger.info(`Saved config in file`))
        .catch((error) =>
          logger.error(`Failed to save config in file: ${error}`)
        )
    },
  },
  logger,
}).listen(3000, () => logger.info('Tggl proxy ready', { port: 3000 }))
