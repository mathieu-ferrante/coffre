// Point d'accès unique à kdbxweb (format KeePass KDBX 4).
// kdbxweb est publié en UMD/CommonJS : selon l'environnement (navigateur via esbuild,
// ou Node pour les tests), l'objet exporté se trouve soit directement dans l'espace
// de noms, soit dans sa propriété `default`.
import * as ns from 'kdbxweb';

type KdbxWeb = typeof ns;
const maybeDefault = (ns as unknown as { default?: KdbxWeb }).default;
const kdbxweb: KdbxWeb = maybeDefault && maybeDefault.Kdbx ? maybeDefault : ns;

export default kdbxweb;
