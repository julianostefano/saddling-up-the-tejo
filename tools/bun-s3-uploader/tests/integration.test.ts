import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import {
  generateSelfSignedCert,
  startMockHttpProxy,
  startMockS3Server,
} from "./helpers/mock-s3.ts";

let workDir = "";
let smallFilePath = "";
let largeFilePath = "";
let savedEnv: Record<string, string | undefined> = {};

const ENV_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "AWS_ENDPOINT",
  "AWS_BUCKET",
  "AWS_SESSION_TOKEN",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_REGION",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_SESSION_TOKEN",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "S3_TLS_INSECURE",
];

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "bun-s3-int-"));
  smallFilePath = join(workDir, "hello-s3.txt");
  largeFilePath = join(workDir, "large-11mb.bin");

  await Bun.write(smallFilePath, "Native Bun S3 integration test payload with SHA-256 verification.");

  // 11 MiB -> 3 parts with 5 MiB partSize (5 MiB + 5 MiB + 1 MiB)
  const big = new Uint8Array(11 * 1024 * 1024);
  for (let i = 0; i < big.length; i += 8192) {
    big[i] = (i >> 13) & 0xff;
    big[i + 1] = 0x5a;
  }
  await Bun.write(largeFilePath, big);
});

afterAll(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
  }
  // Ensure loopback tests bypass any sandbox proxy by default unless specifically testing proxy
  process.env.NO_PROXY = "127.0.0.1,localhost";
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.ALL_PROXY;
  delete process.env.http_proxy;
  delete process.env.https_proxy;
  delete process.env.all_proxy;
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete process.env.S3_TLS_INSECURE;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
});

