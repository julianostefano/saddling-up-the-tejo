import { S3Client } from "bun";
import {
  DEFAULT_MULTIPART_THRESHOLD,
  DEFAULT_PART_SIZE,
  DEFAULT_QUEUE_SIZE,
  DEFAULT_RETRY,
  MAX_S3_PART_SIZE,
  MIN_S3_PART_SIZE,
  bytesPerSecToMbps,
  formatBytes,
  normalizeEtag,
} from "./format.ts";
import { computeFileChecksumsInWorker } from "./hasher.ts";
import { TransferMeter } from "./metrics.ts";
import { inspectLocalPathWithShell } from "./shell.ts";
import type {
  BatchUploadReport,
  CliOptions,
  FileAnalysis,
  OverwritePolicy,
  ProxyConfig,
  ResolvedUploadTarget,
  S3AuthConfig,
  TlsConfig,
  UploadCallbacks,
  UploadReport,
  VerificationResult,
} from "./types.ts";

/**
 * Analyzes a local file via Bun Shell & `Bun.file` and decides between Single-Part and Multipart upload.
 */
export async function analyzeFileForUpload(
  filePath: string,
  options: Pick<CliOptions, "partSize" | "multipartThreshold" | "queueSize" | "retry">,
): Promise<FileAnalysis> {
  const partSize = options.partSize ?? DEFAULT_PART_SIZE;
  const multipartThreshold = options.multipartThreshold ?? DEFAULT_MULTIPART_THRESHOLD;
  const queueSize = options.queueSize ?? DEFAULT_QUEUE_SIZE;
  const retry = options.retry ?? DEFAULT_RETRY;

  if (partSize < MIN_S3_PART_SIZE || partSize > MAX_S3_PART_SIZE) {
    throw new Error(
      `Invalid --part-size (${formatBytes(partSize)}). S3 requires partSize between ${formatBytes(MIN_S3_PART_SIZE)} and ${formatBytes(MAX_S3_PART_SIZE)}.`,
    );
  }
  if (!Number.isInteger(queueSize) || queueSize < 1 || queueSize > 255) {
    throw new Error(`Invalid --queue-size (${queueSize}). Must be an integer between 1 and 255.`);
  }
  if (!Number.isInteger(retry) || retry < 0 || retry > 255) {
    throw new Error(`Invalid --retry (${retry}). Must be an integer between 0 and 255.`);
  }
  if (multipartThreshold < 1) {
    throw new Error(`Invalid --multipart-threshold (${multipartThreshold}). Must be >= 1 byte.`);
  }

  const inspection = await inspectLocalPathWithShell(filePath);
  if (!inspection.exists) {
    throw new Error(`Input file does not exist: "${inspection.absolutePath}".`);
  }
  if (inspection.isDirectory) {
    throw new Error(
      `Input path "${inspection.absolutePath}" is a directory. Please specify a file path.`,
    );
  }
  if (!inspection.isFile) {
    throw new Error(`Input path "${inspection.absolutePath}" is not a regular file.`);
  }

  const bunFile = Bun.file(inspection.absolutePath);
  const sizeBytes = bunFile.size;
  const mimeType = bunFile.type || "application/octet-stream";

  const useMultipart = sizeBytes > 0 && sizeBytes >= multipartThreshold;
  const totalParts = useMultipart ? Math.max(1, Math.ceil(sizeBytes / partSize)) : 1;

  const reason = useMultipart
    ? `File size (${formatBytes(sizeBytes)}) >= multipart threshold (${formatBytes(multipartThreshold)}): using S3 Multipart Upload API (${totalParts} part(s), partSize=${formatBytes(partSize)}, concurrency=${queueSize}).`
    : `File size (${formatBytes(sizeBytes)}) < multipart threshold (${formatBytes(multipartThreshold)}): using S3 Single-Part PutObject upload.`;

  return {
    absolutePath: inspection.absolutePath,
    fileName: inspection.fileName,
    sizeBytes,
    mimeType,
    useMultipart,
    multipartThreshold,
    partSize,
    totalParts,
    queueSize,
    reason,
  };
}

/**
 * Formats low-level S3, TLS, and proxy errors into clear English troubleshooting messages.
 */
