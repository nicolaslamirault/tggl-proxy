import {createApp} from "./index";
import fs from 'fs/promises'

createApp({
  storage: {
    getConfig(): Promise<string | null> {
      return fs.readFile('./config.json', 'utf8').catch(() => null)
    },
    setConfig(config: string): Promise<void> {
      return fs.writeFile('./config.json', config)
    }
  },
}).listen(3000, () => console.log('Tggl proxy ready!'))
