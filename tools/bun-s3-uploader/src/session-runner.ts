import { fileURLToPath } from "node:url";
import type {
  BatchUploadReport,
  CliOptions,
  ProxyConfig,
  ResolvedUploadTarget,
  S3AuthConfig,
  TlsConfig,
  UploadCallbacks,
  UploadReport,
} from "./types.ts";

export interface IsolatedSessionController<T = UploadReport> {
  promise: Promise<T>;
  cancel: (reason?: string) => void;
}

function startGraphSession<T>(
  tls: TlsConfig,
  envOverrides: Record<string, string | undefined>,
  callbacks: UploadCallbacks,
  invoker: (mod: {
    runInGraph: (
      o: CliOptions,
      a: S3AuthConfig,
      p: ProxyConfig,
      t: TlsConfig,
      c: UploadCallbacks,
    ) => Promise<UploadReport>;
    runBatchInGraph: (
      targets: ResolvedUploadTarget[],
      o: CliOptions,
      a: S3AuthConfig,
      p: ProxyConfig,
      t: TlsConfig,
      c: UploadCallbacks,
    ) => Promise<BatchUploadReport>;
  }) => Promise<T>,
): IsolatedSessionController<T> {
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
      const mod = (await graph.import(entryPath)) as Parameters<typeof invoker>[0];
      return await graph.run(() => invoker(mod));
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

/**
 * Executes a single-file upload session inside an isolated `Bun.ModuleGraph`.
 */
export function startIsolatedUploadSession(
  options: CliOptions,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  envOverrides: Record<string, string | undefined>,
  callbacks: UploadCallbacks = {},
): IsolatedSessionController<UploadReport> {
  return startGraphSession(tls, envOverrides, callbacks, (mod) =>
    mod.runInGraph(options, auth, proxy, tls, callbacks),
  );
}

/**
 * Executes a multi-file batch upload session inside an isolated `Bun.ModuleGraph`.
 */
export function startIsolatedBatchUploadSession(
  targets: ResolvedUploadTarget[],
  options: CliOptions,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  envOverrides: Record<string, string | undefined>,
  callbacks: UploadCallbacks = {},
): IsolatedSessionController<BatchUploadReport> {
  return startGraphSession(tls, envOverrides, callbacks, (mod) =>
    mod.runBatchInGraph(targets, options, auth, proxy, tls, callbacks),
  );
}
