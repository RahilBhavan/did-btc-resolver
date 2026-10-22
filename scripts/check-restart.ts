// Compare node-backed resolution with the lifecycle receipt after restarting the same regtest chain.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rpcFromEnv, type Lifecycle } from '../src/regtest.ts';
import { resolve } from '../src/resolver.ts';
import { checkUsage } from './usage.ts';

const USAGE = `Usage: node scripts/check-restart.ts <lifecycle.json>
  Check that a restarted regtest node resolves the DID in <lifecycle.json> (output of
  \`npm run demo\`) exactly as recorded. Called by scripts/run-regtest.sh.
  Needs DID_BTC_RPC_URL, DID_BTC_RPC_USER and DID_BTC_RPC_PASSWORD.`;
const [file] = checkUsage(USAGE);
if (!file) {
  console.error(`error: missing <lifecycle.json>\n\n${USAGE}`);
  process.exit(2);
}
const lifecycle: Lifecycle = JSON.parse(readFileSync(file, 'utf8'));
const rpc = rpcFromEnv();
assert.equal((await rpc.call<{ chain: string }>('getblockchaininfo')).chain, 'regtest');
const latest = await resolve(lifecycle.did, rpc);
const saved = lifecycle.steps.find((s) => s.step === 'deactivate')?.resolution;
assert.ok(saved);
assert.deepEqual(latest, saved);
const historical = await resolve(lifecycle.did, rpc, { versionId: '1' });
assert.deepEqual(historical, lifecycle.steps.find((s) => s.step === 'resolve version 1 after deactivation')?.resolution);
assert.equal((await resolve(lifecycle.did, rpc, { versionId: '0' })).didResolutionMetadata.error, undefined);
console.error('Restart proof: latest and historical resolutions match the pre-restart receipt');
