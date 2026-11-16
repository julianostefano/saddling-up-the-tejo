import { executeBatchDownload, executeS3Download } from "./downloader.ts";
import { executeBatchUpload, executeS3Upload } from "./uploader.ts";
import type {
  BatchUploadReport,
  CliOptions,
  ProxyConfig,
  ResolvedDownloadTarget,
  ResolvedUploadTarget,
  S3AuthConfig,
  TlsConfig,
  UploadCallbacks,
  UploadReport,
} from "./types.ts";

/**
 * Entry module loaded inside `Bun.ModuleGraph` for isolated transfer execution.
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

export async function runBatchInGraph(
  targets: ResolvedUploadTarget[],
  options: CliOptions,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  callbacks: UploadCallbacks,
): Promise<BatchUploadReport> {
  if (tls.allowInvalidCerts) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  return await executeBatchUpload(targets, options, auth, proxy, tls, callbacks);
}

export async function runDownloadInGraph(
  target: ResolvedDownloadTarget,
  options: CliOptions,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  callbacks: UploadCallbacks,
): Promise<UploadReport> {
  if (tls.allowInvalidCerts) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  return await executeS3Download(target, options, auth, proxy, tls, callbacks);
}

export async function runBatchDownloadInGraph(
  targets: ResolvedDownloadTarget[],
  options: CliOptions,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  callbacks: UploadCallbacks,
): Promise<BatchUploadReport> {
  if (tls.allowInvalidCerts) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  return await executeBatchDownload(targets, options, auth, proxy, tls, callbacks);
}
