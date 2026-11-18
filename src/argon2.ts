// Fonction de dérivation de clé Argon2 (exigée par le format KDBX 4).
// Dans le navigateur, le calcul tourne dans un Web Worker pour ne pas figer l'interface.
// Dans Node (tests), il est fait directement.
import kdbxweb from './kdbx.ts';
import { computeArgon2, type Argon2Request } from './argon2-core.ts';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: ArrayBuffer) => void; reject: (e: Error) => void }>();

function getWorker(url: string): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(url);
    worker.onmessage = (e: MessageEvent) => {
      const { id, result, error } = e.data as { id: number; result?: ArrayBuffer; error?: string };
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error || !result) p.reject(new Error(error || 'Erreur Argon2'));
      else p.resolve(result);
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('Le calcul de clé a échoué.'));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

function viaWorker(url: string, req: Argon2Request): Promise<ArrayBuffer> {
  const w = getWorker(url);
  if (!w) return computeArgon2(req);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, ...req });
  });
}

/** Branche Argon2 dans kdbxweb. `workerUrl` absent = calcul direct (tests). */
export function installArgon2(workerUrl?: string): void {
  kdbxweb.CryptoEngine.setArgon2Impl((password, salt, memory, iterations, length, parallelism, type, version) => {
    const req: Argon2Request = { password, salt, memoryKiB: memory, iterations, length, parallelism, type, version };
    return workerUrl ? viaWorker(workerUrl, req) : computeArgon2(req);
  });
}
