import { TransferMeter } from "./metrics.ts";
import type { ChecksumResult, ProgressSnapshot } from "./types.ts";
import type { HashWorkerMessage, HashWorkerRequest } from "./workers/hash-worker.ts";

/**
 * Computes SHA-256, MD5, and AWS S3 multipart ETag inside a dedicated Bun Worker thread
 * so hashing large files never blocks the main event loop or CLI/TUI rendering.
 */
export async function computeFileChecksumsInWorker(
  filePath: string,
  totalBytes: number,
  options: {
    partSize: number;
    useMultipart: boolean;
    linkSpeedMbps: number;
    onProgress?: (snapshot: ProgressSnapshot) => void;
  },
): Promise<ChecksumResult> {
  const workerUrl = new URL("./workers/hash-worker.ts", import.meta.url).href;
  const meter = new TransferMeter("hashing", totalBytes, options.linkSpeedMbps);

  return await new Promise<ChecksumResult>((resolve, reject) => {
    const worker = new Worker(workerUrl);
    let settled = false;

    const cleanup = () => {
      try {
        worker.terminate();
      } catch {
        // Ignore termination errors if worker already exited
      }
    };

    worker.addEventListener("message", (event: MessageEvent<HashWorkerMessage>) => {
      const msg = event.data;
      if (msg.kind === "progress") {
        meter.setBytes(msg.bytesProcessed);
        options.onProgress?.(meter.snapshot("Computing local SHA-256 / MD5 checksums..."));
        return;
      }

      if (msg.kind === "done") {
        settled = true;
        meter.setBytes(totalBytes);
        options.onProgress?.(meter.snapshot("Local SHA-256 checksum computed."));
        cleanup();
        resolve({
          sha256Hex: msg.sha256Hex,
          md5Hex: msg.md5Hex,
          multipartEtag: msg.multipartEtag || undefined,
          partCount: msg.partCount,
          elapsedMs: msg.elapsedMs,
        });
        return;
      }

      if (msg.kind === "error") {
        settled = true;
        cleanup();
        reject(new Error(`Checksum worker failed: ${msg.error}`));
      }
    });

    worker.addEventListener("error", (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Checksum worker crashed: ${event.message || "unknown error"}`));
    });

    const req: HashWorkerRequest = {
      filePath,
      partSize: options.partSize,
      useMultipart: options.useMultipart,
    };
    worker.postMessage(req);
  });
}
