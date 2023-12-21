import {createApp} from "./index";
import fs from 'fs/promises'
import { Client } from 'pg'
import { createClient } from 'redis';

const POSTGRES_URL = process.env.POSTGRES_URL;
const REDIS_URL = process.env.REDIS_URL;

const pgClient = POSTGRES_URL ? new Client({
  connectionString: POSTGRES_URL,
}) : null

let pgReady = false

const initPostgres = async () => {
  if (!pgClient || pgReady) {
    return
  }

  pgReady = true

  try {
    await pgClient.connect()
  } catch (error) {
    console.error(`Failed to connect to Postgres: ${error}`)
    return
  }

  try {
    await pgClient.query(`CREATE TABLE IF NOT EXISTS tggl_config (key TEXT PRIMARY KEY, value TEXT);`)
  } catch (error) {
    console.error(`Failed to create tggl_config table: ${error}`)
  }
}

const redisClient = REDIS_URL ? createClient({
  url: REDIS_URL,
}) : null
let redisReady = false

const initRedis = async () => {
  if (!redisClient || redisReady) {
    return
  }

  redisReady = true

  try {
    await redisClient.connect();
  } catch (error) {
    console.error(`Failed to connect to redis: ${error}`)
    return
  }
}

createApp({
  storage: {
    async getConfig(): Promise<string | null> {
      if (POSTGRES_URL) {
        try {
          await initPostgres()
          const config = await pgClient!.query(`SELECT "value" FROM "tggl_config" WHERE "key" = 'flags';`)

          const value = config.rows[0]?.value ?? null;

          console.log(`Fetched config from Postgres${value ? '' : ' (nothing yet)'}`)

          return value
        } catch (error) {
          console.error(`Failed to fetch config from Postgres: ${error}`)
        }
      }

      if (REDIS_URL) {
        try {
          await initRedis()
          const value = await redisClient!.get('tggl_flags');

          console.log(`Fetched config from redis${value ? '' : ' (nothing yet)'}`)

          return value
        } catch (error) {
          console.error(`Failed to fetch config from redis: ${error}`)
        }
      }

      return fs.readFile('./config.json', 'utf8').catch(() => null)
    },
    async setConfig(config: string): Promise<void> {
      if (POSTGRES_URL) {
        try {
          await initPostgres()
          await pgClient!.query(`INSERT INTO "tggl_config" ("key", "value") VALUES ( 'flags', $1) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";`, [config])
          console.log(`Wrote config to Postgres`)
        } catch (error) {
          console.error(`Failed to write config to Postgres: ${error}`)
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
    }
  },
}).listen(3000, () => console.log('Tggl proxy ready!'))
