import { executeS3Upload } from "./uploader.ts";
import type {
  CliOptions,
  ProxyConfig,
  S3AuthConfig,
  TlsConfig,
  UploadCallbacks,
  UploadReport,
} from "./types.ts";

/**
 * Entry module loaded inside `Bun.ModuleGraph` for isolated upload execution.
 * Runs with the graph's own `process` environment and isolated I/O/timer lifecycle.
 */
export async function runInGraph(
  options: CliOptions,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  callbacks: UploadCallbacks,
): Promise<UploadReport> {
  if (tls.allowInvalidCerts) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  return await executeS3Upload(options, auth, proxy, tls, callbacks);
}