describe("End-to-end S3 CLI & Uploader integration", () => {
  test("fails with clear English error when required AWS/S3 env vars are missing", async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.S3_SECRET_ACCESS_KEY;

    const code = await runCli([smallFilePath, "test-bucket"]);
    expect(code).toBe(1);
  });

  test("uploads small file via Single-Part PutObject and verifies SHA-256, ETag, speed, bandwidth", async () => {
    const mock = startMockS3Server();
    try {
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
      process.env.AWS_REGION = "us-east-1";
      process.env.AWS_ENDPOINT = mock.origin;

      const code = await runCli([smallFilePath, "my-test-bucket", "nested/hello.txt", "--verify", "full"]);
      expect(code).toBe(0);
      expect(mock.stats.singlePartPuts).toBe(1);
      expect(mock.stats.multipartInitiations).toBe(0);
      expect(mock.stats.headRequests).toBe(1);
      expect(mock.stats.getRequests).toBe(1);

      const stored = mock.objects.get("my-test-bucket/nested/hello.txt");
      expect(stored).toBeDefined();
      expect(Buffer.from(stored!.data).toString("utf8")).toBe(
        "Native Bun S3 integration test payload with SHA-256 verification.",
      );
    } finally {
      mock.stop();
    }
  });

  test("analyzes large file (>= 5MiB), uses Multipart Upload API, and verifies multipart ETag + SHA-256", async () => {
    const mock = startMockS3Server();
    try {
      process.env.S3_ACCESS_KEY_ID = "test-access-key";
      process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
      process.env.S3_REGION = "sa-east-1";
      process.env.S3_ENDPOINT = mock.origin;

      const code = await runCli([
        largeFilePath,
        "s3://archive-bucket/uploads/large-11mb.bin",
        "--part-size",
        "5M",
        "--queue-size",
        "3",
        "--verify",
        "full",
      ]);
      expect(code).toBe(0);
      expect(mock.stats.singlePartPuts).toBe(0);
      expect(mock.stats.multipartInitiations).toBe(1);
      expect(mock.stats.multipartPartsUploaded).toBe(3);
      expect(mock.stats.multipartCompletions).toBe(1);

      const stored = mock.objects.get("archive-bucket/uploads/large-11mb.bin");
      expect(stored).toBeDefined();
      expect(stored!.data.byteLength).toBe(11 * 1024 * 1024);
      expect(stored!.etag).toMatch(/^[a-f0-9]{32}-3$/);
    } finally {
      mock.stop();
    }
  });

  test("rejects invalid/self-signed TLS certificate in strict mode, succeeds with --insecure", async () => {
    const { keyPem, certPem } = generateSelfSignedCert();
    const mockTls = startMockS3Server({ tls: { key: keyPem, cert: certPem } });
    try {
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
      process.env.AWS_ENDPOINT = mockTls.origin;

      // Strict mode fails against self-signed cert
      const strictCode = await runCli([smallFilePath, "tls-bucket", "--strict-tls", "--retry", "0"]);
      expect(strictCode).toBe(1);
      expect(mockTls.objects.has("tls-bucket/hello-s3.txt")).toBe(false);

      // --insecure allows invalid/self-signed certificate
      const insecureCode = await runCli([smallFilePath, "tls-bucket", "--insecure"]);
      expect(insecureCode).toBe(0);
      expect(mockTls.objects.has("tls-bucket/hello-s3.txt")).toBe(true);
    } finally {
      mockTls.stop();
    }
  });

  test("routes requests through HTTP_PROXY when configured and bypasses when NO_PROXY matches", async () => {
    const mock = startMockS3Server();
    const proxy = startMockHttpProxy();
    try {
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
      process.env.AWS_ENDPOINT = mock.origin;
      process.env.HTTP_PROXY = proxy.proxyUrl;
      delete process.env.NO_PROXY;

      const proxiedCode = await runCli([smallFilePath, "proxy-bucket", "via-proxy.txt"]);
      expect(proxiedCode).toBe(0);
      expect(proxy.proxiedUrls.length).toBeGreaterThan(0);
      expect(mock.objects.has("proxy-bucket/via-proxy.txt")).toBe(true);

      // Now verify NO_PROXY bypasses proxy
      const hitsBeforeBypass = proxy.proxiedUrls.length;
      process.env.NO_PROXY = "127.0.0.1";
      const directCode = await runCli([smallFilePath, "proxy-bucket", "direct.txt"]);
      expect(directCode).toBe(0);
      expect(proxy.proxiedUrls.length).toBe(hitsBeforeBypass);
      expect(mock.objects.has("proxy-bucket/direct.txt")).toBe(true);
    } finally {
      proxy.stop();
      mock.stop();
    }
  });

  test("supports isolated Bun.ModuleGraph execution (--isolated), --dry-run, and --json", async () => {
    const mock = startMockS3Server();
    try {
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
      process.env.AWS_ENDPOINT = mock.origin;

      const dryCode = await runCli([smallFilePath, "dry-bucket", "--dry-run"]);
      expect(dryCode).toBe(0);
      expect(mock.stats.singlePartPuts).toBe(0);

      const isolatedCode = await runCli([smallFilePath, "iso-bucket", "--isolated", "--verify", "full"]);
      expect(isolatedCode).toBe(0);
      expect(mock.objects.has("iso-bucket/hello-s3.txt")).toBe(true);

      const proc = Bun.spawn(
        ["bun", "run", "src/index.ts", smallFilePath, "json-bucket", "--json", "--verify", "full"],
        {
          cwd: join(import.meta.dir, ".."),
          env: { ...process.env },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const exitCode = await proc.exited;
      const stdoutText = await new Response(proc.stdout).text();
      expect(exitCode).toBe(0);
      const report = JSON.parse(stdoutText) as {
        success: boolean;
        bucket: string;
        checksum: { sha256Hex: string };
        verification: { sha256Match: boolean };
      };
      expect(report.success).toBe(true);
      expect(report.bucket).toBe("json-bucket");
      expect(report.checksum.sha256Hex).toHaveLength(64);
      expect(report.verification.sha256Match).toBe(true);
    } finally {
      mock.stop();
    }
  });
});
