// Ouvre avec l'app un coffre créé par une autre implémentation KeePass.
import { readFileSync } from 'node:fs';
import '../helpers.ts';
import { Vault } from '../../src/vault.ts';
const [file, pw] = process.argv.slice(2);
const buf = readFileSync(file);
const v = await Vault.open(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), pw);
for (const s of v.summaries()) { const e = v.read(s.id); console.log(JSON.stringify({ group: s.group, title: e.title, user: e.username, pw: e.password, url: e.url, notes: e.notes, otp: e.otp })); }
console.log('kdf:', v.kdfDescription());
