import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../src/cli.ts";
import {
  formatMissingConfigError,
  matchesNoProxy,
  resolveAndApplyProxy,
  resolveAndApplyTls,
  validateAndResolveAuth,
} from "../src/env.ts";
import {
  bytesPerSecToMbps,
  computeS3MultipartEtag,
  formatBandwidth,
  formatBytes,
  formatEta,
  formatSpeed,
  maskProxyUrl,
  normalizeS3Target,
  parseByteSize,
  parseS3Uri,
  renderProgressBar,
} from "../src/format.ts";

describe("format utilities", () => {
  test("formats bytes across units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.00 KiB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MiB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GiB");
  });

  test("formats speed, bandwidth, and ETA", () => {
    expect(formatSpeed(1_500_000)).toBe("1.50 MB/s");
    expect(bytesPerSecToMbps(12_500_000)).toBe(100);
    expect(formatBandwidth(100)).toBe("100.00 Mbps");
    expect(formatBandwidth(1500)).toBe("1.50 Gbps");
    expect(formatEta(null)).toBe("--:--");
    expect(formatEta(45)).toBe("00:45");
    expect(formatEta(125)).toBe("02:05");
  });

  test("parses human byte sizes", () => {
    expect(parseByteSize("5242880")).toBe(5242880);
    expect(parseByteSize("5M")).toBe(5 * 1024 * 1024);
    expect(parseByteSize("10MiB")).toBe(10 * 1024 * 1024);
    expect(parseByteSize("1G")).toBe(1024 * 1024 * 1024);
    expect(() => parseByteSize("abc")).toThrow();
  });

  test("masks proxy credentials, parses S3 URIs, and normalizes S3 targets without s3://", () => {
    expect(maskProxyUrl("http://alice:s3cr3t@proxy.corp:8080")).toBe("http://***:***@proxy.corp:8080");
    expect(parseS3Uri("s3://my-bucket/folder/file.tar.gz")).toEqual({
      bucket: "my-bucket",
      key: "folder/file.tar.gz",
    });
    expect(parseS3Uri("my-bucket")).toBeNull();
    expect(normalizeS3Target("s3://my-bucket/dumps/20261116/")).toEqual({
      bucket: "my-bucket",
      key: "dumps/20261116/",
      normalizedUri: "s3://my-bucket/dumps/20261116/",
    });
    expect(normalizeS3Target("my-bucket/dumps/20261116/")).toEqual({
      bucket: "my-bucket",
      key: "dumps/20261116/",
      normalizedUri: "s3://my-bucket/dumps/20261116/",
    });
    expect(normalizeS3Target("my-bucket")).toEqual({
      bucket: "my-bucket",
      key: "",
      normalizedUri: "s3://my-bucket",
    });
  });

  test("computes S3 multipart ETag", () => {
    const p1 = new Bun.CryptoHasher("md5").update("part-1").digest();
    const p2 = new Bun.CryptoHasher("md5").update("part-2").digest();
    const etag = computeS3MultipartEtag([p1, p2]);
    expect(etag).toMatch(/^[a-f0-9]{32}-2$/);
  });

  test("renders progress bar", () => {
    expect(renderProgressBar(50, 10)).toBe("[█████░░░░░]  50.0%");
  });
});

