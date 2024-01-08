import { Client } from 'pg'

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

export class PostgresStorage {
  private client: Client | null = null
  private ready: Promise<void>

  constructor(connectionString?: string) {
    if (connectionString) {
      this.client = new Client({ connectionString })
    }

    this.ready = this.init()
    this.ready.catch(() => null)
  }

  private async init() {
    if (!this.client) {
      throw new Error('No connection string provided')
    }

    try {
      await this.client.connect()
    } catch (error) {
      throw new PostgresError(
        'FAILED_TO_CONNECT',
        'Failed to connect to Postgres',
        error as Error
      )
    }

    try {
      await this.client.query(
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

  enabled() {
    return Boolean(this.client)
  }

  async getConfig() {
    try {
      await this.ready

      const config = await this.client!.query(
        `SELECT "value"
         FROM "tggl_config"
         WHERE "key" = 'flags';`
      )

      return config.rows[0]?.value ?? null
    } catch (error) {
      throw new PostgresError(
        'FAILED_TO_FETCH_CONFIG',
        'Failed to fetch config from Postgres',
        error as Error
      )
    }
  }

  async setConfig(config: string) {
    try {
      await this.ready
      await this.client!.query(
        `INSERT INTO "tggl_config" ("key", "value") VALUES ( 'flags', $1) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";`,
        [config]
      )
    } catch (error) {
      throw new PostgresError(
        'FAILED_TO_WRITE_CONFIG',
        'Failed to write config to Postgres',
        error as Error
      )
    }
  }
}
