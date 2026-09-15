import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { apply, type HostConnectionLike, type HostContextLike } from '../src/index.js'

interface TestHostContext extends HostContextLike {
  hasInjected(service: string): boolean
}

function createHost(connection: HostConnectionLike, extraServices: Record<string, unknown> = {}): TestHostContext {
  const services = new Map<string, unknown>([
    ['connection', connection],
    ...Object.entries(extraServices),
  ])
  const injected = new Set<string>()

  const host: HostContextLike = {
    inject(requiredServices, callback) {
      requiredServices.forEach((service) => injected.add(service))
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

  return Object.assign(host, {
    hasInjected(service: string): boolean {
      return injected.has(service)
    },
  })
}

function readProfilePatch(): string {
  return readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
}

describe('host RPC compatibility', () => {
  it('passes the rc2 loopback authority policy when registering the channel', () => {
    const handle = vi.fn((_channel, _handler, options?: { authority: string }) => {
      // Mirrors the eager property access in dsh-client-connection 0.1.1-rc.2.
      expect(options?.authority).toBe('loopback')
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

  it('declares webServer before reading the connection RPC service on dsh-v0.1.5', () => {
    const host = createHost({
      rpc: {
        handle: vi.fn(() => {
          expect(host.hasInjected('webServer')).toBe(true)
          return async () => {}
        }),
      },
    })

    apply(host)
  })

  it('registers the file viewer route directly when dsh-v0.1.5 exposes webServer and request rejection', () => {
    const legacyHandle = vi.fn(() => async () => {})
    const requestRejection = vi.fn(() => undefined)
    const register = vi.fn(() => async () => {})

    apply(createHost({
      requestRejection,
      rpc: { handle: legacyHandle },
    }, {
      webServer: { register },
    }))

    expect(legacyHandle).not.toHaveBeenCalled()
    expect(register).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'prefix',
      path: '/fileviewer',
      handler: expect.any(Function),
    }))
  })

  it('profile patch injects webServer for connection-owned RPC registration', () => {
    expect(readProfilePatch()).toMatch(/inject:\s*\n\s*-\s*webServer/)
  })
})
