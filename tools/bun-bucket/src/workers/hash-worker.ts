import { computeS3MultipartEtag } from "../format.ts";

declare var self: Worker;

export interface HashWorkerRequest {
  filePath: string;
  partSize: number;
  useMultipart: boolean;
}

export interface HashWorkerProgressMessage {
  kind: "progress";
  bytesProcessed: number;
  totalBytes: number;
}

export interface HashWorkerDoneMessage {
  kind: "done";
  sha256Hex: string;
  md5Hex: string;
  multipartEtag: string;
  partCount: number;
  elapsedMs: number;
}

export interface HashWorkerErrorMessage {
  kind: "error";
  error: string;
}

export type HashWorkerMessage =
  | HashWorkerProgressMessage
  | HashWorkerDoneMessage
  | HashWorkerErrorMessage;

// Install message handler synchronously before any top-level await (per Bun Workers guide).
self.onmessage = async (event: MessageEvent<HashWorkerRequest>) => {
  const { filePath, partSize, useMultipart } = event.data;
  const startMs = performance.now();

  try {
    const file = Bun.file(filePath);
    const totalBytes = file.size;
    const sha256 = new Bun.CryptoHasher("sha256");
    const md5 = new Bun.CryptoHasher("md5");

    const partDigests: Uint8Array[] = [];
    let partHasher = useMultipart ? new Bun.CryptoHasher("md5") : null;
    let partRemaining = partSize;

    let bytesProcessed = 0;
    let lastProgressSentMs = 0;

    if (totalBytes > 0) {
      const stream = file.stream();
      for await (const chunk of stream) {
        sha256.update(chunk);
        md5.update(chunk);

        if (useMultipart && partHasher) {
          let offset = 0;
          while (offset < chunk.byteLength) {
            const take = Math.min(partRemaining, chunk.byteLength - offset);
            partHasher.update(chunk.subarray(offset, offset + take));
            offset += take;
            partRemaining -= take;
            if (partRemaining === 0) {
              partDigests.push(partHasher.digest());
              partHasher = new Bun.CryptoHasher("md5");
              partRemaining = partSize;
            }
          }
        }

        bytesProcessed += chunk.byteLength;
        const now = performance.now();
        if (now - lastProgressSentMs >= 60 || bytesProcessed === totalBytes) {
          lastProgressSentMs = now;
          // Flat object with primitive fields triggers Bun's simple-object postMessage fast path.
          self.postMessage({
            kind: "progress",
            bytesProcessed,
            totalBytes,
          } satisfies HashWorkerProgressMessage);
        }
      }

      if (useMultipart && partHasher && partRemaining < partSize) {
        partDigests.push(partHasher.digest());
      }
    }

    const sha256Hex = sha256.digest("hex");
    const md5Hex = md5.digest("hex");
    const multipartEtag = useMultipart ? computeS3MultipartEtag(partDigests) : "";
    const elapsedMs = Math.max(1, performance.now() - startMs);

    self.postMessage({
      kind: "done",
      sha256Hex,
      md5Hex,
      multipartEtag,
      partCount: useMultipart ? partDigests.length : 1,
      elapsedMs,
    } satisfies HashWorkerDoneMessage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({
      kind: "error",
      error: message,
    } satisfies HashWorkerErrorMessage);
  }
};
