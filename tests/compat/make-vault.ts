// Crée un coffre avec l'app (même code que dans le navigateur) pour le test de compatibilité KeePass.
import { writeFileSync } from 'node:fs';
import '../helpers.ts';
import { Vault } from '../../src/vault.ts';
const [out, pw] = process.argv.slice(2);
const v = await Vault.create(pw);
const a = v.addEntry({ title: 'Banque', username: 'moi@exemple.fr', password: 'ancien-mdp', url: 'https://banque.fr', notes: 'note é漢', otp: 'JBSWY3DPEHPK3PXP' });
v.updateEntry(a, { title: 'Banque', username: 'moi@exemple.fr', password: 'Nouveau!Mdp#2026', url: 'https://banque.fr', notes: 'note é漢', otp: 'JBSWY3DPEHPK3PXP' });
const b = v.addEntry({ title: 'Ancien site', username: 'x', password: 'y', url: '', notes: '', otp: '' });
v.trashEntry(b);
writeFileSync(out, Buffer.from((await v.save()).data));
console.log('écrit', out);
