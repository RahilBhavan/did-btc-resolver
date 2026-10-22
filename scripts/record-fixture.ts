// Resolves a did:btc DID against a live Esplora API and saves every chain answer as a fixture,
// so tests can replay the resolution offline. Read-only: it sends no transactions.
// Usage: node scripts/record-fixture.ts <did> <esplora base url> <network> <out.json>
import { writeFileSync } from 'node:fs';
import { resolve } from '../src/resolver.ts';
import { EsploraSource, RecordingSource } from '../src/sources.ts';
import { checkUsage } from './usage.ts';

const USAGE = `Usage: node scripts/record-fixture.ts <did> <esplora base url> <network> <out.json>
  Resolve <did> read-only against an Esplora API and save every chain answer to <out.json>.`;
const [did, baseUrl, network, out] = checkUsage(USAGE);
if (!did || !baseUrl || !network || !out) {
  console.error(`error: four arguments are required\n\n${USAGE}`);
  process.exit(2);
}
const recorder = new RecordingSource(new EsploraSource(baseUrl, network as 'testnet'), baseUrl);
const result = await resolve(did, recorder);
writeFileSync(out, JSON.stringify({ did, result, recording: recorder.recording }, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
