// Command line entry point.
//   node src/cli.ts resolve <did> [--version-id N] [--esplora <url> --network testnet|mainnet]
//   node src/cli.ts demo        (regtest lifecycle; needs DID_BTC_RPC_USER / DID_BTC_RPC_PASSWORD)
import { parseArgs } from 'node:util';
import { resolve } from './resolver.ts';
import { rpcFromEnv, runLifecycle } from './regtest.ts';
import { EsploraSource } from './sources.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'version-id': { type: 'string' },
    'version-time': { type: 'string' },
    esplora: { type: 'string' },
    network: { type: 'string', default: 'testnet' },
  },
});
const [command, did] = positionals;

if (command === 'resolve' && did) {
  if (values.network !== 'testnet' && values.network !== 'regtest') throw new Error('network must be testnet or regtest for this local demo');
  const source = values.esplora ? new EsploraSource(values.esplora, values.network) : rpcFromEnv();
  const result = await resolve(did, source, { versionId: values['version-id'], versionTime: values['version-time'] });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.didResolutionMetadata.error ? 1 : 0;
} else if (command === 'demo') {
  const lifecycle = await runLifecycle(rpcFromEnv(), (s) => console.error(s));
  console.log(JSON.stringify(lifecycle, null, 2));
} else {
  console.error('usage: node src/cli.ts resolve <did> [--version-id N | --version-time T] [--esplora URL --network testnet]\n       node src/cli.ts demo');
  process.exitCode = 2;
}
