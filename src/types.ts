import { CorsOptions } from 'cors'
import { Logger } from 'winston'

export interface Storage {
  name: string
  getConfig(): Promise<{ config: string; syncDate: Date }>
  setConfig(config: string, syncDate: Date): Promise<void>
}

export type TgglProxyConfig = {
  url?: string
  apiKey?: string
  clientApiKeys?: string[]
  rejectUnauthorized?: boolean
  storages?: Storage[]
  path?: string
  reportPath?: string
  healthCheckPath?: string
  metricsPath?: string
  pollingInterval?: number
  maxConfigAge?: number
  maxStartupTime?: number
  cors?: CorsOptions
  logger?: Logger
}
