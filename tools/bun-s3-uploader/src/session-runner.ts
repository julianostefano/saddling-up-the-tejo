import { fileURLToPath } from "node:url";
import type {
  CliOptions,
  ProxyConfig,
  S3AuthConfig,
  TlsConfig,
  UploadCallbacks,
  UploadReport,
} from "./types.ts";

export interface IsolatedSessionController {
  promise: Promise<UploadReport>;
  cancel: (reason?: string) => void;
}

/**
 * Executes an upload session inside an isolated `Bun.ModuleGraph` with its own
 * `process` environment view and deterministic `graph.dispose()` cancellation.
 */
export function startIsolatedUploadSession(
  options: CliOptions,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  envOverrides: Record<string, string | undefined>,
  callbacks: UploadCallbacks = {},
): IsolatedSessionController {
  const isolatedEnv: Record<string, string | undefined> = {
    ...process.env,
    ...envOverrides,
  };
  if (tls.allowInvalidCerts) {
    isolatedEnv.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const isolatedProcess = Object.create(process, {
    env: {
      value: isolatedEnv,
      enumerable: true,
      configurable: true,
      writable: true,
    },
  });

  const cancelled = Promise.withResolvers<never>();
  let isDisposed = false;

  const graph = new Bun.ModuleGraph({
    globals: {
      process: isolatedProcess,
    },
    onError(error, kind) {
      callbacks.onLog?.("error", `Isolated session ${kind}: ${String(error)}`);
    },
  });

  const entryPath = fileURLToPath(new URL("./isolated-entry.ts", import.meta.url));

  const runPromise = (async () => {
    try {
      const mod = (await graph.import(entryPath)) as {
        runInGraph: (
          o: CliOptions,
          a: S3AuthConfig,
          p: ProxyConfig,
          t: TlsConfig,
          c: UploadCallbacks,
        ) => Promise<UploadReport>;
      };
      return await graph.run(() => mod.runInGraph(options, auth, proxy, tls, callbacks));
    } finally {
      if (!isDisposed) {
        isDisposed = true;
        graph.dispose();
      }
    }
  })();

  const promise = Promise.race([runPromise, cancelled.promise]);

  const cancel = (reason = "Upload session cancelled by user.") => {
    if (!isDisposed) {
      isDisposed = true;
      graph.dispose();
    }
    cancelled.reject(new Error(reason));
  };

  return { promise, cancel };
}
