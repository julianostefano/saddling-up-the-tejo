import { createSign, generateKeyPairSync } from "node:crypto";
import { computeS3MultipartEtag } from "../../src/format.ts";

export interface StoredS3Object {
  bucket: string;
  key: string;
  data: Uint8Array;
  etag: string;
  contentType: string;
  lastModified: Date;
}

export interface MockS3Stats {
  requests: string[];
  singlePartPuts: number;
  multipartInitiations: number;
  multipartPartsUploaded: number;
  multipartCompletions: number;
  headRequests: number;
  getRequests: number;
  listRequests: number;
}

interface ActiveMultipart {
  bucket: string;
  key: string;
  contentType: string;
  parts: Map<number, { data: Uint8Array; md5Raw: Uint8Array; etag: string }>;
}

/**
 * Generates a self-signed X.509 v3 certificate in PEM format using Node/Bun crypto (no external `openssl` binary).
 */
export function generateSelfSignedCert(): { keyPem: string; certPem: string } {
  const lenBytes = (n: number): number[] => {
    if (n < 128) return [n];
    const bytes: number[] = [];
    let v = n;
    while (v > 0) {
      bytes.unshift(v & 0xff);
      v >>= 8;
    }
    return [0x80 | bytes.length, ...bytes];
  };
  const tlv = (tag: number, content: Uint8Array): Uint8Array => {
    const lb = lenBytes(content.length);
    const out = new Uint8Array(1 + lb.length + content.length);
    out[0] = tag;
    out.set(lb, 1);
    out.set(content, 1 + lb.length);
    return out;
  };
  const cat = (...parts: Uint8Array[]): Uint8Array => {
    const total = parts.reduce((acc, p) => acc + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  };
  const seq = (...parts: Uint8Array[]) => tlv(0x30, cat(...parts));
  const set = (...parts: Uint8Array[]) => tlv(0x31, cat(...parts));
  const oid = (bytes: number[]) => tlv(0x06, new Uint8Array(bytes));
  const utf8 = (s: string) => tlv(0x0c, new TextEncoder().encode(s));
  const utc = (s: string) => tlv(0x17, new TextEncoder().encode(s));
  const int = (b: number[]) => tlv(0x02, new Uint8Array(b));
  const bitstr = (b: Uint8Array) => tlv(0x03, cat(new Uint8Array([0]), b));

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const spki = new Uint8Array(publicKey.export({ type: "spki", format: "der" }));
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const sha256RsaOid = seq(
    oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]),
    tlv(0x05, new Uint8Array(0)),
  );
  const cn = seq(set(seq(oid([0x55, 0x04, 0x03]), utf8("localhost"))));
  const validity = seq(utc("250101000000Z"), utc("350101000000Z"));
  const sanExt = seq(
    oid([0x55, 0x1d, 0x11]),
    tlv(
      0x04,
      seq(
        tlv(0x82, new TextEncoder().encode("localhost")),
        tlv(0x87, new Uint8Array([127, 0, 0, 1])),
      ),
    ),
  );
  const tbs = seq(
    tlv(0xa0, int([2])),
    int([1]),
    sha256RsaOid,
    cn,
    validity,
    cn,
    spki,
    tlv(0xa3, seq(sanExt)),
  );
  const sig = createSign("RSA-SHA256").update(tbs).sign(privateKey);
  const certDer = seq(tbs, sha256RsaOid, bitstr(new Uint8Array(sig)));
  const b64 = Buffer.from(certDer).toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  const certPem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;

  return { keyPem, certPem };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Starts an in-process S3-compatible mock server (HTTP or self-signed HTTPS) using `Bun.serve`.
 */
