import { CorsOptions } from 'cors'
import { Logger } from 'winston'

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
  metricsPath?: string
  pollingInterval?: number
  cors?: CorsOptions
  logger?: Logger
}
