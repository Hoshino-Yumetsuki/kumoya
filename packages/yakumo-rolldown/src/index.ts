import { Context, z } from 'cordis'
import {} from 'yakumo'
import { load } from 'tsconfig-utils'
import kumoya from 'kumoya'
import type { RolldownOptions } from 'rolldown'

declare module 'yakumo' {
  interface Events {
    'yakumo/rolldown'(path: string, options: RolldownOptions, next: () => Promise<void>): Promise<void>
  }
}

export const inject = ['yakumo']

export interface Config {
  minify: boolean
}

export const Config: z<Config> = z.object({
  minify: z.boolean()
})

export function apply(ctx: Context, config: Config) {
  ctx.register(
    'rolldown',
    async () => {
      const paths = ctx.yakumo.locate(ctx.yakumo.argv._)
      await Promise.all(
        paths.map(async (path) => {
          const cwd = ctx.yakumo.cwd + path
          const tsconfig = await load(cwd).catch(() => null)
          if (!tsconfig) return
          const options: RolldownOptions = {}
          const minify = (ctx.yakumo.argv as any).minify ?? config.minify
          await ctx.waterfall('yakumo/rolldown', path, options, async () => {
            await kumoya(cwd, ctx.yakumo.workspaces[path] as any, tsconfig, {
              minify,
              ...options
            })
          })
        })
      )
    },
    {
      boolean: ['minify']
    }
  )
}