export function formatUploadError(err: unknown, tls: TlsConfig, proxy: ProxyConfig): string {
  const anyErr = err as { name?: string; code?: string; message?: string; status?: number };
  const code = anyErr?.code ?? "";
  const msg = anyErr?.message ?? String(err);

  const isTlsCertError =
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|TLS|SSL/i.test(code) ||
    /certificate|self-signed|unable to verify/i.test(msg);

  if (isTlsCertError && !tls.allowInvalidCerts) {
    return (
      `TLS certificate verification failed (${code || msg}). ` +
      `To upload even with invalid/self-signed certificates, pass --insecure (-k) or set NODE_TLS_REJECT_UNAUTHORIZED=0.`
    );
  }

  if (code === "ERR_PROXY_TUNNEL") {
    return (
      `Proxy tunnel connection failed (HTTP ${anyErr.status ?? "unknown"}) while routing through ` +
      `${proxy.activeProxyUrl ?? "configured proxy"}: ${msg}`
    );
  }

  if (code) {
    return `${anyErr.name || "S3UploadError"} [${code}]: ${msg}`;
  }

  return msg;
}

/**
 * Executes the complete file analysis, Worker SHA-256 hashing, S3 single/multipart upload,
 * and post-upload shasum verification pipeline using exclusively native Bun APIs.
 */