export function startMockS3Server(
  options: { tls?: { key: string; cert: string }; simulateSseKms?: boolean } = {},
) {
  const objects = new Map<string, StoredS3Object>();
  const uploads = new Map<string, ActiveMultipart>();
  let uploadSeq = 1;

  const stats: MockS3Stats = {
    requests: [],
    singlePartPuts: 0,
    multipartInitiations: 0,
    multipartPartsUploaded: 0,
    multipartCompletions: 0,
    headRequests: 0,
    getRequests: 0,
    listRequests: 0,
  };

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: options.tls,
    async fetch(req) {
      const url = new URL(req.url);
      stats.requests.push(`${req.method} ${url.pathname}${url.search}`);

      // Parse path-style: /<bucket>/<key...>
      const trimmed = url.pathname.replace(/^\/+/, "");
      const slash = trimmed.indexOf("/");
      const bucket = slash === -1 ? trimmed : trimmed.slice(0, slash);
      const key = slash === -1 ? "" : decodeURIComponent(trimmed.slice(slash + 1));
      const objectMapKey = `${bucket}/${key}`;

      if (req.method === "POST" && url.searchParams.has("uploads")) {
        stats.multipartInitiations++;
        const uploadId = `mock-upload-${uploadSeq++}`;
        uploads.set(uploadId, {
          bucket,
          key,
          contentType: req.headers.get("content-type") || "application/octet-stream",
          parts: new Map(),
        });
        const xml =
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`;
        return new Response(xml, { status: 200, headers: { "content-type": "application/xml" } });
      }

      if (req.method === "PUT" && url.searchParams.has("partNumber") && url.searchParams.has("uploadId")) {
        const partNumber = Number(url.searchParams.get("partNumber"));
        const uploadId = url.searchParams.get("uploadId")!;
        const active = uploads.get(uploadId);
        if (!active) {
          return new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404 });
        }
        const buf = new Uint8Array(await req.arrayBuffer());
        const hasher = new Bun.CryptoHasher("md5");
        hasher.update(buf);
        const md5Raw = hasher.digest();
        const etag = Buffer.from(md5Raw).toString("hex");
        active.parts.set(partNumber, { data: buf, md5Raw, etag });
        stats.multipartPartsUploaded++;
        return new Response(null, { status: 200, headers: { etag: `"${etag}"` } });
      }

      if (req.method === "POST" && url.searchParams.has("uploadId")) {
        const uploadId = url.searchParams.get("uploadId")!;
        const active = uploads.get(uploadId);
        if (!active) {
          return new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404 });
        }
        await req.text();
        stats.multipartCompletions++;

        const orderedNumbers = Array.from(active.parts.keys()).sort((a, b) => a - b);
        const totalSize = orderedNumbers.reduce((acc, n) => acc + active.parts.get(n)!.data.byteLength, 0);
        const combined = new Uint8Array(totalSize);
        const md5Parts: Uint8Array[] = [];
        let offset = 0;
        for (const n of orderedNumbers) {
          const part = active.parts.get(n)!;
          combined.set(part.data, offset);
          offset += part.data.byteLength;
          md5Parts.push(part.md5Raw);
        }
        const finalEtag = options.simulateSseKms
          ? `${"a".repeat(32)}-${orderedNumbers.length}`
          : computeS3MultipartEtag(md5Parts);
        objects.set(objectMapKey, {
          bucket: active.bucket,
          key: active.key,
          data: combined,
          etag: finalEtag,
          contentType: active.contentType,
          lastModified: new Date(),
        });
        uploads.delete(uploadId);

        const xml =
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<CompleteMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><ETag>"${finalEtag}"</ETag></CompleteMultipartUploadResult>`;
        return new Response(xml, { status: 200, headers: { "content-type": "application/xml" } });
      }

      if (req.method === "PUT") {
        stats.singlePartPuts++;
        const buf = new Uint8Array(await req.arrayBuffer());
        const hasher = new Bun.CryptoHasher("md5");
        hasher.update(buf);
        const etag = hasher.digest("hex");
        objects.set(objectMapKey, {
          bucket,
          key,
          data: buf,
          etag,
          contentType: req.headers.get("content-type") || "application/octet-stream",
          lastModified: new Date(),
        });
        return new Response(null, { status: 200, headers: { etag: `"${etag}"` } });
      }

      if (req.method === "HEAD") {
        stats.headRequests++;
        const obj = objects.get(objectMapKey);
        if (!obj) {
          return new Response(null, { status: 404 });
        }
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": String(obj.data.byteLength),
            etag: `"${obj.etag}"`,
            "content-type": obj.contentType,
            "last-modified": obj.lastModified.toUTCString(),
          },
        });
      }

      if (req.method === "GET") {
        if (key === "") {
          stats.listRequests++;
          const prefix = url.searchParams.get("prefix") ?? "";
          const continuationToken = url.searchParams.get("continuation-token") ?? "";
          const startAfter = url.searchParams.get("start-after") ?? "";
          const maxKeysRaw = Number(url.searchParams.get("max-keys") ?? "1000");
          const maxKeys = Number.isFinite(maxKeysRaw) && maxKeysRaw > 0 ? Math.floor(maxKeysRaw) : 1000;
          const cursor = continuationToken || startAfter;

          const matched = Array.from(objects.values())
            .filter((o) => o.bucket === bucket && o.key.startsWith(prefix))
            .sort((a, b) => a.key.localeCompare(b.key))
            .filter((o) => !cursor || o.key > cursor);

          const slice = matched.slice(0, maxKeys);
          const isTruncated = matched.length > maxKeys;
          const nextToken = isTruncated && slice.length > 0 ? slice[slice.length - 1]!.key : "";

          const contentsXml = slice
            .map(
              (o) =>
                `<Contents>` +
                `<Key>${escapeXml(o.key)}</Key>` +
                `<LastModified>${o.lastModified.toISOString()}</LastModified>` +
                `<ETag>"${escapeXml(o.etag)}"</ETag>` +
                `<Size>${o.data.byteLength}</Size>` +
                `<StorageClass>STANDARD</StorageClass>` +
                `</Contents>`,
            )
            .join("");

          const xml =
            `<?xml version="1.0" encoding="UTF-8"?>` +
            `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
            `<Name>${escapeXml(bucket)}</Name>` +
            `<Prefix>${escapeXml(prefix)}</Prefix>` +
            `<KeyCount>${slice.length}</KeyCount>` +
            `<MaxKeys>${maxKeys}</MaxKeys>` +
            `<IsTruncated>${isTruncated ? "true" : "false"}</IsTruncated>` +
            (nextToken ? `<NextContinuationToken>${escapeXml(nextToken)}</NextContinuationToken>` : "") +
            contentsXml +
            `</ListBucketResult>`;

          return new Response(xml, {
            status: 200,
            headers: { "content-type": "application/xml" },
          });
        }

        stats.getRequests++;
        const obj = objects.get(objectMapKey);
        if (!obj) {
          return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
        }
        const range = req.headers.get("range");
        if (range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(range);
          if (match) {
            const start = Number(match[1]);
            const end = match[2] ? Math.min(obj.data.byteLength - 1, Number(match[2])) : obj.data.byteLength - 1;
            const slice = obj.data.subarray(start, end + 1);
            return new Response(slice, {
              status: 206,
              headers: {
                "content-length": String(slice.byteLength),
                "content-range": `bytes ${start}-${end}/${obj.data.byteLength}`,
                etag: `"${obj.etag}"`,
                "content-type": obj.contentType,
              },
            });
          }
        }
        return new Response(obj.data, {
          status: 200,
          headers: {
            "content-length": String(obj.data.byteLength),
            etag: `"${obj.etag}"`,
            "content-type": obj.contentType,
          },
        });
      }

      if (req.method === "DELETE") {
        objects.delete(objectMapKey);
        return new Response(null, { status: 204 });
      }

      return new Response("Method Not Allowed", { status: 405 });
    },
  });

  return {
    server,
    origin: server.url.origin,
    objects,
    stats,
    stop: () => server.stop(true),
  };
}

/**
 * Starts a local HTTP forward proxy server using `Bun.serve` for testing `HTTP_PROXY` routing.
 */
export function startMockHttpProxy() {
  const proxiedUrls: string[] = [];

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      proxiedUrls.push(`${req.method} ${req.url}`);
      const headers = new Headers(req.headers);
      headers.delete("proxy-connection");
      headers.delete("proxy-authorization");

      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const body = hasBody ? await req.arrayBuffer() : undefined;

      const upstream = await fetch(req.url, {
        method: req.method,
        headers,
        body,
        proxy: false,
      });

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
      });
    },
  });

  return {
    server,
    proxyUrl: server.url.origin,
    proxiedUrls,
    stop: () => server.stop(true),
  };
}
