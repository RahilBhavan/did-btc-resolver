// Persist public regtest evidence only: no wallet secrets or RPC credentials.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { rpcFromEnv, runLifecycle } from '../src/regtest.ts';
import { resolve } from '../src/resolver.ts';
import { RecordingSource } from '../src/sources.ts';

const rpc = rpcFromEnv();
const lifecycle = await runLifecycle(rpc, s => console.error(s));
const recorder = new RecordingSource(rpc, 'isolated local Bitcoin Core 31.1 regtest; mined test coins only');
const latest = await resolve(lifecycle.did, recorder);
assert.equal(latest.didDocumentMetadata.deactivated, true);
for (const versionId of ['0', '1']) {
  const r = await resolve(lifecycle.did, recorder, { versionId });
  assert.equal(r.didResolutionMetadata.error, undefined);
  assert.equal(r.didDocumentMetadata.versionId, versionId);
}
const info = await rpc.call<{ chain: string; blocks: number }>('getblockchaininfo');
mkdirSync('results', { recursive: true });
writeFileSync('results/regtest-lifecycle.json', JSON.stringify({
  evidenceKind: 'node-confirmed regtest lifecycle, not public-network proof',
  coreVersion: '31.1', asOf: new Date().toISOString(), chain: info.chain, ...lifecycle,
}, null, 2) + '\n');
writeFileSync('test/fixtures/regtest-recording.json', JSON.stringify({ did: lifecycle.did, recording: recorder.recording }, null, 2) + '\n');
console.log(`Recorded ${lifecycle.did}; blocks ${info.blocks}; no mainnet activity`);
