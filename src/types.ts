import { CorsOptions } from 'cors'
import { Logger } from 'winston'

export interface Storage {
  /**
   * The name of the storage, used for logging and debugging.
   */
  name: string

  /**
   * This method is called to retrieve the config from the storage.
   * If the storage is unavailable, or if the storage is empty, this method should throw an Error
   */
  getConfig(): Promise<{ config: string; syncDate: Date }>

  /**
   * This method is called to set the config in the storage.
   * It should store both the config and the syncDate to be retrieved by the getConfig method.
   * If the storage is unavailable this method should throw an Error
   */
  setConfig(config: string, syncDate: Date): Promise<void>

  /**
   * This method is called to close the storage connection.
   */
  close?(): Promise<void> | void
}

export type TgglProxyConfig = {
  url?: string
  apiKey?: string
  clientApiKeys?: string[]
  rejectUnauthorized?: boolean
  storages?: Storage[]
  path?: string
  reportPath?: string
  configPath?: string
  healthCheckPath?: string
  metricsPath?: string
  pollingInterval?: number
  maxConfigAge?: number
  maxStartupTime?: number
  cors?: CorsOptions
  logger?: Logger
}
