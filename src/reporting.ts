import Case from 'case'
import fetch from 'node-fetch'

export class Reporting {
  private receivedProperties: Record<string, [number, number]> = {}
  private receivedValues: Record<string, Record<string, string | null>> = {}

  constructor(private apiKey: string) {
    setTimeout(() => this.sendReporting(), 5000)
  }

  reportContext(context: any) {
    try {
      const now = Math.round(Date.now() / 1000)

      for (const key of Object.keys(context)) {
        if (this.receivedProperties[key]) {
          this.receivedProperties[key][1] = now
        } else {
          this.receivedProperties[key] = [now, now]
        }

        if (typeof context[key] === 'string' && context[key]) {
          const constantCaseKey = Case.constant(key).replace(/_I_D$/, '_ID')
          const labelKeyTarget = constantCaseKey.endsWith('_ID')
            ? constantCaseKey.replace(/_ID$/, '_NAME')
            : null
          const labelKey = labelKeyTarget
            ? Object.keys(context).find(
                (k) => Case.constant(k) === labelKeyTarget
              ) ?? null
            : null

          this.receivedValues[key] ??= {}
          this.receivedValues[key][context[key]] =
            labelKey && typeof context[labelKey] === 'string'
              ? context[labelKey] || null
              : null
        }
      }
    } catch (error) {
      console.error('Failed to report context', error)
    }
  }

  private async sendReporting() {
    const startedAt = Date.now()

    const receivedProperties = this.receivedProperties
    const receivedValues = this.receivedValues

    this.receivedProperties = {}
    this.receivedValues = {}

    if (Object.keys(receivedProperties).length) {
      await fetch('http://localhost:3008/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tggl-api-key': this.apiKey,
        },
        body: JSON.stringify({
          receivedProperties,
        }),
      }).catch((error) => console.error('Failed to report properties', error))
    }

    try {
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

      for (let i = 0; i < data.length; i += 2000) {
        await fetch('http://localhost:3008/report', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tggl-api-key': this.apiKey,
          },
          body: JSON.stringify({
            receivedValues: data.slice(i, i + 2000).reduce((acc, cur) => {
              acc[cur[0]] ??= []
              acc[cur[0]].push(cur.slice(1).map((v) => v.slice(0, 240)))
              return acc
            }, {} as Record<string, string[][]>),
          }),
        })
      }
    } catch (error) {
      console.error('Failed to report values', error)
    }

    const timeSpent = Date.now() - startedAt
    setTimeout(() => this.sendReporting(), Math.max(0, 5000 - timeSpent))
  }
}