export async function executeS3Upload(
  options: CliOptions,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  callbacks: UploadCallbacks = {},
): Promise<UploadReport> {
  if (!options.filePath) {
    throw new Error("Input file path is required.");
  }

  const analysis = await analyzeFileForUpload(options.filePath, options);
  const objectKey = (options.key?.trim() || analysis.fileName).replace(/^\/+/, "");

  callbacks.onAnalysis?.(analysis);
  callbacks.onLog?.("info", analysis.reason);

  const client = new S3Client({
    accessKeyId: auth.accessKeyId,
    secretAccessKey: auth.secretAccessKey,
    region: auth.region,
    endpoint: auth.endpoint,
    bucket: auth.bucket,
    sessionToken: auth.sessionToken,
    virtualHostedStyle: auth.virtualHostedStyle,
    acl: auth.acl,
    storageClass: auth.storageClass,
    requestPayer: auth.requestPayer,
    partSize: analysis.partSize,
    queueSize: analysis.queueSize,
    retry: options.retry,
  });

  const s3File = client.file(objectKey, {
    type: analysis.mimeType,
    acl: auth.acl,
    storageClass: auth.storageClass,
    requestPayer: auth.requestPayer,
  });

  const overwritePolicy: OverwritePolicy = options.overwritePolicy ?? "ask";
  let nextBatchPolicy: OverwritePolicy | undefined;

  if (!options.dryRun && overwritePolicy !== "overwrite") {
    let exists = false;
    try {
      exists = await s3File.exists();
    } catch (err) {
      throw new Error(formatUploadError(err, tls, proxy), { cause: err });
    }

    if (exists) {
      let remoteSizeBytes: number | undefined;
      let remoteEtag: string | undefined;
      let remoteLastModified: Date | undefined;
      try {
        const remoteStat = await s3File.stat();
        remoteSizeBytes = remoteStat.size;
        remoteEtag = normalizeEtag(remoteStat.etag);
        remoteLastModified = remoteStat.lastModified;
      } catch {
        // Proceed even if HEAD stat metadata is unavailable
      }

      const makeSkippedReport = (reason: string): UploadReport => ({
        success: true,
        skipped: true,
        skipReason: reason,
        bucket: auth.bucket,
        key: objectKey,
        endpoint: proxy.targetOrigin,
        region: auth.region,
        fileAnalysis: analysis,
        checksum: { sha256Hex: "", md5Hex: "", partCount: 0, elapsedMs: 0 },
        proxy,
        tls,
        upload: {
          strategy: analysis.useMultipart ? "multipart" : "single-part",
          partsUploaded: 0,
          bytesUploaded: 0,
          durationMs: 0,
          avgSpeedBytesPerSec: 0,
          peakSpeedBytesPerSec: 0,
          avgBandwidthMbps: 0,
          bandwidthUtilizationPct: 0,
        },
        verification: {
          mode: options.verifyMode,
          performed: false,
          remoteExists: true,
          remoteSizeBytes,
          remoteEtag,
          sizeMatch: null,
          etagMatch: null,
          sha256Match: null,
          elapsedMs: 0,
        },
      });

      if (overwritePolicy === "skip") {
        callbacks.onLog?.("warn", `Skipped existing object "s3://${auth.bucket}/${objectKey}".`);
        return makeSkippedReport("Object already exists (--skip-existing).");
      }

      if (!callbacks.confirmOverwrite) {
        throw new Error(
          `Object "s3://${auth.bucket}/${objectKey}" already exists` +
            `${remoteSizeBytes !== undefined ? ` (${formatBytes(remoteSizeBytes)})` : ""} ` +
            `and overwrite confirmation is required. Pass --yes (--overwrite) to overwrite or --skip-existing to skip.`,
        );
      }

      const decision = await callbacks.confirmOverwrite({
        bucket: auth.bucket,
        key: objectKey,
        localPath: analysis.absolutePath,
        localSizeBytes: analysis.sizeBytes,
        remoteSizeBytes,
        remoteEtag,
        remoteLastModified,
      });

      if (decision === "abort") {
        throw new Error(`Upload aborted by user to avoid overwriting "s3://${auth.bucket}/${objectKey}".`);
      }
      if (decision === "skip" || decision === "skip-all") {
        if (decision === "skip-all") nextBatchPolicy = "skip";
        callbacks.onLog?.("warn", `Skipped existing object "s3://${auth.bucket}/${objectKey}".`);
        return makeSkippedReport("Skipped by user confirmation.");
      }
      if (decision === "overwrite-all") {
        nextBatchPolicy = "overwrite";
      }
    }
  }

  // Phase 1: Compute SHA-256, MD5, and S3 multipart ETag in a background Worker thread.
  const checksum = await computeFileChecksumsInWorker(analysis.absolutePath, analysis.sizeBytes, {
    partSize: analysis.partSize,
    useMultipart: analysis.useMultipart,
    linkSpeedMbps: options.linkSpeedMbps,
    onProgress: callbacks.onProgress,
  });

  if (options.dryRun) {
    const emptyVerification: VerificationResult = {
      mode: options.verifyMode,
      performed: false,
      remoteExists: false,
      sizeMatch: null,
      etagMatch: null,
      sha256Match: null,
      elapsedMs: 0,
    };
    return {
      success: true,
      bucket: auth.bucket,
      key: objectKey,
      endpoint: proxy.targetOrigin,
      region: auth.region,
      fileAnalysis: analysis,
      checksum,
      proxy,
      tls,
      upload: {
        strategy: analysis.useMultipart ? "multipart" : "single-part",
        partsUploaded: 0,
        bytesUploaded: 0,
        durationMs: 0,
        avgSpeedBytesPerSec: 0,
        peakSpeedBytesPerSec: 0,
        avgBandwidthMbps: 0,
        bandwidthUtilizationPct: 0,
      },
      verification: emptyVerification,
    };
  }

  // Propagate batch policy choice if caller tracks it (used internally by executeBatchUpload)
  void nextBatchPolicy;

  const uploadMeter = new TransferMeter("uploading", analysis.sizeBytes, options.linkSpeedMbps);
  const uploadStartMs = performance.now();
  let partsUploaded = 0;

  try {
    if (!analysis.useMultipart) {
      // Single-part PutObject upload
      callbacks.onProgress?.(uploadMeter.snapshot(`Uploading "${objectKey}" (single-part)...`));
      const localFile = Bun.file(analysis.absolutePath);
      const ticker = setInterval(() => {
        callbacks.onProgress?.(uploadMeter.snapshot(`Uploading "${objectKey}" (single-part)...`));
      }, 150);

      try {
        await s3File.write(localFile, {
          type: analysis.mimeType,
          acl: auth.acl,
          storageClass: auth.storageClass,
          requestPayer: auth.requestPayer,
          retry: options.retry,
        });
      } finally {
        clearInterval(ticker);
      }

      partsUploaded = 1;
      uploadMeter.setBytes(analysis.sizeBytes, 1, 1);
      callbacks.onProgress?.(uploadMeter.snapshot(`Uploaded "${objectKey}" (single-part).`));
    } else {
      // Multipart Upload via native S3File.writer() with sliding concurrency window
      callbacks.onLog?.(
        "info",
        `Starting S3 Multipart Upload: ${analysis.totalParts} parts (${formatBytes(analysis.partSize)}/part, queueSize=${analysis.queueSize}, retry=${options.retry})`,
      );

      const writer = s3File.writer({
        partSize: analysis.partSize,
        queueSize: analysis.queueSize,
        retry: options.retry,
        type: analysis.mimeType,
        acl: auth.acl,
        storageClass: auth.storageClass,
        requestPayer: auth.requestPayer,
      });

      const localFile = Bun.file(analysis.absolutePath);
      const pendingPartSizes: number[] = [];

      for (let partIndex = 0; partIndex < analysis.totalParts; partIndex++) {
        const start = partIndex * analysis.partSize;
        const end = Math.min(analysis.sizeBytes, start + analysis.partSize);
        const chunkBytes = await localFile.slice(start, end).bytes();

        writer.write(chunkBytes);
        pendingPartSizes.push(chunkBytes.byteLength);

        // Keep up to `queueSize` parts uploading concurrently; flush oldest window when full
        if (pendingPartSizes.length >= analysis.queueSize) {
          await writer.flush();
          const completedSize = pendingPartSizes.shift() ?? 0;
          partsUploaded++;
          uploadMeter.addBytes(completedSize, partsUploaded, analysis.totalParts);
          callbacks.onProgress?.(
            uploadMeter.snapshot(
              `Uploading part ${partsUploaded}/${analysis.totalParts} (${formatBytes(completedSize)})...`,
            ),
          );
        }
      }

      await writer.end();
      while (pendingPartSizes.length > 0) {
        const completedSize = pendingPartSizes.shift() ?? 0;
        partsUploaded++;
        uploadMeter.addBytes(completedSize, partsUploaded, analysis.totalParts);
      }
      uploadMeter.setBytes(analysis.sizeBytes, analysis.totalParts, analysis.totalParts);
      callbacks.onProgress?.(
        uploadMeter.snapshot(`Completed multipart upload (${analysis.totalParts} parts).`),
      );
    }
  } catch (err) {
    const formatted = formatUploadError(err, tls, proxy);
    throw new Error(formatted, { cause: err });
  }

  const uploadDurationMs = Math.max(1, performance.now() - uploadStartMs);
  const uploadSnap = uploadMeter.snapshot();

  // Phase 3: Shasum & Metadata Verification
  const verification = await verifyUploadedObject(
    s3File,
    analysis,
    checksum,
    options.verifyMode,
    options.linkSpeedMbps,
    callbacks,
  );

  const success =
    verification.mode === "none" ||
    (verification.remoteExists &&
      verification.sizeMatch !== false &&
      verification.etagMatch !== false &&
      verification.sha256Match !== false);

  return {
    success,
    bucket: auth.bucket,
    key: objectKey,
    endpoint: proxy.targetOrigin,
    region: auth.region,
    fileAnalysis: analysis,
    checksum,
    proxy,
    tls,
    upload: {
      strategy: analysis.useMultipart ? "multipart" : "single-part",
      partsUploaded,
      bytesUploaded: analysis.sizeBytes,
      durationMs: uploadDurationMs,
      avgSpeedBytesPerSec: uploadSnap.avgSpeedBytesPerSec,
      peakSpeedBytesPerSec: uploadSnap.peakSpeedBytesPerSec,
      avgBandwidthMbps: (uploadSnap.avgSpeedBytesPerSec * 8) / 1_000_000,
      bandwidthUtilizationPct:
        options.linkSpeedMbps > 0
          ? Math.min(100, (((uploadSnap.avgSpeedBytesPerSec * 8) / 1_000_000) / options.linkSpeedMbps) * 100)
          : 0,
    },
    verification,
    error: success ? undefined : "Remote integrity verification failed.",
  };
}

