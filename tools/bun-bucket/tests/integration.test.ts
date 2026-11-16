import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
let batchDirPath = "";
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
  batchDirPath = join(workDir, "site");
  mkdirSync(join(batchDirPath, "assets"), { recursive: true });

  await Bun.write(smallFilePath, "Native Bun S3 integration test payload with SHA-256 verification.");
  await Bun.write(join(batchDirPath, "index.html"), "<h1>Index</h1>");
  await Bun.write(join(batchDirPath, "notes.txt"), "Notes");
  await Bun.write(join(batchDirPath, "assets", "app.js"), "console.log('ok');");

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
      expect(mock.stats.headRequests).toBe(2);
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

  test("uploads entire directories recursively and wildcard patterns with prefix", async () => {
    const mock = startMockS3Server();
    try {
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
      process.env.AWS_ENDPOINT = mock.origin;

      // Entire directory upload
      const dirCode = await runCli([batchDirPath, "site-bucket", "--prefix", "v2"]);
      expect(dirCode).toBe(0);
      expect(mock.objects.has("site-bucket/v2/index.html")).toBe(true);
      expect(mock.objects.has("site-bucket/v2/notes.txt")).toBe(true);
      expect(mock.objects.has("site-bucket/v2/assets/app.js")).toBe(true);

      // Wildcard upload (*.html and assets/*.js via glob)
      const wildcardCode = await runCli([join(batchDirPath, "**", "*.js"), "js-bucket"]);
      expect(wildcardCode).toBe(0);
      expect(mock.objects.has("js-bucket/assets/app.js")).toBe(true);
      expect(mock.objects.has("js-bucket/index.html")).toBe(false);
    } finally {
      mock.stop();
    }
  });

  test("requires confirmation before overwriting existing objects and respects --skip-existing / --yes / interactive choices", async () => {
    const mock = startMockS3Server();
    try {
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
      process.env.AWS_ENDPOINT = mock.origin;

      // Seed existing object
      mock.objects.set("ov-bucket/hello-s3.txt", {
        bucket: "ov-bucket",
        key: "hello-s3.txt",
        data: new TextEncoder().encode("OLD_CONTENT"),
        etag: "old-etag",
        contentType: "text/plain",
        lastModified: new Date(),
      });

      // 1. Non-interactive without --yes or --skip-existing must refuse overwrite
      const refusedCode = await runCli([smallFilePath, "ov-bucket"]);
      expect(refusedCode).toBe(1);
      expect(Buffer.from(mock.objects.get("ov-bucket/hello-s3.txt")!.data).toString()).toBe("OLD_CONTENT");

      // 2. --skip-existing skips cleanly without overwriting
      const skippedCode = await runCli([smallFilePath, "ov-bucket", "--skip-existing"]);
      expect(skippedCode).toBe(0);
      expect(Buffer.from(mock.objects.get("ov-bucket/hello-s3.txt")!.data).toString()).toBe("OLD_CONTENT");

      // 3. Interactive confirmation: "skip" keeps old content
      let promptCalls = 0;
      const userSkipCode = await runCli([smallFilePath, "ov-bucket"], {
        confirmOverwrite: async () => {
          promptCalls++;
          return "skip";
        },
      });
      expect(userSkipCode).toBe(0);
      expect(promptCalls).toBe(1);
      expect(Buffer.from(mock.objects.get("ov-bucket/hello-s3.txt")!.data).toString()).toBe("OLD_CONTENT");

      // 4. Interactive confirmation: "overwrite" replaces content
      const userOverwriteCode = await runCli([smallFilePath, "ov-bucket"], {
        confirmOverwrite: async () => "overwrite",
      });
      expect(userOverwriteCode).toBe(0);
      expect(Buffer.from(mock.objects.get("ov-bucket/hello-s3.txt")!.data).toString()).toBe(
        "Native Bun S3 integration test payload with SHA-256 verification.",
      );

      // 5. Batch overwrite-all: prompt once for multiple existing objects, then auto-overwrite rest
      mock.objects.set("site-ov/index.html", {
        bucket: "site-ov",
        key: "index.html",
        data: new TextEncoder().encode("OLD_HTML"),
        etag: "e1",
        contentType: "text/html",
        lastModified: new Date(),
      });
      mock.objects.set("site-ov/notes.txt", {
        bucket: "site-ov",
        key: "notes.txt",
        data: new TextEncoder().encode("OLD_NOTES"),
        etag: "e2",
        contentType: "text/plain",
        lastModified: new Date(),
      });

      let batchPromptCount = 0;
      const batchCode = await runCli([batchDirPath, "site-ov"], {
        confirmOverwrite: async () => {
          batchPromptCount++;
          return "overwrite-all";
        },
      });
      expect(batchCode).toBe(0);
      expect(batchPromptCount).toBe(1);
      expect(Buffer.from(mock.objects.get("site-ov/index.html")!.data).toString()).toBe("<h1>Index</h1>");
      expect(Buffer.from(mock.objects.get("site-ov/notes.txt")!.data).toString()).toBe("Notes");
    } finally {
      mock.stop();
    }
  });

  test("normalizes targets missing s3:// prefix, appends filename suffix on folder targets, and handles bash-expanded files", async () => {
    const mock = startMockS3Server();
    try {
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
      process.env.AWS_ENDPOINT = mock.origin;

      // Single file target without `s3://` and without trailing slash (folder prefix)
      const codeNoSlash = await runCli([smallFilePath, "no-scheme-bucket/dumps/20261116"]);
      expect(codeNoSlash).toBe(0);
      expect(mock.objects.has("no-scheme-bucket/dumps/20261116/hello-s3.txt")).toBe(true);

      // Single file target without `s3://` and with trailing slash
      const codeSlash = await runCli([smallFilePath, "no-scheme-bucket/dumps/20261117/"]);
      expect(codeSlash).toBe(0);
      expect(mock.objects.has("no-scheme-bucket/dumps/20261117/hello-s3.txt")).toBe(true);

      // Bash-expanded positional files + target without `s3://`
      const f1 = join(batchDirPath, "index.html");
      const f2 = join(batchDirPath, "notes.txt");
      const f3 = join(batchDirPath, "assets", "app.js");
      const expandedCode = await runCli([f1, f2, f3, "expanded-bucket/dumps/20261116/"]);
      expect(expandedCode).toBe(0);
      expect(mock.objects.has("expanded-bucket/dumps/20261116/index.html")).toBe(true);
      expect(mock.objects.has("expanded-bucket/dumps/20261116/notes.txt")).toBe(true);
      expect(mock.objects.has("expanded-bucket/dumps/20261116/app.js")).toBe(true);
    } finally {
      mock.stop();
    }
  });

  test("succeeds on multipart SSE-KMS encrypted buckets where ETag digest differs but part count and SHA-256 match", async () => {
    const mockSseKms = startMockS3Server({ simulateSseKms: true });
    try {
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
      process.env.AWS_ENDPOINT = mockSseKms.origin;

      const code = await runCli([
        largeFilePath,
        "kms-bucket/dumps/20261116/",
        "--part-size",
        "5M",
        "--queue-size",
        "3",
        "--verify",
        "full",
      ]);
      expect(code).toBe(0);
      const stored = mockSseKms.objects.get("kms-bucket/dumps/20261116/large-11mb.bin");
      expect(stored).toBeDefined();
      expect(stored!.etag).toBe(`${"a".repeat(32)}-3`);
    } finally {
      mockSseKms.stop();
    }
  });

  test("downloads a single file from S3 (s3:// auto-detect & download subcommand), verifies SHA-256 and ETag, and guards local overwrites", async () => {
    const mock = startMockS3Server();
    try {
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
      process.env.AWS_ENDPOINT = mock.origin;

      // Upload first so bucket has real single-part & multipart objects
      expect(await runCli([smallFilePath, "s3://dl-bucket/dumps/hello-s3.txt"])).toBe(0);
      expect(
        await runCli([largeFilePath, "s3://dl-bucket/dumps/large-11mb.bin", "--part-size", "5M"]),
      ).toBe(0);

      const outDir = join(workDir, "dl-single");
      mkdirSync(outDir, { recursive: true });

      // 1. Auto-detected download via s3:// source URL into output dir
      const dlSingleCode = await runCli(["s3://dl-bucket/dumps/hello-s3.txt", outDir]);
      expect(dlSingleCode).toBe(0);
      const downloadedSmall = join(outDir, "hello-s3.txt");
      expect(existsSync(downloadedSmall)).toBe(true);
      expect(await Bun.file(downloadedSmall).text()).toBe(
        "Native Bun S3 integration test payload with SHA-256 verification.",
      );

      // 2. Local overwrite protection: non-TTY must refuse without --yes / --skip-existing
      await Bun.write(downloadedSmall, "LOCAL_MODIFIED");
      const refusedCode = await runCli(["s3://dl-bucket/dumps/hello-s3.txt", downloadedSmall]);
      expect(refusedCode).toBe(1);
      expect(await Bun.file(downloadedSmall).text()).toBe("LOCAL_MODIFIED");

      // 3. --skip-existing skips cleanly without overwriting
      const skippedCode = await runCli([
        "download",
        "dl-bucket/dumps/hello-s3.txt",
        downloadedSmall,
        "--skip-existing",
      ]);
      expect(skippedCode).toBe(0);
      expect(await Bun.file(downloadedSmall).text()).toBe("LOCAL_MODIFIED");

      // 4. Interactive confirmOverwrite overrides cleanly + --yes / JSON report check
      const interactiveCode = await runCli(["download", "dl-bucket/dumps/hello-s3.txt", downloadedSmall], {
        confirmOverwrite: async (info) => {
          expect(info.direction).toBe("download");
          return "overwrite";
        },
      });
      expect(interactiveCode).toBe(0);
      expect(await Bun.file(downloadedSmall).text()).toBe(
        "Native Bun S3 integration test payload with SHA-256 verification.",
      );

      // 5. Large multipart object download via --isolated + --yes
      const largeOut = join(outDir, "large-11mb.bin");
      const largeDlCode = await runCli([
        "download",
        "dl-bucket/dumps/large-11mb.bin",
        largeOut,
        "--isolated",
        "--yes",
      ]);
      expect(largeDlCode).toBe(0);
      expect(Bun.file(largeOut).size).toBe(11 * 1024 * 1024);
    } finally {
      mock.stop();
    }
  });

  test("downloads wildcard patterns and key prefixes via S3Client.list() and Bun.Glob", async () => {
    const mock = startMockS3Server();
    try {
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
      process.env.AWS_ENDPOINT = mock.origin;

      // Seed bucket objects
      const seed = async (bucket: string, key: string, body: string) => {
        const data = new TextEncoder().encode(body);
        const etag = new Bun.CryptoHasher("md5").update(data).digest("hex");
        mock.objects.set(`${bucket}/${key}`, {
          bucket,
          key,
          data,
          etag,
          contentType: "application/octet-stream",
          lastModified: new Date(),
        });
      };

      await seed("wild-bucket", "dumps/20261116/CLBP_01.DMP", "DUMP_01");
      await seed("wild-bucket", "dumps/20261116/CLBP_02.DMP", "DUMP_02");
      await seed("wild-bucket", "dumps/20261116/empty.dmp", "");
      await seed("wild-bucket", "dumps/20261116/notes.log", "IGNORE_LOG");
      await seed("wild-bucket", "dumps/20261116/sub/nested.js", "console.log('sub');");
      await seed("wild-bucket", "dumps/20261116/root.js", "console.log('root');");

      const wildOutDir = join(workDir, "dl-wild");
      const wildCode = await runCli([
        "s3://wild-bucket/dumps/20261116/*.DMP",
        wildOutDir,
        "--verify",
        "full",
      ]);
      expect(wildCode).toBe(0);
      expect(mock.stats.listRequests).toBeGreaterThan(0);
      expect(await Bun.file(join(wildOutDir, "CLBP_01.DMP")).text()).toBe("DUMP_01");
      expect(await Bun.file(join(wildOutDir, "CLBP_02.DMP")).text()).toBe("DUMP_02");
      expect(existsSync(join(wildOutDir, "notes.log"))).toBe(false);

      // Zero-byte download & JSON report verification
      const emptyOut = join(workDir, "dl-empty.dmp");
      const jsonDlProc = Bun.spawn(
        ["bun", "run", "src/index.ts", "download", "wild-bucket/dumps/20261116/empty.dmp", emptyOut, "--json"],
        {
          cwd: join(import.meta.dir, ".."),
          env: { ...process.env },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(await jsonDlProc.exited).toBe(0);
      const dlReport = JSON.parse(await new Response(jsonDlProc.stdout).text()) as {
        operation: string;
        success: boolean;
        localPath: string;
        verification: { sha256Match: boolean };
      };
      expect(dlReport.operation).toBe("download");
      expect(dlReport.success).toBe(true);
      expect(dlReport.localPath).toBe(emptyOut);
      expect(dlReport.verification.sha256Match).toBe(true);
      expect(Bun.file(emptyOut).size).toBe(0);

      // Recursive wildcard without s3:// scheme via `download` subcommand
      const jsOutDir = join(workDir, "dl-js");
      const jsCode = await runCli([
        "download",
        "wild-bucket/dumps/20261116/**/*.js",
        jsOutDir,
      ]);
      expect(jsCode).toBe(0);
      expect(await Bun.file(join(jsOutDir, "root.js")).text()).toBe("console.log('root');");
      expect(await Bun.file(join(jsOutDir, "sub", "nested.js")).text()).toBe("console.log('sub');");
      expect(existsSync(join(jsOutDir, "CLBP_01.DMP"))).toBe(false);

      // Prefix fallback download (folder path without trailing `/` or `*`)
      const prefixOutDir = join(workDir, "dl-prefix");
      const prefixCode = await runCli(["download", "wild-bucket/dumps/20261116", prefixOutDir]);
      expect(prefixCode).toBe(0);
      expect(await Bun.file(join(prefixOutDir, "notes.log")).text()).toBe("IGNORE_LOG");
      expect(await Bun.file(join(prefixOutDir, "CLBP_01.DMP")).text()).toBe("DUMP_01");
      expect(await Bun.file(join(prefixOutDir, "empty.dmp")).text()).toBe("");
    } finally {
      mock.stop();
    }
  });
});
