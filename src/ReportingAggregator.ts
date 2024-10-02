import { apiCall } from './apiCall'

export class ReportingAggregator {
  private apiKey: string
  private url: string
  private flagsToReport: Record<
    string,
    Record<
      string,
      Map<
        string,
        {
          active: boolean
          value?: any
          default?: any
          count: number
        }
      >
    >
  > = {}
  private receivedPropertiesToReport: Record<string, [number, number]> = {}
  private receivedValuesToReport: Record<
    string,
    Record<string, string | null>
  > = {}

  constructor({ apiKey, url }: { apiKey: string; url?: string }) {
    this.apiKey = apiKey
    this.url = url ?? 'https://api.tggl.io/report'

    this.sendReport()
  }

  private async sendReport() {
    try {
      const payload: Record<string, any> = {}

      if (Object.keys(this.flagsToReport).length) {
        const flagsToReport = { ...this.flagsToReport }
        this.flagsToReport = {}

        payload.clients = []

        for (const [clientId, flags] of Object.entries(flagsToReport)) {
          payload.clients.push({
            id: clientId || undefined,
            flags: Object.entries(flags).reduce(
              (acc, [key, value]) => {
                acc[key] = [...value.values()]
                return acc
              },
              {} as Record<
                string,
                {
                  active: boolean
                  value?: any
                  default?: any
                  count: number
                }[]
              >
            ),
          })
        }
      }

      if (Object.keys(this.receivedPropertiesToReport).length) {
        const receivedProperties = this.receivedPropertiesToReport
        this.receivedPropertiesToReport = {}

        payload.receivedProperties = receivedProperties
      }

      if (Object.keys(this.receivedValuesToReport).length) {
        const receivedValues = this.receivedValuesToReport
        this.receivedValuesToReport = {}

        const data = Object.keys(receivedValues).reduce((acc, key) => {
          for (const value of Object.keys(receivedValues[key])) {
            const label = receivedValues[key][value]

            if (label) {
              acc.push([key, value, label])
            } else {
              acc.push([key, value])
            }
          }

          return acc
        }, [] as string[][])

        const pageSize = 2000

        payload.receivedValues = data.slice(0, pageSize).reduce((acc, cur) => {
          acc[cur[0]] ??= []
          acc[cur[0]].push(cur.slice(1).map((v) => v.slice(0, 240)))
          return acc
        }, {} as Record<string, string[][]>)

        for (let i = pageSize; i < data.length; i += pageSize) {
          await apiCall({
            url: this.url,
            apiKey: this.apiKey,
            method: 'post',
            body: {
              receivedValues: data.slice(i, i + pageSize).reduce((acc, cur) => {
                acc[cur[0]] ??= []
                acc[cur[0]].push(cur.slice(1).map((v) => v.slice(0, 240)))
                return acc
              }, {} as Record<string, string[][]>),
            },
          })
        }
      }

      if (Object.keys(payload).length) {
        await apiCall({
          url: this.url,
          apiKey: this.apiKey,
          method: 'post',
          body: payload,
        })
      }
    } catch (error) {
      // Do nothing
    }

    setTimeout(() => {
      this.sendReport()
    }, 5000)
  }

  ingestReport(report: any): void {
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      return
    }

    try {
      if (report.receivedProperties) {
        for (const [key, value] of Object.entries(report.receivedProperties)) {
          const [min, max] = value as [number, number]

          if (this.receivedPropertiesToReport[key]) {
            this.receivedPropertiesToReport[key][0] = Math.min(
              this.receivedPropertiesToReport[key][0],
              min
            )
            this.receivedPropertiesToReport[key][1] = Math.max(
              this.receivedPropertiesToReport[key][1],
              max
            )
          } else {
            this.receivedPropertiesToReport[key] = [min, max]
          }
        }
      }

      if (report.receivedValues) {
        for (const [key, values] of Object.entries(report.receivedValues)) {
          for (const val of values as Array<[string] | [string, string]>) {
            const [value, label] = val
            this.receivedValuesToReport[key] ??= {}
            this.receivedValuesToReport[key][value] =
              label ?? this.receivedValuesToReport[key][value] ?? null
          }
        }
      }

      if (report.clients) {
        for (const client of report.clients) {
          const clientId = client.id ?? ''
          this.flagsToReport[clientId] ??= {}

          for (const [slug, values] of Object.entries(client.flags)) {
            for (const data of values as {
              active: boolean
              value?: any
              default?: any
              count?: number
            }[]) {
              const key = `${data.active ? '1' : '0'}${JSON.stringify(
                data.value ?? null
              )}${JSON.stringify(data.default ?? null)}`

              this.flagsToReport[clientId][slug] ??= new Map()

              const value =
                this.flagsToReport[clientId][slug].get(key) ??
                this.flagsToReport[clientId][slug]
                  .set(key, {
                    active: data.active,
                    value: data.value ?? null,
                    default: data.default ?? null,
                    count: 0,
                  })
                  .get(key)!

              value.count += data.count ?? 1
            }
          }
        }
      }
    } catch (error) {
      // Do nothing
    }
  }
}
