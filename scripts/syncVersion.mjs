import fs from 'fs/promises'

fs.readFile('package.json', 'utf-8').then(
  async (packageJson) => {
    const version = JSON.parse(packageJson).version

    await fs.writeFile('package.json', packageJson.replace(/-t tggl\/tggl-proxy:[0-9.]+/, `-t tggl/tggl-proxy:${version}`))
  }
)
