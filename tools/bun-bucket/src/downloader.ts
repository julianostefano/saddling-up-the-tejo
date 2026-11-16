import { S3Client, Glob } from "bun";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  bytesPerSecToMbps,
  formatBytes,
  normalizeEtag,
} from "./format.ts";
import { computeFileChecksumsInWorker } from "./hasher.ts";
import { TransferMeter } from "./metrics.ts";
import { hasGlobPattern } from "./shell.ts";
import { formatUploadError } from "./uploader.ts";
import type {
  BatchUploadReport,
  ChecksumResult,
  CliOptions,
  FileAnalysis,
  OverwritePolicy,
  ProxyConfig,
  ResolvedDownloadTarget,
  S3AuthConfig,
  TlsConfig,
  UploadCallbacks,
  UploadReport,
  VerificationResult,
} from "./types.ts";

interface ListedObject {
  key: string;
  size: number;
  etag?: string;
  lastModified?: Date;
}

/**
 * Extracts the static literal prefix before the first glob metacharacter (`*`, `?`, `[`, `{`).
 */
export function extractStaticPrefix(pattern: string): string {
  const idx = pattern.search(/[*?\[\{]/);
  return idx === -1 ? pattern : pattern.slice(0, idx);
}

function getBasePrefixDir(prefix: string): string {
  const lastSlash = prefix.lastIndexOf("/");
  return lastSlash === -1 ? "" : prefix.slice(0, lastSlash + 1);
}

function hasHiddenSegment(key: string): boolean {
  return key.split("/").some((seg) => seg.startsWith(".") && seg !== "." && seg !== "..");
}

function createS3Client(
  options: Pick<CliOptions, "partSize" | "queueSize" | "retry">,
  auth: S3AuthConfig,
): S3Client {
  return new S3Client({
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
    partSize: options.partSize,
    queueSize: options.queueSize,
    retry: options.retry,
  });
}

async function listAllObjectsWithPrefix(
  client: S3Client,
  prefix: string,
): Promise<ListedObject[]> {
  const results: ListedObject[] = [];
  let continuationToken: string | undefined;
  let startAfter: string | undefined;

  while (true) {
    const response = await client.list({
      prefix: prefix || undefined,
      maxKeys: 1000,
      ...(continuationToken ? { continuationToken } : startAfter ? { startAfter } : {}),
    });

    const contents = response.contents ?? [];
    for (const item of contents) {
      if (!item.key) continue;
      // Ignore S3 empty folder marker keys
      if (item.key.endsWith("/") && (item.size ?? 0) === 0) continue;
      results.push({
        key: item.key,
        size: item.size ?? 0,
        etag: normalizeEtag(item.eTag),
        lastModified: item.lastModified ? new Date(item.lastModified) : undefined,
      });
    }

    if (!response.isTruncated) {
      break;
    }

    if (response.nextContinuationToken && response.nextContinuationToken !== continuationToken) {
      continuationToken = response.nextContinuationToken;
      startAfter = undefined;
    } else if (contents.length > 0) {
      const lastKey = contents[contents.length - 1]!.key;
      if (!lastKey || lastKey === startAfter) break;
      startAfter = lastKey;
      continuationToken = undefined;
    } else {
      break;
    }
  }

  return results;
}

function resolveBatchLocalPath(destDir: string, basePrefixDir: string, objectKey: string): {
  relativePath: string;
  localPath: string;
} {
  let relativePath = objectKey.replace(/^\/+/, "");
  if (basePrefixDir && relativePath.startsWith(basePrefixDir)) {
    relativePath = relativePath.slice(basePrefixDir.length);
  }
  relativePath = relativePath.replace(/^\/+/, "") || basename(objectKey);
  return {
    relativePath,
    localPath: resolve(destDir, relativePath),
  };
}

function resolveSingleLocalPath(localDestInput: string | undefined, objectKey: string): string {
  const fileName = basename(objectKey) || "downloaded-object";
  const rawDest = localDestInput?.trim();
  if (!rawDest || rawDest === ".") {
    return resolve(".", fileName);
  }
  if (rawDest.endsWith("/") || rawDest.endsWith("\\")) {
    return resolve(rawDest, fileName);
  }
  const absDest = resolve(rawDest);
  try {
    if (existsSync(absDest) && statSync(absDest).isDirectory()) {
      return resolve(absDest, fileName);
    }
  } catch {
    // Treat as target file path
  }
  return absDest;
}

/**
 * Resolves a remote S3 key, prefix, or wildcard glob pattern (`*`, `?`, `[...]`, `{...}`)
 * using `S3Client.prototype.list()` and `Bun.Glob` into concrete local download targets.
 */
export async function resolveDownloadTargets(
  options: Pick<CliOptions, "partSize" | "queueSize" | "retry" | "includeHidden">,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  remoteKeyOrPattern: string | undefined,
  localDestInput: string | undefined,
): Promise<ResolvedDownloadTarget[]> {
  const client = createS3Client(options, auth);
  const cleanPattern = (remoteKeyOrPattern ?? "").trim().replace(/^\/+/, "") || "*";
  const destDir = localDestInput?.trim() || ".";
  const includeHidden = Boolean(options.includeHidden);

  const isGlob = hasGlobPattern(cleanPattern);
  const isPrefixDir = cleanPattern.endsWith("/");

  try {
    if (isGlob || isPrefixDir) {
      const staticPrefix = isGlob ? extractStaticPrefix(cleanPattern) : cleanPattern;
      const basePrefixDir = getBasePrefixDir(staticPrefix);
      const listed = await listAllObjectsWithPrefix(client, staticPrefix);
      const glob = isGlob ? new Glob(cleanPattern) : null;

      const matched = listed.filter((item) => {
        if (!includeHidden && hasHiddenSegment(item.key)) return false;
        if (glob && !glob.match(item.key)) return false;
        return true;
      });

      if (matched.length === 0) {
        throw new Error(
          `No S3 objects matched pattern "s3://${auth.bucket}/${cleanPattern}".`,
        );
      }

      matched.sort((a, b) => a.key.localeCompare(b.key));
      return matched.map((item) => {
        const mapped = resolveBatchLocalPath(destDir, basePrefixDir, item.key);
        return {
          objectKey: item.key,
          relativePath: mapped.relativePath,
          localPath: mapped.localPath,
          remoteSizeBytes: item.size,
          remoteEtag: item.etag,
          remoteLastModified: item.lastModified,
        };
      });
    }

    // Single literal key: verify existence first, with prefix listing fallback
    const s3File = client.file(cleanPattern, { requestPayer: auth.requestPayer });
    const exists = await s3File.exists();

    if (exists) {
      let remoteSizeBytes: number | undefined;
      let remoteEtag: string | undefined;
      let remoteLastModified: Date | undefined;
      try {
        const st = await s3File.stat();
        remoteSizeBytes = st.size;
        remoteEtag = normalizeEtag(st.etag);
        remoteLastModified = st.lastModified;
      } catch {
        // Defer stat error handling to executeS3Download
      }
      const localPath = resolveSingleLocalPath(localDestInput, cleanPattern);
      return [
        {
          objectKey: cleanPattern,
          relativePath: basename(cleanPattern) || cleanPattern,
          localPath,
          remoteSizeBytes,
          remoteEtag,
          remoteLastModified,
        },
      ];
    }

    // Fallback: test whether the literal key is actually a key prefix in the bucket
    const listed = await listAllObjectsWithPrefix(client, cleanPattern);
    const folderPrefix = `${cleanPattern.replace(/\/+$/, "")}/`;
    const folderMatches = listed.filter(
      (item) =>
        item.key.startsWith(folderPrefix) && (includeHidden || !hasHiddenSegment(item.key)),
    );
    const matches =
      folderMatches.length > 0
        ? folderMatches
        : listed.filter((item) => includeHidden || !hasHiddenSegment(item.key));

    if (matches.length > 0) {
      const basePrefixDir = folderMatches.length > 0 ? folderPrefix : getBasePrefixDir(cleanPattern);
      matches.sort((a, b) => a.key.localeCompare(b.key));
      return matches.map((item) => {
        const mapped = resolveBatchLocalPath(destDir, basePrefixDir, item.key);
        return {
          objectKey: item.key,
          relativePath: mapped.relativePath,
          localPath: mapped.localPath,
          remoteSizeBytes: item.size,
          remoteEtag: item.etag,
          remoteLastModified: item.lastModified,
        };
      });
    }

    throw new Error(`Remote S3 object does not exist: "s3://${auth.bucket}/${cleanPattern}".`);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.startsWith("No S3 objects matched pattern") ||
        err.message.startsWith("Remote S3 object does not exist"))
    ) {
      throw err;
    }
    throw new Error(formatUploadError(err, tls, proxy), { cause: err });
  }
}

