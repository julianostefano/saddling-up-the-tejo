import type {
  CliOptions,
  EnvValidationResult,
  MissingFieldInfo,
  ProxyConfig,
  S3AuthConfig,
  TlsConfig,
} from "./types.ts";

type EnvMap = Record<string, string | undefined>;

function readEnv(env: EnvMap, primary: string, fallback?: string): { value?: string; source?: string } {
  const pVal = env[primary]?.trim();
  if (pVal) return { value: pVal, source: primary };
  if (fallback) {
    const fVal = env[fallback]?.trim();
    if (fVal) return { value: fVal, source: fallback };
  }
  return {};
}

function readCaseInsensitiveEnv(env: EnvMap, upperName: string): { value?: string; source?: string } {
  const upper = env[upperName]?.trim();
  if (upper) return { value: upper, source: upperName };
  const lowerName = upperName.toLowerCase();
  const lower = env[lowerName]?.trim();
  if (lower) return { value: lower, source: lowerName };
  return {};
}

/**
 * Resolves and validates S3 authentication & target configuration from environment variables and CLI overrides.
 * Follows Bun's S3 resolution rules: `S3_*` takes precedence over `AWS_*`.
 */
export function validateAndResolveAuth(
  options: Pick<
    CliOptions,
    "bucket" | "endpoint" | "region" | "virtualHostedStyle" | "acl" | "storageClass" | "requestPayer"
  >,
  env: EnvMap = process.env,
): EnvValidationResult {
  const missing: MissingFieldInfo[] = [];
  const warnings: string[] = [];

  const accessKey = readEnv(env, "S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID");
  const secretKey = readEnv(env, "S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY");
  const regionRes = options.region
    ? { value: options.region.trim(), source: "cli:--region" }
    : readEnv(env, "S3_REGION", "AWS_REGION");
  const endpointRes = options.endpoint
    ? { value: options.endpoint.trim(), source: "cli:--endpoint" }
    : readEnv(env, "S3_ENDPOINT", "AWS_ENDPOINT");
  const bucketRes = options.bucket
    ? { value: options.bucket.trim(), source: "cli:bucket" }
    : readEnv(env, "S3_BUCKET", "AWS_BUCKET");
  const sessionTokenRes = readEnv(env, "S3_SESSION_TOKEN", "AWS_SESSION_TOKEN");

  if (!accessKey.value) {
    missing.push({
      field: "accessKeyId",
      envVars: ["S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"],
      cliFlag: "(set via environment variable)",
      description: "AWS / S3 Access Key ID is required for authentication.",
    });
  }

  if (!secretKey.value) {
    missing.push({
      field: "secretAccessKey",
      envVars: ["S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"],
      cliFlag: "(set via environment variable)",
      description: "AWS / S3 Secret Access Key is required for request signing.",
    });
  }

  if (!bucketRes.value) {
    missing.push({
      field: "bucket",
      envVars: ["S3_BUCKET", "AWS_BUCKET"],
      cliFlag: "--bucket <name> or positional <bucket>",
      description: "Destination S3 bucket name is required.",
    });
  }

  let effectiveRegion = regionRes.value;
  let regionSource = regionRes.source ?? "default:us-east-1";
  if (!effectiveRegion) {
    effectiveRegion = "us-east-1";
    warnings.push(
      "Neither S3_REGION nor AWS_REGION is set; defaulting region to \"us-east-1\".",
    );
  }

  if (endpointRes.value) {
    try {
      const parsed = new URL(endpointRes.value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        warnings.push(
          `Endpoint "${endpointRes.value}" uses unusual protocol "${parsed.protocol}"; expected http: or https:.`,
        );
      }
    } catch {
      missing.push({
        field: "endpoint",
        envVars: ["S3_ENDPOINT", "AWS_ENDPOINT"],
        cliFlag: "--endpoint <url>",
        description: `Invalid endpoint URL "${endpointRes.value}". Expected a valid http:// or https:// URL.`,
      });
    }
  }

  if (missing.length > 0) {
    return { valid: false, missing, warnings };
  }

  const virtualHostedStyle =
    options.virtualHostedStyle ??
    (env.S3_VIRTUAL_HOSTED_STYLE === "1" || env.S3_VIRTUAL_HOSTED_STYLE === "true");

  const auth: S3AuthConfig = {
    accessKeyId: accessKey.value!,
    secretAccessKey: secretKey.value!,
    region: effectiveRegion,
    endpoint: endpointRes.value,
    bucket: bucketRes.value!,
    sessionToken: sessionTokenRes.value,
    virtualHostedStyle,
    acl: options.acl,
    storageClass: options.storageClass,
    requestPayer: options.requestPayer,
    sources: {
      accessKeyId: accessKey.source!,
      secretAccessKey: secretKey.source!,
      region: regionSource,
      endpoint: endpointRes.source ?? "inferred (AWS S3)",
      bucket: bucketRes.source!,
      sessionToken: sessionTokenRes.source,
    },
  };

  return { valid: true, missing: [], warnings, auth };
}

