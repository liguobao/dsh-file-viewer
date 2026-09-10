import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

describe('DSH profile compatibility', () => {
  it('does not require the profile to install host-provided peers', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as PackageManifest
    const peers = Object.keys(manifest.peerDependencies ?? {})
    const requiredPeers = peers.filter(
      (peer) => manifest.peerDependenciesMeta?.[peer]?.optional !== true,
    )

    expect(requiredPeers).toEqual([])
  })

  it('explicitly accepts the latest verified DSH prerelease package graph', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as PackageManifest
    const dshPeers = Object.entries(manifest.peerDependencies ?? {}).filter(([peer]) =>
      peer.startsWith('@deepseek-ai/dsh-'),
    )

    expect(dshPeers.length).toBeGreaterThan(0)
    expect(
      dshPeers.filter(([, range]) => !range.includes('>=0.1.5-rc.1 <0.2.0')),
    ).toEqual([])
  })
})
