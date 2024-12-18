import { Pool, PoolClient } from 'pg'
import { Storage } from '../types'

export type PostgresErrorCode =
  | 'FAILED_TO_CONNECT'
  | 'FAILED_TO_CREATE_TABLE'
  | 'FAILED_TO_FETCH_CONFIG'
  | 'FAILED_TO_WRITE_CONFIG'

export class PostgresError extends Error {
  private code: PostgresErrorCode
  private error: Error

  constructor(code: PostgresErrorCode, message: string, error: Error) {
    super(`${message}: ${error.message}`)
    this.name = 'PostgresError'
    this.code = code
    this.error = error
  }
}

export class PostgresStorage implements Storage {
  private client: Pool
  public name = 'Postgres'

  constructor(connectionString: string) {
    this.client = new Pool({
      connectionString,
      statement_timeout: 5_000,
      max: 1,
    })

    this.client.on('connect', async (client) => {
      await this.init(client)
    })

    this.client.on('error', (error) => {
      console.error(
        'error: Postgres error, will try to reconnect: ' + error.message
      )
    })
  }

  private async init(client: PoolClient) {
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS tggl_config (key TEXT PRIMARY KEY, value TEXT);`
      )
    } catch (error) {
      throw new PostgresError(
        'FAILED_TO_CREATE_TABLE',
        'Failed to create tggl_config table',
        error as Error
      )
    }
  }

  async getConfig() {
    try {
      const result = await this.client.query(
        `SELECT "key", "value"
         FROM "tggl_config"
         WHERE "key" IN ('flags', 'syncDate');`
      )

      const response = {
        config: null as string | null,
        syncDate: new Date(),
      }

      for (const { key, value } of result.rows) {
        if (key === 'flags') {
          response.config = value
        }
        if (key === 'syncDate' && value !== null && value.match(/^[0-9]+$/)) {
          response.syncDate = new Date(Number(value))
        }
      }

      if (response.config === null) {
        throw new Error('Successfully connected, but no config found')
      }

      return response as {
        config: string
        syncDate: Date
      }
    } catch (error) {
      throw new PostgresError(
        'FAILED_TO_FETCH_CONFIG',
        'Failed to fetch config from Postgres',
        error as Error
      )
    }
  }

  async setConfig(config: string, syncDate: Date) {
    try {
      await this.client.query('BEGIN;')
      const result = await this.client.query(
        `SELECT value FROM "tggl_config" WHERE "key" = 'syncDate' FOR UPDATE;`
      )

      if (
        result.rows.length &&
        result.rows[0].value !== null &&
        result.rows[0].value.match(/^[0-9]+$/) &&
        syncDate.getTime() <= Number(result.rows[0].value)
      ) {
        await this.client.query('COMMIT;')
        return
      }

      await this.client.query(
        `INSERT INTO "tggl_config" ("key", "value") VALUES ( 'flags', $1), ( 'syncDate', $2) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";`,
        [config, String(syncDate.getTime())]
      )
      await this.client.query('COMMIT;')
    } catch (error) {
      throw new PostgresError(
        'FAILED_TO_WRITE_CONFIG',
        'Failed to write config to Postgres',
        error as Error
      )
    }
  }

  async close() {
    await this.client.end()
  }
}
