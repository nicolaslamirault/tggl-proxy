import { createApp } from './index'
import fs from 'fs/promises'
import { createClient } from 'redis'
import { PostgresStorage } from './storage/pg'

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

createApp({
  storage: {
    async getConfig(): Promise<string | null> {
      if (pgClient.enabled()) {
        try {
          const value = await pgClient.getConfig()

          console.log(
            `Fetched config from Postgres${value ? '' : ' (nothing yet)'}`
          )

          return value
        } catch (error) {
          console.error(String(error))
        }
      }

      if (REDIS_URL) {
        try {
          await initRedis()
          const value = await redisClient!.get('tggl_flags')

          console.log(
            `Fetched config from redis${value ? '' : ' (nothing yet)'}`
          )

          return value
        } catch (error) {
          console.error(`Failed to fetch config from redis: ${error}`)
        }
      }

      return fs.readFile('./config.json', 'utf8').catch(() => null)
    },
    async setConfig(config: string): Promise<void> {
      if (pgClient.enabled()) {
        try {
          await pgClient.setConfig(config)
          console.log(`Wrote config to Postgres`)
        } catch (error) {
          console.error(String(error))
        }
      }

      if (REDIS_URL) {
        try {
          await initRedis()
          await redisClient!.set('tggl_flags', config)
          console.log(`Wrote config to redis`)
        } catch (error) {
          console.error(`Failed to write config to redis: ${error}`)
        }
      }

      await fs.writeFile('./config.json', config)
    },
  },
}).listen(3000, () => console.log('Tggl proxy ready!'))