describe("environment validation, proxy, and TLS resolution", () => {
  test("reports all missing credentials in English", () => {
    const res = validateAndResolveAuth({}, {});
    expect(res.valid).toBe(false);
    expect(res.missing.map((m) => m.field)).toEqual(["accessKeyId", "secretAccessKey", "bucket"]);
    const msg = formatMissingConfigError(res.missing);
    expect(msg).toContain("AWS_ACCESS_KEY_ID");
    expect(msg).toContain("AWS_SECRET_ACCESS_KEY");
    expect(msg).toContain("AWS_BUCKET");
  });

  test("prefers S3_* over AWS_* and resolves CLI overrides", () => {
    const res = validateAndResolveAuth(
      { bucket: "cli-bucket" },
      {
        AWS_ACCESS_KEY_ID: "aws-key",
        S3_ACCESS_KEY_ID: "s3-key",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        AWS_REGION: "eu-west-1",
      },
    );
    expect(res.valid).toBe(true);
    expect(res.auth?.accessKeyId).toBe("s3-key");
    expect(res.auth?.secretAccessKey).toBe("aws-secret");
    expect(res.auth?.bucket).toBe("cli-bucket");
    expect(res.auth?.region).toBe("eu-west-1");
  });

  test("evaluates NO_PROXY wildcard, domain suffix, port, and CIDR", () => {
    expect(matchesNoProxy("https://s3.internal.corp", "*.internal.corp")).toBe(true);
    expect(matchesNoProxy("http://10.20.30.40:9000", "10.0.0.0/8")).toBe(true);
    expect(matchesNoProxy("http://127.0.0.1:9000", "127.0.0.1:9000")).toBe(true);
    expect(matchesNoProxy("http://127.0.0.1:8080", "127.0.0.1:9000")).toBe(false);
    expect(matchesNoProxy("https://s3.us-east-1.amazonaws.com", "localhost,127.0.0.1")).toBe(false);
  });

  test("resolves HTTP_PROXY/HTTPS_PROXY and TLS insecure flags", () => {
    const env: Record<string, string | undefined> = {
      HTTPS_PROXY: "http://proxy.internal:8443",
      NO_PROXY: "localhost",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    };
    const proxy = resolveAndApplyProxy("https://s3.us-east-1.amazonaws.com", undefined, env);
    expect(proxy.activeProxyUrl).toBe("http://proxy.internal:8443");
    expect(proxy.bypassedByNoProxy).toBe(false);

    const tls = resolveAndApplyTls({}, env);
    expect(tls.allowInvalidCerts).toBe(true);
    expect(tls.source).toBe("env");
  });
});

describe("CLI argument parser", () => {
  test("parses positional and flag arguments", () => {
    const opts = parseCliArgs([
      "./archive.tar.gz",
      "s3://prod-backups/nightly/archive.tar.gz",
      "--part-size",
      "10M",
      "--queue-size=6",
      "--insecure",
      "--verify",
      "stat",
      "--isolated",
    ]);
    expect(opts.filePath).toBe("./archive.tar.gz");
    expect(opts.bucket).toBe("prod-backups");
    expect(opts.key).toBe("nightly/archive.tar.gz");
    expect(opts.partSize).toBe(10 * 1024 * 1024);
    expect(opts.queueSize).toBe(6);
    expect(opts.insecure).toBe(true);
    expect(opts.verifyMode).toBe("stat");
    expect(opts.isolated).toBe(true);
  });

  test("parses bash-expanded multi-file positionals with and without s3:// prefix", () => {
    const withPrefix = parseCliArgs([
      "/tmp/CLBP_CRT_261112_01.DMP",
      "/tmp/CLBP_CRT_261112_02.DMP",
      "/tmp/CLBP_CRT_261112_03.DMP",
      "/tmp/CLBP_CRT_261112_04.DMP",
      "s3://s3-ibd-ne-saeast1-mwlcr0neostabdbops-pro/dumps/20261116/",
    ]);
    expect(withPrefix.filePaths).toEqual([
      "/tmp/CLBP_CRT_261112_01.DMP",
      "/tmp/CLBP_CRT_261112_02.DMP",
      "/tmp/CLBP_CRT_261112_03.DMP",
      "/tmp/CLBP_CRT_261112_04.DMP",
    ]);
    expect(withPrefix.bucket).toBe("s3-ibd-ne-saeast1-mwlcr0neostabdbops-pro");
    expect(withPrefix.key).toBe("dumps/20261116/");

    const withoutPrefix = parseCliArgs([
      "/tmp/CLBP_CRT_261112_01.DMP",
      "/tmp/CLBP_CRT_261112_02.DMP",
      "/tmp/CLBP_CRT_261112_03.DMP",
      "/tmp/CLBP_CRT_261112_04.DMP",
      "s3-ibd-ne-saeast1-mwlcr0neostabdbops-pro/dumps/20261116/",
    ]);
    expect(withoutPrefix.filePaths).toHaveLength(4);
    expect(withoutPrefix.bucket).toBe("s3-ibd-ne-saeast1-mwlcr0neostabdbops-pro");
    expect(withoutPrefix.key).toBe("dumps/20261116/");
  });

  test("rejects unknown flags and invalid verify modes", () => {
    expect(() => parseCliArgs(["--unknown-flag"])).toThrow();
    expect(() => parseCliArgs(["--verify", "bogus"])).toThrow();
  });
});
