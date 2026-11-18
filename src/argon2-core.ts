// Calcul Argon2 pur (hash-wasm), utilisable dans le Worker comme dans Node.
import * as hashWasmNs from 'hash-wasm';

type HashWasm = typeof hashWasmNs;
const hwDefault = (hashWasmNs as unknown as { default?: HashWasm }).default;
const hashWasm: HashWasm = hwDefault && typeof hwDefault.argon2id === 'function' ? hwDefault : hashWasmNs;

export interface Argon2Request {
  password: ArrayBuffer;
  salt: ArrayBuffer;
  memoryKiB: number;
  iterations: number;
  length: number;
  parallelism: number;
  type: number; // 0 = Argon2d, 2 = Argon2id
  version: number;
}

export async function computeArgon2(req: Argon2Request): Promise<ArrayBuffer> {
  if (req.version !== 0x13) {
    throw new Error('Version Argon2 non prise en charge (seule la 1.3 est gérée).');
  }
  const fn = req.type === 2 ? hashWasm.argon2id : hashWasm.argon2d;
  const out = await fn({
    password: new Uint8Array(req.password),
    salt: new Uint8Array(req.salt),
    memorySize: req.memoryKiB,
    iterations: req.iterations,
    parallelism: req.parallelism,
    hashLength: req.length,
    outputType: 'binary',
  });
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}
