/**
 * JWS (detached-payload style compact) signatures for A2A Agent Cards.
 * ES256 keypair is durable under data/prod/agent-card-signing.json via durable-json.
 * Card is canonicalized with sorted keys (lightweight RFC 8785 subset).
 */
import { createSign, generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import { loadDurableJson, saveDurableJson } from "./durable-json";

const KEY_BLOB = "agent-card-signing.json";

type KeyBlob = {
  alg: "ES256";
  privateKeyPem: string;
  publicKeyPem: string;
  kid: string;
  created_at: string;
};

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Stable JSON stringify (sorted object keys, arrays preserved). */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(",")}}`;
}

async function loadOrCreateKeys(): Promise<KeyBlob> {
  const existing = await loadDurableJson<KeyBlob | null>(
    KEY_BLOB,
    () => null,
  );
  if (
    existing?.privateKeyPem &&
    existing?.publicKeyPem &&
    existing.alg === "ES256"
  ) {
    return existing;
  }
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const blob: KeyBlob = {
    alg: "ES256",
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    kid: `dualregistry-es256-${Date.now().toString(36)}`,
    created_at: new Date().toISOString(),
  };
  try {
    await saveDurableJson(KEY_BLOB, blob);
  } catch {
    /* local-only if durable push fails */
  }
  return blob;
}

export async function getAgentCardJwks(origin: string) {
  const keys = await loadOrCreateKeys();
  const pub = createPublicKey(keys.publicKeyPem);
  const jwk = pub.export({ format: "jwk" }) as Record<string, string>;
  return {
    keys: [
      {
        kty: jwk.kty,
        crv: jwk.crv,
        x: jwk.x,
        y: jwk.y,
        kid: keys.kid,
        alg: "ES256",
        use: "sig",
      },
    ],
    issuer: origin.replace(/\/$/, ""),
    jwks_uri: `${origin.replace(/\/$/, "")}/.well-known/jwks.json`,
  };
}

/**
 * Attach signatures[] to an agent card (mutates a copy).
 * Signature covers the card without the signatures field (A2A pattern).
 */
export async function signAgentCard<T extends Record<string, unknown>>(
  card: T,
  origin: string,
): Promise<T & { signatures: Array<Record<string, string>> }> {
  const keys = await loadOrCreateKeys();
  const { signatures: _drop, ...unsigned } = card as T & {
    signatures?: unknown;
  };
  const payload = canonicalize(unsigned);
  const header = {
    alg: "ES256",
    kid: keys.kid,
    typ: "JWT",
  };
  const h = b64url(JSON.stringify(header));
  const p = b64url(payload);
  const data = `${h}.${p}`;
  const signer = createSign("SHA256");
  signer.update(data);
  signer.end();
  const priv = createPrivateKey(keys.privateKeyPem);
  // JOSE ES256 wants IEEE-P1363 (r||s) not DER
  const der = signer.sign(priv);
  const raw = derToJose(der, 32);
  const sig = b64url(raw);
  const jws = `${data}.${sig}`;
  return {
    ...(unsigned as T),
    signatures: [
      {
        protected: h,
        signature: sig,
        jws,
        kid: keys.kid,
        alg: "ES256",
        jwks: `${origin.replace(/\/$/, "")}/.well-known/jwks.json`,
      },
    ],
  };
}

/** Convert ECDSA DER signature to raw r||s (fixed size). */
function derToJose(der: Buffer, size: number): Buffer {
  // SEQUENCE { INTEGER r, INTEGER s }
  let offset = 2;
  if (der[1] & 0x80) offset += der[1] & 0x7f;
  if (der[offset] !== 0x02) {
    // fallback: return der (verifiers may accept)
    return der;
  }
  const rLen = der[offset + 1];
  let r = der.subarray(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;
  const sLen = der[offset + 1];
  let s = der.subarray(offset + 2, offset + 2 + sLen);
  // strip leading zeros / pad
  while (r.length > size && r[0] === 0) r = r.subarray(1);
  while (s.length > size && s[0] === 0) s = s.subarray(1);
  const out = Buffer.alloc(size * 2);
  r.copy(out, size - r.length);
  s.copy(out, size * 2 - s.length);
  return out;
}

export async function verifyAgentCardSignature(
  card: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const sigs = card.signatures as Array<{ jws?: string; signature?: string; protected?: string }> | undefined;
    if (!sigs?.length) return { ok: false, reason: "no signatures" };
    const keys = await loadOrCreateKeys();
    const { signatures: _s, ...unsigned } = card;
    const payload = canonicalize(unsigned);
    const jws = sigs[0].jws || `${sigs[0].protected}.${b64url(payload)}.${sigs[0].signature}`;
    const parts = jws.split(".");
    if (parts.length !== 3) return { ok: false, reason: "bad jws" };
    const data = `${parts[0]}.${parts[1]}`;
    const sigRaw = Buffer.from(
      parts[2].replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (parts[2].length % 4)) % 4),
      "base64",
    );
    const { createVerify } = await import("node:crypto");
    // Convert JOSE raw back to DER for node verify
    const der = joseToDer(sigRaw, 32);
    const v = createVerify("SHA256");
    v.update(data);
    v.end();
    const ok = v.verify(createPublicKey(keys.publicKeyPem), der);
    return ok ? { ok: true } : { ok: false, reason: "verify failed" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function joseToDer(raw: Buffer, size: number): Buffer {
  let r = raw.subarray(0, size);
  let s = raw.subarray(size);
  // ensure positive INTEGER
  if (r[0] & 0x80) r = Buffer.concat([Buffer.from([0]), r]);
  if (s[0] & 0x80) s = Buffer.concat([Buffer.from([0]), s]);
  const len = 2 + r.length + 2 + s.length;
  return Buffer.concat([
    Buffer.from([0x30, len, 0x02, r.length]),
    r,
    Buffer.from([0x02, s.length]),
    s,
  ]);
}
