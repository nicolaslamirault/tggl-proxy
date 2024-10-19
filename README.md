<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://tggl.io/tggl-io-logo-white.svg">
    <img align="center" alt="Tggl Logo" src="https://tggl.io/tggl-io-logo-black.svg" width="200rem" />
  </picture>
</p>

<h1 align="center">Tggl Proxy</h1>

<p align="center">
  The Tggl Proxy can be run on you own infrastructure to serve as a middle-man between your application and the Tggl API to manage caching and batching.
</p>

<p align="center">
  <a href="https://tggl.io/">🔗 Website</a>
  •
  <a href="https://tggl.io/developers/evaluating-flags/tggl-proxy">📚 Documentation</a>
  •
  <a href="https://www.npmjs.com/package/tggl-proxy">📦 NPM</a>
  •
  <a href="https://hub.docker.com/r/tggl/tggl-proxy">📦 Docker</a>
  •
  <a href="https://www.youtube.com/@Tggl-io">🎥 Videos</a>
</p>

## Usage

Create a `docker-compose.yml` file with the following content:

```yaml
version: '3.9'
services:
  tggl:
    image: tggl/tggl-proxy
    environment:
      TGGL_API_KEY: YOUR_SERVER_API_KEY
    ports:
      - '3000:3000'
```
Now simply run:

```bash
docker-compose up
```
