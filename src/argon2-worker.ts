// Web Worker : calcule Argon2 hors du fil principal.
import { computeArgon2, type Argon2Request } from './argon2-core.ts';

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = async (e: MessageEvent) => {
  const { id, ...req } = e.data as Argon2Request & { id: number };
  try {
    const result = await computeArgon2(req);
    scope.postMessage({ id, result }, [result]);
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
