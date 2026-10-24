// Render docs/img/lifecycle.svg from the saved regtest receipt (results/regtest-lifecycle.json).
// Usage: node scripts/render-hero.ts [receipt.json] [out.svg]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const receiptPath = process.argv[2] ?? 'results/regtest-lifecycle.json';
const outPath = process.argv[3] ?? 'docs/img/lifecycle.svg';
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const byStep = new Map<string, any>(receipt.steps.map((s: any) => [s.step, s]));
const step = (name: string) => {
  const s = byStep.get(name);
  if (!s) throw new Error(`receipt has no step "${name}"`);
  return s;
};
const short = (txid: string) => `${txid.slice(0, 8)}…`;
const meta = (name: string) => step(name).resolution.didDocumentMetadata;
const cred = (name: string) => step(name).credential;

type Row = { label: string; detail: string; result: string; ok: boolean };
const rows: Row[] = [
  { label: 'create', detail: `tx ${short(step('create').txids[0])}`, result: `version ${meta('create').versionId}, block ${meta('create').btc.blockHeight}`, ok: true },
  { label: 'credential vc0', detail: 'signed with key-0', result: `verified: ${cred('verify credential signed with key-0').verified}`, ok: cred('verify credential signed with key-0').verified },
  { label: 'update', detail: `commit ${short(step('update').txids[0])} reveal ${short(step('update').txids[1])}`, result: `version ${meta('update').versionId}, key rotated`, ok: true },
  { label: 'credential vc0', detail: 'after key rotation', result: `verified: ${cred('verify old credential after key rotation').verified} (${cred('verify old credential after key rotation').reason})`, ok: !cred('verify old credential after key rotation').verified },
  { label: 'credential vc1', detail: 'signed with new key-0', result: `verified: ${cred('verify credential signed with the new key-0').verified}`, ok: cred('verify credential signed with the new key-0').verified },
  { label: 'deactivate', detail: `tx ${short(step('deactivate').txids[0])}`, result: `version ${meta('deactivate').versionId}, deactivated: ${meta('deactivate').deactivated}`, ok: true },
  { label: 'credential vc1', detail: 'after deactivation', result: `verified: ${cred('verify credential after deactivation').verified} (${cred('verify credential after deactivation').reason})`, ok: !cred('verify credential after deactivation').verified },
  { label: 'resolve --version-id 1', detail: 'after deactivation', result: `still resolves, version ${meta('resolve version 1 after deactivation').versionId}`, ok: true },
  { label: 'replay old reveal tx', detail: 'sent to the node', result: String(step('replay old reveal transaction').txids[0]).replace('rejected: RPC sendrawtransaction: ', 'rejected: '), ok: true },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const W = 1100;
const top = 96;
const line = 34;
const H = top + rows.length * line + 54;
const mono = "ui-monospace, 'DejaVu Sans Mono', 'Liberation Mono', Menlo, Consolas, monospace";
const out: string[] = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">`);
out.push(`<title id="t">did:btc lifecycle on Bitcoin Core 31.1 regtest</title>`);
out.push(`<desc id="d">Nine steps from the saved receipt: create, credential check, update with key rotation, old credential rejected, new credential accepted, deactivate, credential rejected after deactivation, version 1 still resolves, replayed transaction rejected by the node.</desc>`);
out.push(`<rect width="${W}" height="${H}" rx="10" fill="#111214"/>`);
out.push(`<rect x="0" y="0" width="${W}" height="48" rx="10" fill="#202124"/><rect x="0" y="30" width="${W}" height="18" fill="#202124"/>`);
out.push(`<text x="24" y="31" font-family="${mono}" font-size="15" fill="#F5F5EF">npm run demo</text>`);
out.push(`<text x="${W - 24}" y="31" text-anchor="end" font-family="${mono}" font-size="13" fill="#B7B8B1">Bitcoin Core ${esc(receipt.coreVersion)} ${esc(receipt.chain)}, saved receipt of ${esc(String(receipt.asOf).slice(0, 10))}</text>`);
out.push(`<text x="24" y="${top - 22}" font-family="${mono}" font-size="15" fill="#FFE500">${esc(receipt.did)}</text>`);
rows.forEach((r, i) => {
  const y = top + i * line + 14;
  out.push(`<text x="24" y="${y}" font-family="${mono}" font-size="15" font-weight="700" fill="#F5F5EF">${esc(r.label)}</text>`);
  out.push(`<text x="270" y="${y}" font-family="${mono}" font-size="14" fill="#B7B8B1">${esc(r.detail)}</text>`);
  out.push(`<text x="640" y="${y}" font-family="${mono}" font-size="14" fill="${r.ok ? '#B8E3BF' : '#FFB5B5'}">${esc(r.result)}</text>`);
});
out.push(`<text x="24" y="${H - 20}" font-family="${mono}" font-size="12.5" fill="#B7B8B1">Every line is the asserted outcome; verified: false and rejected are checks that must fail. Local regtest only, not public-network proof.</text>`);
out.push('</svg>');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out.join('\n') + '\n');
console.log(`wrote ${outPath}`);
