import { Context } from 'yakumo'
import { load } from 'tsconfig-utils'
import kumoya from 'kumoya'

export const inject = ['yakumo']

export function apply(ctx: Context) {
    ctx.register('rolldown', async () => {
        const paths = ctx.yakumo.locate(ctx.yakumo.argv._)
        await Promise.all(
            paths.map(async (path) => {
                const cwd = ctx.yakumo.cwd + path
                const tsconfig = await load(cwd).catch(() => null)
                if (!tsconfig) return
                await kumoya(cwd, ctx.yakumo.workspaces[path] as any, tsconfig)
            })
        )
    })
}
