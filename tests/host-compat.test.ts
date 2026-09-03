import { describe, expect, it, vi } from 'vitest'
import { apply, type HostConnectionLike, type HostContextLike } from '../src/index.js'

function createHost(connection: HostConnectionLike): HostContextLike {
  const services = new Map<string, unknown>([['connection', connection]])

  const host: HostContextLike = {
    inject(_services, callback) {
      void callback(host)
    },
    effect(effect) {
      void effect()
    },
    get(name) {
      return services.get(name) as never
    },
    provide(name, value) {
      services.set(name, value)
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }

  return host
}

describe('host RPC compatibility', () => {
  it('passes the rc2 loopback authority policy when registering the channel', () => {
    const handle = vi.fn((_channel, _handler, options: { authority: string }) => {
      // Mirrors the eager property access in dsh-client-connection 0.1.1-rc.2.
      expect(options.authority).toBe('loopback')
      return async () => {}
    })

    apply(createHost({ rpc: { handle } }))

    expect(handle).toHaveBeenCalledOnce()
    expect(handle).toHaveBeenCalledWith('/fileviewer', expect.any(Function), {
      authority: 'loopback',
    })
  })

  it('works with the dsh-v0.1.2-rc.1 two-argument handler shape', () => {
    const rc1Handle = vi.fn((_channel: string, _handler: unknown) => async () => {})

    apply(createHost({ rpc: { handle: rc1Handle } }))

    expect(rc1Handle).toHaveBeenCalledOnce()
  })
})
