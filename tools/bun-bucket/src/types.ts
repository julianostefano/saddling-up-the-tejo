/**
 * Core domain types for the Bun Bucket CLI and TUI (native S3 uploader & downloader).
 */

export type VerifyMode = "full" | "stat" | "none";

export type TransferOperation = "upload" | "download";

export type OverwritePolicy = "ask" | "overwrite" | "skip";

export type OverwriteDecision = "overwrite" | "skip" | "overwrite-all" | "skip-all" | "abort";

export interface OverwritePromptInfo {
  direction?: TransferOperation;
  bucket: string;
  key: string;
  localPath: string;
  localSizeBytes: number;
  remoteSizeBytes?: number;
  remoteEtag?: string;
  remoteLastModified?: Date;
}

export interface ResolvedUploadTarget {
  localPath: string;
  relativePath: string;
  objectKey: string;
  sizeBytes: number;
}

export interface ResolvedDownloadTarget {
  objectKey: string;
  relativePath: string;
  localPath: string;
  remoteSizeBytes?: number;
  remoteEtag?: string;
  remoteLastModified?: Date;
}

export type TransferPhase =
  | "analyzing"
  | "hashing"
  | "uploading"
  | "downloading"
  | "verifying"
  | "completed"
  | "failed";

export type S3Acl =
  | "private"
  | "public-read"
  | "public-read-write"
  | "aws-exec-read"
  | "authenticated-read"
  | "bucket-owner-read"
  | "bucket-owner-full-control"
  | "log-delivery-write";

export type S3StorageClass =
  | "STANDARD"
  | "REDUCED_REDUNDANCY"
  | "STANDARD_IA"
  | "ONEZONE_IA"
  | "INTELLIGENT_TIERING"
  | "GLACIER"
  | "DEEP_ARCHIVE"
  | "OUTPOSTS"
  | "GLACIER_IR"
  | "SNOW"
  | "EXPRESS_ONEZONE";

export interface S3AuthConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint?: string;
  bucket: string;
  sessionToken?: string;
  virtualHostedStyle: boolean;
  acl?: S3Acl;
  storageClass?: S3StorageClass;
  requestPayer?: boolean;
  sources: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    endpoint: string;
    bucket: string;
    sessionToken?: string;
  };
}

export interface ProxyConfig {
  httpProxy?: string;
  httpsProxy?: string;
  allProxy?: string;
  noProxy?: string;
  activeProxyUrl?: string;
  sourceEnvVar?: string;
  bypassedByNoProxy: boolean;
  targetOrigin: string;
}

export interface TlsConfig {
  allowInvalidCerts: boolean;
  source: "cli" | "env" | "default";
  sslCertFile?: string;
  sslCertDir?: string;
}

export interface CliOptions {
  operation?: TransferOperation;
  filePath?: string;
  filePaths?: string[];
  outputPath?: string;
  bucket?: string;
  key?: string;
  endpoint?: string;
  region?: string;
  partSize: number;
  multipartThreshold: number;
  queueSize: number;
  retry: number;
  verifyMode: VerifyMode;
  linkSpeedMbps: number;
  proxy?: string;
  insecure?: boolean;
  strictTls?: boolean;
  virtualHostedStyle?: boolean;
  acl?: S3Acl;
  storageClass?: S3StorageClass;
  requestPayer?: boolean;
  overwritePolicy?: OverwritePolicy;
  includeHidden?: boolean;
  isolated: boolean;
  tui: boolean;
  json: boolean;
  dryRun: boolean;
  help: boolean;
  version: boolean;
}

export interface FileAnalysis {
  absolutePath: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  useMultipart: boolean;
  multipartThreshold: number;
  partSize: number;
  totalParts: number;
  queueSize: number;
  reason: string;
}

export interface ChecksumResult {
  sha256Hex: string;
  md5Hex: string;
  multipartEtag?: string;
  partCount: number;
  elapsedMs: number;
}

export interface ProgressSnapshot {
  phase: TransferPhase;
  bytesProcessed: number;
  totalBytes: number;
  percent: number;
  speedBytesPerSec: number;
  avgSpeedBytesPerSec: number;
  peakSpeedBytesPerSec: number;
  bandwidthMbps: number;
  bandwidthUtilizationPct: number;
  etaSeconds: number | null;
  elapsedMs: number;
  currentPart?: number;
  totalParts?: number;
  message?: string;
}

export interface VerificationResult {
  mode: VerifyMode;
  performed: boolean;
  remoteExists: boolean;
  remoteSizeBytes?: number;
  remoteEtag?: string;
  remoteSha256Hex?: string;
  sizeMatch: boolean | null;
  etagMatch: boolean | null;
  sha256Match: boolean | null;
  downloadSpeedBytesPerSec?: number;
  downloadBandwidthMbps?: number;
  elapsedMs: number;
}

export interface UploadReport {
  operation?: TransferOperation;
  success: boolean;
  skipped?: boolean;
  skipReason?: string;
  bucket: string;
  key: string;
  localPath?: string;
  endpoint: string;
  region: string;
  fileAnalysis: FileAnalysis;
  checksum: ChecksumResult;
  proxy: ProxyConfig;
  tls: TlsConfig;
  upload: {
    strategy: "single-part" | "multipart";
    partsUploaded: number;
    bytesUploaded: number;
    durationMs: number;
    avgSpeedBytesPerSec: number;
    peakSpeedBytesPerSec: number;
    avgBandwidthMbps: number;
    bandwidthUtilizationPct: number;
  };
  verification: VerificationResult;
  error?: string;
}

export type TransferReport = UploadReport;

export interface BatchUploadReport {
  operation?: TransferOperation;
  success: boolean;
  bucket: string;
  endpoint: string;
  region: string;
  totalFiles: number;
  uploadedCount: number;
  skippedCount: number;
  failedCount: number;
  totalBytes: number;
  uploadedBytes: number;
  durationMs: number;
  avgSpeedBytesPerSec: number;
  avgBandwidthMbps: number;
  results: UploadReport[];
}

export type BatchTransferReport = BatchUploadReport;

export interface UploadCallbacks {
  onAnalysis?: (analysis: FileAnalysis) => void;
  onProgress?: (snapshot: ProgressSnapshot) => void;
  onLog?: (level: "info" | "warn" | "error" | "success", message: string) => void;
  onTargetStart?: (
    index: number,
    total: number,
    target: ResolvedUploadTarget | ResolvedDownloadTarget,
  ) => void;
  confirmOverwrite?: (info: OverwritePromptInfo) => Promise<OverwriteDecision>;
}

export interface EnvValidationResult {
  valid: boolean;
  missing: MissingFieldInfo[];
  warnings: string[];
  auth?: S3AuthConfig;
}

export interface MissingFieldInfo {
  field: string;
  envVars: string[];
  cliFlag: string;
  description: string;
}
