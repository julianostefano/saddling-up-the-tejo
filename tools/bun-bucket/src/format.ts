/**
 * Formatting, size parsing, progress bar rendering, and S3 ETag helpers.
 */

export const KIB = 1024;
export const MIB = 1024 * 1024;
export const GIB = 1024 * 1024 * 1024;

export const MIN_S3_PART_SIZE = 5 * MIB; // 5 MiB (AWS S3 minimum)
export const MAX_S3_PART_SIZE = 5 * GIB; // 5 GiB (AWS S3 maximum)
export const DEFAULT_PART_SIZE = 5 * MIB;
export const DEFAULT_MULTIPART_THRESHOLD = 5 * MIB;
export const DEFAULT_QUEUE_SIZE = 4;
export const DEFAULT_RETRY = 3;
export const DEFAULT_LINK_SPEED_MBPS = 1000;

/**
 * Formats a byte count into a human-readable IEC unit string.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < KIB) return `${Math.round(bytes)} B`;
  if (bytes < MIB) return `${(bytes / KIB).toFixed(2)} KiB`;
  if (bytes < GIB) return `${(bytes / MIB).toFixed(2)} MiB`;
  return `${(bytes / GIB).toFixed(2)} GiB`;
}

/**
 * Formats a transfer rate (bytes/sec) into MB/s or KB/s (decimal SI units for throughput).
 */
export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "0.00 B/s";
  if (bytesPerSec < 1000) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1_000_000) return `${(bytesPerSec / 1000).toFixed(2)} KB/s`;
  if (bytesPerSec < 1_000_000_000) return `${(bytesPerSec / 1_000_000).toFixed(2)} MB/s`;
  return `${(bytesPerSec / 1_000_000_000).toFixed(2)} GB/s`;
}

/**
 * Converts bytes per second to Megabits per second (Mbps).
 */
export function bytesPerSecToMbps(bytesPerSec: number): number {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return 0;
  return (bytesPerSec * 8) / 1_000_000;
}

/**
 * Formats bandwidth utilization in Mbps / Gbps.
 */
export function formatBandwidth(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return "0.00 Mbps";
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
  return `${mbps.toFixed(2)} Mbps`;
}

/**
 * Formats an ETA in seconds into a concise clock or duration string.
 */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }
  const rounded = Math.ceil(seconds);
  if (rounded < 60) {
    return `00:${String(rounded).padStart(2, "0")}`;
  }
  const hours = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Formats milliseconds into a readable elapsed duration.
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(2)}s`;
  return formatEta(sec);
}

/**
 * Renders a fixed-width Unicode progress bar.
 */
export function renderProgressBar(percent: number, width = 26): string {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${clamped.toFixed(1).padStart(5, " ")}%`;
}

/**
 * Parses human-readable byte sizes such as "5M", "10MiB", "1G", or "5242880".
 */
export function parseByteSize(input: string): number {
  const trimmed = input.trim();
  const match = /^(\d+(?:\.\d+)?)\s*(b|k|kb|kib|m|mb|mib|g|gb|gib)?$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid byte size "${input}". Examples: 5242880, 5M, 10MiB, 1G.`);
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    k: KIB,
    kb: 1000,
    kib: KIB,
    m: MIB,
    mb: 1_000_000,
    mib: MIB,
    g: GIB,
    gb: 1_000_000_000,
    gib: GIB,
  };
  const multiplier = multipliers[unit];
  if (!multiplier || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid byte size "${input}".`);
  }
  return Math.floor(value * multiplier);
}

/**
 * Masks credentials embedded inside proxy URLs before printing to terminal/logs.
 */
export function maskProxyUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? "***" : "";
      parsed.password = parsed.password ? "***" : "";
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return rawUrl.replace(/\/\/[^@]+@/, "//***:***@");
  }
}

/**
 * Strips surrounding double quotes from an S3 ETag header value.
 */
export function normalizeEtag(etag: string | undefined): string {
  if (!etag) return "";
  return etag.trim().replace(/^"+|"+$/g, "");
}

/**
 * Computes the AWS S3 multipart ETag from raw 16-byte MD5 digests of each part.
 * Format: "<md5_hex_of_concatenated_raw_md5s>-<partCount>"
 */
export function computeS3MultipartEtag(partMd5Digests: Uint8Array[]): string {
  if (partMd5Digests.length === 0) {
    return "";
  }
  const combined = new Uint8Array(partMd5Digests.length * 16);
  for (let i = 0; i < partMd5Digests.length; i++) {
    const digest = partMd5Digests[i];
    if (!digest || digest.byteLength !== 16) {
      throw new Error(`Invalid MD5 digest length for part ${i + 1}`);
    }
    combined.set(digest, i * 16);
  }
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(combined);
  return `${hasher.digest("hex")}-${partMd5Digests.length}`;
}

/**
 * Parses an "s3://bucket/key" URI into bucket and key components.
 */
export function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  if (!/^s3:\/\//i.test(uri)) return null;
  const rest = uri.slice("s3://".length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1) {
    return { bucket: rest, key: "" };
  }
  return {
    bucket: rest.slice(0, slashIdx),
    key: rest.slice(slashIdx + 1),
  };
}

/**
 * Normalizes an S3 target string (with or without an `s3://` prefix) into bucket, key, and canonical URI.
 */
export function normalizeS3Target(rawTarget: string): {
  bucket: string;
  key: string;
  normalizedUri: string;
} {
  const cleaned = rawTarget.trim().replace(/^s3:\/\//i, "").replace(/^\/+/, "");
  const slashIdx = cleaned.indexOf("/");
  const bucket = slashIdx === -1 ? cleaned : cleaned.slice(0, slashIdx);
  const key = slashIdx === -1 ? "" : cleaned.slice(slashIdx + 1);
  const normalizedUri = key ? `s3://${bucket}/${key}` : `s3://${bucket}`;
  return { bucket, key, normalizedUri };
}