/**
 * Downloads a single S3 object to disk with live progress, speed, bandwidth, ETA telemetry,
 * local overwrite protection, and post-download Worker SHA-256 verification.
 */
export async function executeS3Download(
  target: ResolvedDownloadTarget,
  options: CliOptions,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  callbacks: UploadCallbacks = {},
): Promise<UploadReport> {
  const client = createS3Client(options, auth);
  const s3File = client.file(target.objectKey, { requestPayer: auth.requestPayer });

  let remoteSizeBytes = target.remoteSizeBytes ?? 0;
  let remoteEtag = normalizeEtag(target.remoteEtag);
  let remoteLastModified = target.remoteLastModified;
  let mimeType = "application/octet-stream";

  try {
    const stat = await s3File.stat();
    remoteSizeBytes = stat.size;
    remoteEtag = normalizeEtag(stat.etag) || remoteEtag;
    remoteLastModified = stat.lastModified ?? remoteLastModified;
    mimeType = stat.type || mimeType;
  } catch (err) {
    throw new Error(formatUploadError(err, tls, proxy), { cause: err });
  }

  const analysis: FileAnalysis = {
    absolutePath: target.localPath,
    fileName: basename(target.localPath),
    sizeBytes: remoteSizeBytes,
    mimeType,
    useMultipart: remoteSizeBytes >= options.partSize,
    multipartThreshold: options.multipartThreshold,
    partSize: options.partSize,
    totalParts: 1,
    queueSize: options.queueSize,
    reason: `Streaming S3 GetObject download (${formatBytes(remoteSizeBytes)}) -> "${target.localPath}" (verify: ${options.verifyMode}).`,
  };

  callbacks.onAnalysis?.(analysis);
  callbacks.onLog?.("info", analysis.reason);

  const overwritePolicy: OverwritePolicy = options.overwritePolicy ?? "ask";
  if (!options.dryRun && overwritePolicy !== "overwrite" && existsSync(target.localPath)) {
    let localSizeBytes = 0;
    try {
      localSizeBytes = Bun.file(target.localPath).size;
    } catch {
      localSizeBytes = 0;
    }

    const makeSkippedReport = (reason: string): UploadReport => ({
      operation: "download",
      success: true,
      skipped: true,
      skipReason: reason,
      bucket: auth.bucket,
      key: target.objectKey,
      localPath: target.localPath,
      endpoint: proxy.targetOrigin,
      region: auth.region,
      fileAnalysis: analysis,
      checksum: { sha256Hex: "", md5Hex: "", partCount: 0, elapsedMs: 0 },
      proxy,
      tls,
      upload: {
        strategy: "single-part",
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
      callbacks.onLog?.("warn", `Skipped existing local file "${target.localPath}".`);
      return makeSkippedReport("Local file already exists (--skip-existing).");
    }

    if (!callbacks.confirmOverwrite) {
      throw new Error(
        `Local file "${target.localPath}" already exists (${formatBytes(localSizeBytes)}) and overwrite confirmation is required. Pass --yes (--overwrite) to overwrite or --skip-existing to skip.`,
      );
    }

    const decision = await callbacks.confirmOverwrite({
      direction: "download",
      bucket: auth.bucket,
      key: target.objectKey,
      localPath: target.localPath,
      localSizeBytes,
      remoteSizeBytes,
      remoteEtag,
      remoteLastModified,
    });

    if (decision === "abort") {
      throw new Error(`Download aborted by user to avoid overwriting "${target.localPath}".`);
    }
    if (decision === "skip" || decision === "skip-all") {
      callbacks.onLog?.("warn", `Skipped existing local file "${target.localPath}".`);
      return makeSkippedReport("Skipped by user confirmation.");
    }
  }

  if (options.dryRun) {
    return {
      operation: "download",
      success: true,
      bucket: auth.bucket,
      key: target.objectKey,
      localPath: target.localPath,
      endpoint: proxy.targetOrigin,
      region: auth.region,
      fileAnalysis: analysis,
      checksum: { sha256Hex: "", md5Hex: "", partCount: 0, elapsedMs: 0 },
      proxy,
      tls,
      upload: {
        strategy: "single-part",
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
    };
  }

  mkdirSync(dirname(target.localPath), { recursive: true });
  const downloadMeter = new TransferMeter("downloading", remoteSizeBytes, options.linkSpeedMbps);
  const downloadStartMs = performance.now();
  let bytesWritten = 0;

  try {
    const writer = Bun.file(target.localPath).writer();
    callbacks.onProgress?.(
      downloadMeter.snapshot(`Downloading "s3://${auth.bucket}/${target.objectKey}"...`),
    );

    try {
      const stream = s3File.stream();
      for await (const chunk of stream) {
        await writer.write(chunk);
        bytesWritten += chunk.byteLength;
        downloadMeter.addBytes(chunk.byteLength);
        callbacks.onProgress?.(
          downloadMeter.snapshot(`Downloading "s3://${auth.bucket}/${target.objectKey}"...`),
        );
      }
      await writer.end();
    } catch (err) {
      try {
        await writer.end();
      } catch {
        // Ignore writer close failure after stream error
      }
      throw err;
    }

    if (bytesWritten === 0) {
      await Bun.write(target.localPath, new Uint8Array(0));
    }

    downloadMeter.setBytes(remoteSizeBytes, 1, 1);
    callbacks.onProgress?.(downloadMeter.snapshot(`Downloaded "${target.localPath}".`));
  } catch (err) {
    throw new Error(formatUploadError(err, tls, proxy), { cause: err });
  }

  const downloadDurationMs = Math.max(1, performance.now() - downloadStartMs);
  const downloadSnap = downloadMeter.snapshot();
  const localSizeBytes = Bun.file(target.localPath).size;

  const verification = await verifyDownloadedFile(
    target.localPath,
    localSizeBytes,
    remoteSizeBytes,
    remoteEtag,
    options,
    callbacks,
  );

  const success =
    options.verifyMode === "none" ||
    (verification.result.sizeMatch !== false &&
      verification.result.etagMatch !== false &&
      verification.result.sha256Match !== false);

  return {
    operation: "download",
    success,
    bucket: auth.bucket,
    key: target.objectKey,
    localPath: target.localPath,
    endpoint: proxy.targetOrigin,
    region: auth.region,
    fileAnalysis: analysis,
    checksum: verification.checksum,
    proxy,
    tls,
    upload: {
      strategy: "single-part",
      partsUploaded: 1,
      bytesUploaded: localSizeBytes,
      durationMs: downloadDurationMs,
      avgSpeedBytesPerSec: downloadSnap.avgSpeedBytesPerSec,
      peakSpeedBytesPerSec: downloadSnap.peakSpeedBytesPerSec,
      avgBandwidthMbps: bytesPerSecToMbps(downloadSnap.avgSpeedBytesPerSec),
      bandwidthUtilizationPct:
        options.linkSpeedMbps > 0
          ? Math.min(100, (bytesPerSecToMbps(downloadSnap.avgSpeedBytesPerSec) / options.linkSpeedMbps) * 100)
          : 0,
    },
    verification: verification.result,
    error: success ? undefined : "Downloaded file integrity verification failed.",
  };
}

async function verifyDownloadedFile(
  localPath: string,
  localSizeBytes: number,
  remoteSizeBytes: number,
  remoteEtag: string,
  options: Pick<CliOptions, "verifyMode" | "partSize" | "linkSpeedMbps">,
  callbacks: UploadCallbacks,
): Promise<{ checksum: ChecksumResult; result: VerificationResult }> {
  const verifyStartMs = performance.now();
  const mpMatch = /^([a-f0-9]{32})-(\d+)$/i.exec(remoteEtag);
  const useMultipart = Boolean(mpMatch);

  const checksum = await computeFileChecksumsInWorker(localPath, localSizeBytes, {
    partSize: options.partSize,
    useMultipart,
    linkSpeedMbps: options.linkSpeedMbps,
    onProgress: (snap) => {
      callbacks.onProgress?.({
        ...snap,
        phase: "verifying",
        message: "Computing downloaded SHA-256 & MD5 checksums...",
      });
    },
  });

  if (options.verifyMode === "none") {
    return {
      checksum,
      result: {
        mode: "none",
        performed: false,
        remoteExists: true,
        remoteSizeBytes,
        remoteEtag,
        remoteSha256Hex: checksum.sha256Hex,
        sizeMatch: null,
        etagMatch: null,
        sha256Match: null,
        elapsedMs: 0,
      },
    };
  }

  const sizeMatch = localSizeBytes === remoteSizeBytes;
  if (!sizeMatch) {
    throw new Error(
      `Downloaded file size mismatch for "${localPath}": expected ${remoteSizeBytes} bytes, got ${localSizeBytes} bytes.`,
    );
  }

  let etagMatch: boolean | null = null;
  if (remoteEtag) {
    if (!mpMatch && /^[a-f0-9]{32}$/i.test(remoteEtag)) {
      if (remoteEtag.toLowerCase() === checksum.md5Hex.toLowerCase()) {
        etagMatch = true;
      } else {
        etagMatch = null;
        callbacks.onLog?.(
          "info",
          `Remote ETag "${remoteEtag}" differs from plaintext MD5 (expected with SSE-KMS or non-MD5 ETags).`,
        );
      }
    } else if (mpMatch && checksum.multipartEtag) {
      const remoteParts = Number(mpMatch[2]);
      if (remoteParts === checksum.partCount) {
        if (remoteEtag.toLowerCase() === checksum.multipartEtag.toLowerCase()) {
          etagMatch = true;
        } else {
          etagMatch = null;
          callbacks.onLog?.(
            "info",
            `Remote multipart ETag "${remoteEtag}" has matching part count (${remoteParts}) with server-encrypted digest.`,
          );
        }
      } else {
        etagMatch = null;
        callbacks.onLog?.(
          "info",
          `Remote multipart ETag uses ${remoteParts} part(s) while local partSize uses ${checksum.partCount} part(s); verified exact byte size and SHA-256.`,
        );
      }
    }
  }

  return {
    checksum,
    result: {
      mode: options.verifyMode,
      performed: true,
      remoteExists: true,
      remoteSizeBytes,
      remoteEtag,
      remoteSha256Hex: checksum.sha256Hex,
      sizeMatch,
      etagMatch,
      sha256Match: true,
      elapsedMs: Math.max(1, performance.now() - verifyStartMs),
    },
  };
}

/**
 * Executes a multi-file download batch (wildcards or prefix directories) with shared overwrite policy state
 * ("overwrite-all" / "skip-all") and aggregate speed/bandwidth reporting.
 */
export async function executeBatchDownload(
  targets: ResolvedDownloadTarget[],
  options: CliOptions,
  auth: S3AuthConfig,
  proxy: ProxyConfig,
  tls: TlsConfig,
  callbacks: UploadCallbacks = {},
): Promise<BatchUploadReport> {
  const startMs = performance.now();
  const results: UploadReport[] = [];
  let effectivePolicy: OverwritePolicy = options.overwritePolicy ?? "ask";
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let downloadedBytes = 0;
  const totalBytes = targets.reduce((acc, t) => acc + (t.remoteSizeBytes ?? 0), 0);

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    callbacks.onTargetStart?.(i + 1, targets.length, target);

    const itemOptions: CliOptions = {
      ...options,
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

    const report = await executeS3Download(target, itemOptions, auth, proxy, tls, itemCallbacks);
    results.push(report);

    if (report.skipped) {
      skippedCount++;
    } else if (report.success) {
      downloadedCount++;
      downloadedBytes += report.upload.bytesUploaded;
    } else {
      failedCount++;
    }
  }

  const durationMs = Math.max(1, performance.now() - startMs);
  const avgSpeedBytesPerSec = (downloadedBytes / durationMs) * 1000;

  return {
    operation: "download",
    success: failedCount === 0,
    bucket: auth.bucket,
    endpoint: proxy.targetOrigin,
    region: auth.region,
    totalFiles: targets.length,
    uploadedCount: downloadedCount,
    skippedCount,
    failedCount,
    totalBytes,
    uploadedBytes: downloadedBytes,
    durationMs,
    avgSpeedBytesPerSec,
    avgBandwidthMbps: bytesPerSecToMbps(avgSpeedBytesPerSec),
    results,
  };
}