async function verifyUploadedObject(
  s3File: ReturnType<S3Client["file"]>,
  analysis: FileAnalysis,
  checksum: { sha256Hex: string; md5Hex: string; multipartEtag?: string },
  verifyMode: CliOptions["verifyMode"],
  linkSpeedMbps: number,
  callbacks: UploadCallbacks,
): Promise<VerificationResult> {
  if (verifyMode === "none") {
    return {
      mode: "none",
      performed: false,
      remoteExists: true,
      sizeMatch: null,
      etagMatch: null,
      sha256Match: null,
      elapsedMs: 0,
    };
  }

  const verifyStartMs = performance.now();
  const stat = await s3File.stat();
  const remoteSizeBytes = stat.size;
  const remoteEtag = normalizeEtag(stat.etag);
  const sizeMatch = remoteSizeBytes === analysis.sizeBytes;

  let etagMatch: boolean | null = null;
  if (remoteEtag) {
    if (!analysis.useMultipart && /^[a-f0-9]{32}$/i.test(remoteEtag)) {
      etagMatch = remoteEtag.toLowerCase() === checksum.md5Hex.toLowerCase();
    } else if (
      analysis.useMultipart &&
      checksum.multipartEtag &&
      /^[a-f0-9]{32}-\d+$/i.test(remoteEtag)
    ) {
      etagMatch = remoteEtag.toLowerCase() === checksum.multipartEtag.toLowerCase();
    }
  }

  if (!sizeMatch) {
    throw new Error(
      `Remote object size mismatch: expected ${analysis.sizeBytes} bytes, got ${remoteSizeBytes} bytes.`,
    );
  }
  if (etagMatch === false) {
    const expectedEtag = analysis.useMultipart ? checksum.multipartEtag : checksum.md5Hex;
    throw new Error(
      `Remote ETag mismatch: expected "${expectedEtag}", got "${remoteEtag}".`,
    );
  }

  if (verifyMode === "stat") {
    return {
      mode: "stat",
      performed: true,
      remoteExists: true,
      remoteSizeBytes,
      remoteEtag,
      sizeMatch,
      etagMatch,
      sha256Match: null,
      elapsedMs: Math.max(1, performance.now() - verifyStartMs),
    };
  }

  // Full verification: stream back uploaded object to compute remote SHA-256 & measure download speed
  const verifyMeter = new TransferMeter("verifying", analysis.sizeBytes, linkSpeedMbps);
  const remoteHasher = new Bun.CryptoHasher("sha256");
  const stream = s3File.stream();

  callbacks.onProgress?.(verifyMeter.snapshot("Verifying remote SHA-256 checksum (streaming)..."));
  for await (const chunk of stream) {
    remoteHasher.update(chunk);
    verifyMeter.addBytes(chunk.byteLength);
    callbacks.onProgress?.(verifyMeter.snapshot("Verifying remote SHA-256 checksum (streaming)..."));
  }

  const remoteSha256Hex = remoteHasher.digest("hex");
  const sha256Match = remoteSha256Hex.toLowerCase() === checksum.sha256Hex.toLowerCase();
  const verifySnap = verifyMeter.snapshot("SHA-256 verification complete.");
  callbacks.onProgress?.(verifySnap);

  if (!sha256Match) {
    throw new Error(
      `SHA-256 checksum mismatch! Local=${checksum.sha256Hex}, Remote=${remoteSha256Hex}`,
    );
  }

  return {
    mode: "full",
    performed: true,
    remoteExists: true,
    remoteSizeBytes,
    remoteEtag,
    remoteSha256Hex,
    sizeMatch,
    etagMatch,
    sha256Match,
    downloadSpeedBytesPerSec: verifySnap.avgSpeedBytesPerSec,
    downloadBandwidthMbps: (verifySnap.avgSpeedBytesPerSec * 8) / 1_000_000,
    elapsedMs: Math.max(1, performance.now() - verifyStartMs),
  };
}

