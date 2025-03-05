import { Context, z } from 'cordis'
import {} from 'yakumo'
import { load } from 'tsconfig-utils'
import kumoya from 'kumoya'

export const inject = ['yakumo']

export interface Config {
  minify: boolean
}

export const Config: z<Config> = z.object({
  minify: z.boolean(),
})

export function apply(ctx: Context, config: Config) {
  ctx.register('rolldown', async () => {
    const paths = ctx.yakumo.locate(ctx.yakumo.argv._)
    await Promise.all(paths.map(async (path) => {
      const cwd = ctx.yakumo.cwd + path
      const tsconfig = await load(cwd).catch(() => null)
      if (!tsconfig) return
      await kumoya(cwd, ctx.yakumo.workspaces[path] as any, tsconfig, {
        minify: (ctx.yakumo.argv as any).minify ?? config.minify,
      })
    }))
  }, {
    boolean: ['minify'],
  })
}