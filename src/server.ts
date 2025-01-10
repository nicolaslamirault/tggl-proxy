import { createApp } from './index'
import winston from 'winston'

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
})

const app = createApp({ logger })
const server = app.listen(3000, () => null)

process.on('SIGINT', () => {
  process.kill(process.pid, 'SIGTERM')
})

process.on('SIGTERM', () => {
  server.close(() => {
    logger.info('Server closed')
    const promises: Promise<void>[] = []
    app.emit('close', (cb: () => Promise<void>) => promises.push(cb()))
    Promise.all(promises).then(() => {
      process.exit(0)
    })
  })
})