/**
 * Formats missing authentication/configuration fields into a clear English error message.
 */
export function formatMissingConfigError(missing: MissingFieldInfo[]): string {
  const lines: string[] = [
    "Missing required S3 configuration / environment variables:",
    "",
  ];
  for (const item of missing) {
    lines.push(`  - ${item.field}: ${item.description}`);
    lines.push(`    Environment variables: ${item.envVars.join(" or ")}`);
    if (item.cliFlag && !item.cliFlag.startsWith("(")) {
      lines.push(`    CLI option: ${item.cliFlag}`);
    }
  }
  lines.push("");
  lines.push("Example (PowerShell):");
  lines.push('  $env:AWS_ACCESS_KEY_ID="AKIA..."');
  lines.push('  $env:AWS_SECRET_ACCESS_KEY="secret..."');
  lines.push('  $env:AWS_REGION="us-east-1"');
  lines.push("");
  lines.push("Example (Bash):");
  lines.push('  export AWS_ACCESS_KEY_ID="AKIA..."');
  lines.push('  export AWS_SECRET_ACCESS_KEY="secret..."');
  lines.push('  export AWS_REGION="us-east-1"');
  return lines.join("\n");
}

/**
 * Resolves the effective S3 endpoint origin URL for proxy/NO_PROXY inspection.
 */
export function resolveTargetEndpointOrigin(auth: Pick<S3AuthConfig, "endpoint" | "region" | "bucket" | "virtualHostedStyle">): string {
  if (auth.endpoint) {
    try {
      return new URL(auth.endpoint).origin;
    } catch {
      return auth.endpoint;
    }
  }
  if (auth.virtualHostedStyle && auth.bucket) {
    return `https://${auth.bucket}.s3.${auth.region}.amazonaws.com`;
  }
  return `https://s3.${auth.region}.amazonaws.com`;
}

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

