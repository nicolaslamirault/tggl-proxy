import { createApp } from './index'
import { PostgresStorage } from './storage/pg'
import winston from 'winston'

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
  storages: process.env.POSTGRES_URL
    ? [new PostgresStorage(process.env.POSTGRES_URL)]
    : [],
  logger,
}).listen(3000, () => null)
