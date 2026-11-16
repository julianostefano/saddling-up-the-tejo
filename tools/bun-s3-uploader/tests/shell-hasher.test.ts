import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeFileChecksumsInWorker } from "../src/hasher.ts";
import { inspectLocalPathWithShell, listDirectoryEntriesWithShell } from "../src/shell.ts";

let workDir = "";
let smallFile = "";
let multiPartFile = "";

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "bun-s3-shell-hash-"));
  smallFile = join(workDir, "small-sample.txt");
  multiPartFile = join(workDir, "multipart-sample.bin");

  await Bun.write(smallFile, "Hello Bun Shell & Worker Hasher!");

  // 6 MiB deterministic payload (> 5 MiB part size)
  const buf = new Uint8Array(6 * 1024 * 1024);
  for (let i = 0; i < buf.length; i += 4096) {
    buf[i] = (i >> 12) & 0xff;
  }
  await Bun.write(multiPartFile, buf);
});

afterAll(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

describe("Bun Shell ($) integration", () => {
  test("inspects local files cross-platform via $", async () => {
    const info = await inspectLocalPathWithShell(smallFile);
    expect(info.exists).toBe(true);
    expect(info.isFile).toBe(true);
    expect(info.isDirectory).toBe(false);
    expect(info.fileName).toBe("small-sample.txt");
    expect(info.sizeBytes).toBe(32);
    expect(info.shellListingLine).toContain("small-sample.txt");
  });

  test("lists directory entries via $ ls -l", async () => {
    const entries = await listDirectoryEntriesWithShell(workDir);
    const names = entries.map((e) => e.name);
    expect(names).toContain("small-sample.txt");
    expect(names).toContain("multipart-sample.bin");
  });
});

describe("Worker SHA-256 & Multipart ETag computation", () => {
  test("computes exact SHA-256 and MD5 for small file in Worker", async () => {
    const bytes = await Bun.file(smallFile).bytes();
    const expectedSha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const expectedMd5 = new Bun.CryptoHasher("md5").update(bytes).digest("hex");

    const res = await computeFileChecksumsInWorker(smallFile, bytes.byteLength, {
      partSize: 5 * 1024 * 1024,
      useMultipart: false,
      linkSpeedMbps: 1000,
    });

    expect(res.sha256Hex).toBe(expectedSha);
    expect(res.md5Hex).toBe(expectedMd5);
    expect(res.partCount).toBe(1);
    expect(res.multipartEtag).toBeUndefined();
  });

  test("computes SHA-256 and AWS multipart ETag across multiple parts in Worker", async () => {
    const bytes = await Bun.file(multiPartFile).bytes();
    const expectedSha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const partSize = 5 * 1024 * 1024;
    let progressEvents = 0;

    const res = await computeFileChecksumsInWorker(multiPartFile, bytes.byteLength, {
      partSize,
      useMultipart: true,
      linkSpeedMbps: 1000,
      onProgress: () => {
        progressEvents++;
      },
    });

    expect(res.sha256Hex).toBe(expectedSha);
    expect(res.partCount).toBe(2);
    expect(res.multipartEtag).toMatch(/^[a-f0-9]{32}-2$/);
    expect(progressEvents).toBeGreaterThan(0);
  });
});