function matchCidrV4(ip: string, cidr: string): boolean {
  const [netStr, prefixStr] = cidr.split("/");
  if (!netStr || !prefixStr) return false;
  const ipNum = ipv4ToUint32(ip);
  const netNum = ipv4ToUint32(netStr);
  const prefix = Number(prefixStr);
  if (ipNum === null || netNum === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  if (prefix === 0) return true;
  const mask = (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

/**
 * Checks whether a target URL matches a `NO_PROXY` pattern list.
 * Supports `*`, domain suffixes (`.example.com`, `*.example.com`, `example.com`), `host:port`, and IPv4 CIDR blocks.
 */
export function matchesNoProxy(targetUrl: string, noProxyRaw?: string): boolean {
  if (!noProxyRaw || !noProxyRaw.trim()) return false;
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const entries = noProxyRaw.split(/[\s,]+/).filter(Boolean);

  for (const rawEntry of entries) {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) continue;
    if (entry === "*") return true;

    if (entry.includes("/") && ipv4ToUint32(host) !== null) {
      if (matchCidrV4(host, entry)) return true;
      continue;
    }

    let entryHost = entry;
    let entryPort: string | undefined;
    const bracketMatch = /^\[([^\]]+)\](?::(\d+))?$/.exec(entry);
    if (bracketMatch) {
      entryHost = bracketMatch[1] ?? "";
      entryPort = bracketMatch[2];
    } else if (!entry.includes("::")) {
      const colonIdx = entry.lastIndexOf(":");
      if (colonIdx > 0 && /^\d+$/.test(entry.slice(colonIdx + 1))) {
        entryHost = entry.slice(0, colonIdx);
        entryPort = entry.slice(colonIdx + 1);
      }
    }

    if (entryPort && entryPort !== port) {
      continue;
    }

    const cleanPattern = entryHost.replace(/^\*\.?/, "").replace(/^\./, "");
    if (!cleanPattern) continue;
    if (host === cleanPattern || host.endsWith(`.${cleanPattern}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves proxy settings from `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, and optional CLI `--proxy`.
 * If `--proxy` is specified, writes it to process env so Bun's native S3 client routes through it.
 */
export function resolveAndApplyProxy(
  targetOrigin: string,
  cliProxy?: string,
  env: EnvMap = process.env,
): ProxyConfig {
  if (cliProxy?.trim()) {
    const trimmed = cliProxy.trim();
    env.HTTP_PROXY = trimmed;
    env.HTTPS_PROXY = trimmed;
  }

  const httpProxy = readCaseInsensitiveEnv(env, "HTTP_PROXY");
  const httpsProxy = readCaseInsensitiveEnv(env, "HTTPS_PROXY");
  const allProxy = readCaseInsensitiveEnv(env, "ALL_PROXY");
  const noProxy = readCaseInsensitiveEnv(env, "NO_PROXY");

  const isHttps = targetOrigin.toLowerCase().startsWith("https:");
  let chosen = isHttps ? httpsProxy : httpProxy;
  if (!chosen.value && allProxy.value) {
    chosen = allProxy;
  }

  const bypassed = chosen.value ? matchesNoProxy(targetOrigin, noProxy.value) : false;

  return {
    httpProxy: httpProxy.value,
    httpsProxy: httpsProxy.value,
    allProxy: allProxy.value,
    noProxy: noProxy.value,
    activeProxyUrl: bypassed ? undefined : chosen.value,
    sourceEnvVar: cliProxy?.trim() ? "cli:--proxy" : chosen.source,
    bypassedByNoProxy: bypassed,
    targetOrigin,
  };
}

/**
 * Resolves TLS certificate verification settings and applies `NODE_TLS_REJECT_UNAUTHORIZED` when requested.
 */
export function resolveAndApplyTls(
  options: Pick<CliOptions, "insecure" | "strictTls">,
  env: EnvMap = process.env,
): TlsConfig {
  const sslCertFile = env.SSL_CERT_FILE?.trim() || undefined;
  const sslCertDir = env.SSL_CERT_DIR?.trim() || undefined;

  if (options.strictTls) {
    env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
    return {
      allowInvalidCerts: false,
      source: "cli",
      sslCertFile,
      sslCertDir,
    };
  }

  if (options.insecure) {
    env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    return {
      allowInvalidCerts: true,
      source: "cli",
      sslCertFile,
      sslCertDir,
    };
  }

  const envDisabled =
    env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    env.S3_TLS_INSECURE === "1" ||
    env.S3_TLS_INSECURE?.toLowerCase() === "true";

  if (envDisabled) {
    env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    return {
      allowInvalidCerts: true,
      source: "env",
      sslCertFile,
      sslCertDir,
    };
  }

  return {
    allowInvalidCerts: false,
    source: "default",
    sslCertFile,
    sslCertDir,
  };
}

/**
 * Inspects which S3/AWS environment variables are currently populated (for TUI diagnostics).
 */
export function getEnvDiagnostics(env: EnvMap = process.env): Array<{
  label: string;
  envVar: string;
  present: boolean;
  maskedValue: string;
}> {
  const keys: Array<{ label: string; primary: string; fallback?: string; secret?: boolean }> = [
    { label: "Access Key ID", primary: "S3_ACCESS_KEY_ID", fallback: "AWS_ACCESS_KEY_ID", secret: true },
    { label: "Secret Access Key", primary: "S3_SECRET_ACCESS_KEY", fallback: "AWS_SECRET_ACCESS_KEY", secret: true },
    { label: "Region", primary: "S3_REGION", fallback: "AWS_REGION" },
    { label: "Endpoint", primary: "S3_ENDPOINT", fallback: "AWS_ENDPOINT" },
    { label: "Default Bucket", primary: "S3_BUCKET", fallback: "AWS_BUCKET" },
    { label: "Session Token", primary: "S3_SESSION_TOKEN", fallback: "AWS_SESSION_TOKEN", secret: true },
    { label: "HTTPS Proxy", primary: "HTTPS_PROXY", fallback: "https_proxy" },
    { label: "HTTP Proxy", primary: "HTTP_PROXY", fallback: "http_proxy" },
    { label: "No Proxy", primary: "NO_PROXY", fallback: "no_proxy" },
  ];

  return keys.map((item) => {
    const res = readEnv(env, item.primary, item.fallback);
    if (!res.value) {
      return {
        label: item.label,
        envVar: item.fallback ? `${item.primary} / ${item.fallback}` : item.primary,
        present: false,
        maskedValue: "(not set)",
      };
    }
    const masked = item.secret
      ? res.value.length > 6
        ? `${res.value.slice(0, 4)}...${res.value.slice(-2)}`
        : "****"
      : res.value;
    return {
      label: item.label,
      envVar: res.source!,
      present: true,
      maskedValue: masked,
    };
  });
}
