import { Storage } from '../types'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'

export type S3ErrorCode = 'FAILED_TO_FETCH_CONFIG' | 'FAILED_TO_WRITE_CONFIG'

export class S3Error extends Error {
  private code: S3ErrorCode
  private error: Error

  constructor(code: S3ErrorCode, message: string, error: Error) {
    super(`${message}: ${error.message}`)
    this.name = 'S3Error'
    this.code = code
    this.error = error
  }
}

export class S3Storage implements Storage {
  public name = 'S3'
  private s3Client: S3Client
  private readonly bucketName?: string
  private readonly key: string

  constructor({
    accessKeyId,
    secretAccessKey,
    region,
    bucketName,
  }: {
    accessKeyId: string
    secretAccessKey: string
    region?: string
    bucketName?: string
  }) {
    this.s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
    this.bucketName = bucketName
    this.key = 'tggl_config'
  }

  async getConfig() {
    try {
      const { Body } = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: this.key,
        })
      )

      if (!Body) {
        throw new Error('Successfully connected, but no config found')
      }

      let result: any
      try {
        result = JSON.parse(await Body.transformToString())
      } catch (e) {
        throw new Error('Successfully fetched config, but got malformed JSON')
      }

      if (
        result === null ||
        typeof result !== 'object' ||
        typeof result.config !== 'string' ||
        typeof result.syncDate !== 'number'
      ) {
        throw new Error(
          'Successfully fetched config, but did not find the expected format'
        )
      }

      return {
        config: result.config,
        syncDate: new Date(result.syncDate),
      }
    } catch (error) {
      throw new S3Error(
        'FAILED_TO_FETCH_CONFIG',
        'Failed to fetch config from S3',
        error as Error
      )
    }
  }

  async setConfig(config: string, syncDate: Date) {
    try {
      const existingConfig = await this.getConfig().catch(() => null)

      if (existingConfig && syncDate <= existingConfig.syncDate) {
        return
      }

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: this.key,
          Body: JSON.stringify({ config, syncDate: syncDate.getTime() }),
        })
      )
    } catch (error) {
      throw new S3Error(
        'FAILED_TO_WRITE_CONFIG',
        'Failed to write config to S3',
        error as Error
      )
    }
  }

  async close() {
    this.s3Client.destroy()
  }
}