/**
 * Executes a multi-file upload batch (wildcards / directories) with shared overwrite policy state
 * ("overwrite-all" / "skip-all") and aggregate speed/bandwidth reporting.
 */
export async function executeBatchUpload(
  targets: ResolvedUploadTarget[],
  options: CliOptions,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  callbacks: UploadCallbacks = {},
): Promise<BatchUploadReport> {
  const startMs = performance.now();
  const results: UploadReport[] = [];
  let effectivePolicy: OverwritePolicy = options.overwritePolicy ?? "ask";
  let uploadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let uploadedBytes = 0;
  const totalBytes = targets.reduce((acc, t) => acc + t.sizeBytes, 0);

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    callbacks.onTargetStart?.(i + 1, targets.length, target);

    const itemOptions: CliOptions = {
      ...options,
      filePath: target.localPath,
      key: target.objectKey,
      overwritePolicy: effectivePolicy,
    };

    const itemCallbacks: UploadCallbacks = {
      ...callbacks,
      confirmOverwrite: callbacks.confirmOverwrite
        ? async (info) => {
            const decision = await callbacks.confirmOverwrite!(info);
            if (decision === "overwrite-all") effectivePolicy = "overwrite";
            if (decision === "skip-all") effectivePolicy = "skip";
            return decision;
          }
        : undefined,
    };

    const report = await executeS3Upload(itemOptions, auth, proxy, tls, itemCallbacks);
    results.push(report);

    if (report.skipped) {
      skippedCount++;
    } else if (report.success) {
      uploadedCount++;
      uploadedBytes += report.upload.bytesUploaded;
    } else {
      failedCount++;
    }
  }

  const durationMs = Math.max(1, performance.now() - startMs);
  const avgSpeedBytesPerSec = (uploadedBytes / durationMs) * 1000;

  return {
    success: failedCount === 0,
    bucket: auth.bucket,
    endpoint: proxy.targetOrigin,
    region: auth.region,
    totalFiles: targets.length,
    uploadedCount,
    skippedCount,
    failedCount,
    totalBytes,
    uploadedBytes,
    durationMs,
    avgSpeedBytesPerSec,
    avgBandwidthMbps: bytesPerSecToMbps(avgSpeedBytesPerSec),
    results,
  };
}
