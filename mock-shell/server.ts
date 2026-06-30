// Mock Wallet Shell — stands in for the wallet that hosts the mini-app's WebView.
//
// In production this logic lives in the trusted wallet app: it holds the device
// key, renders the consent screen, and calls the platform pay endpoint with a
// user session. Here it is a tiny backend so the device private key stays out of
// the browser (as it must) and the consent signing matches the platform exactly.
//
// Endpoints (the mini-app calls these via the /shell proxy):
//   GET  /context            -> session + wallets + accepted currencies
//   POST /pay { quote }      -> render-less consent: sign device consent, call
//                               the platform /v1/services/pay, return the order
import { createServer } from "node:http";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  createHmac,
  createHash,
  KeyObject,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { encodeStruct } from "./canonical.js";

const PORT = Number(process.env.SHELL_PORT ?? 4100);
const PLATFORM = process.env.PLATFORM_BASE_URL ?? "http://localhost:8080";
const JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "devsecret";
const USER_ID = process.env.USER_ID ?? "u_42";
const DEVICE_KID = process.env.DEVICE_KID ?? "demo-device-1";
const DEVICE_KEY_PATH = process.env.DEVICE_KEY_PATH ?? "mock-shell/keys/device.private.pem";

// The demo wallet of the user (one per accepted currency).
const WALLETS = [{ walletId: "wlt_user_usdt", currencyId: 1, label: "USDT wallet" }];

function loadDeviceKey(): KeyObject {
  if (!existsSync(DEVICE_KEY_PATH)) {
    const { privateKey } = generateKeyPairSync("ed25519");
    mkdirSync(dirname(DEVICE_KEY_PATH), { recursive: true });
    writeFileSync(DEVICE_KEY_PATH, privateKey.export({ type: "pkcs8", format: "pem" }) as string, {
      mode: 0o600,
    });
  }
  return createPrivateKey(readFileSync(DEVICE_KEY_PATH, "utf8"));
}
const deviceKey = loadDeviceKey();

function b64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// mintSessionToken signs the user session the platform authenticates /pay with.
function mintSessionToken(): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify({ sub: USER_ID, roles: ["user"] })));
  const sig = b64url(createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

// quoteCanonical mirrors the platform's saga.Quote field order.
function quoteCanonical(q: Record<string, unknown>): Buffer {
  return Buffer.from(
    encodeStruct([
      { key: "version", value: q.version as number },
      { key: "serviceId", value: q.serviceId as string },
      { key: "userId", value: q.userId as string },
      { key: "amount", value: q.amount as string },
      { key: "currencyId", value: q.currencyId as number },
      { key: "acceptedCurrencyIds", value: q.acceptedCurrencyIds as number[] },
      { key: "description", value: q.description as string },
      { key: "metadata", value: (q.metadata as Record<string, string>) ?? null, omitempty: true },
      { key: "nonce", value: q.nonce as string },
      { key: "exp", value: q.exp as number },
      { key: "kid", value: q.kid as string },
      { key: "sig", value: "" },
    ]),
    "utf8",
  );
}

function consentCanonical(c: {
  quoteHash: string;
  walletId: string;
  nonce: string;
  ts: number;
  deviceKid: string;
}): Buffer {
  return Buffer.from(
    encodeStruct([
      { key: "quoteHash", value: c.quoteHash },
      { key: "walletId", value: c.walletId },
      { key: "nonce", value: c.nonce },
      { key: "ts", value: c.ts },
      { key: "deviceKid", value: c.deviceKid },
      { key: "sig", value: "" },
    ]),
    "utf8",
  );
}

// pickWallet selects the user's wallet whose currency the quote requires.
function pickWallet(currencyId: number) {
  return WALLETS.find((w) => w.currencyId === currencyId);
}

// currencyName is a human label for a currency id (demo mapping).
function currencyName(currencyId: number): string {
  return { 1: "USDT", 2: "EUR" }[currencyId] ?? `#${currencyId}`;
}

async function readJson(req: import("node:http").IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function send(res: import("node:http").ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(data);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/context") {
      // Hand the mini-app its user context (no secrets).
      return send(res, 200, {
        userId: USER_ID,
        wallets: WALLETS,
        devicePublicKeyPEM: createPublicKey(deviceKey).export({ type: "spki", format: "pem" }),
      });
    }

    if (req.method === "POST" && url.pathname === "/prepare") {
      // Consent preview: what the shell will show the user before they approve.
      // Cross-currency rule (white paper 7.2): only wallets whose currency the
      // service accepts are eligible; the quote currency is the one to pay in.
      const body = await readJson(req);
      const quote = body?.quote;
      if (!quote) return send(res, 400, { error: "quote is required" });
      const accepted: number[] = (quote.acceptedCurrencyIds as number[]) ?? [Number(quote.currencyId)];
      const eligible = WALLETS.filter(
        (w) => w.currencyId === Number(quote.currencyId) && accepted.includes(w.currencyId),
      );
      return send(res, 200, {
        amount: quote.amount,
        currencyId: quote.currencyId,
        currency: currencyName(Number(quote.currencyId)),
        description: quote.description,
        serviceId: quote.serviceId,
        wallets: eligible,
        // exp lets the UI warn about an expiring quote.
        exp: quote.exp,
      });
    }

    if (req.method === "POST" && url.pathname === "/pay") {
      const body = await readJson(req);
      const quote = body?.quote;
      if (!quote) return send(res, 400, { error: "quote is required" });

      // The wallet the user picked on the consent screen (falls back to the
      // single eligible wallet).
      const selectedId = body?.selectedWalletId as string | undefined;
      const wallet = selectedId
        ? WALLETS.find((w) => w.walletId === selectedId)
        : pickWallet(Number(quote.currencyId));
      if (!wallet) return send(res, 400, { error: "no wallet for quote currency" });

      // Build the device-signed consent over hash(quote)+wallet+nonce.
      const quoteHash = createHash("sha256").update(quoteCanonical(quote)).digest("hex");
      const consent: any = {
        quoteHash,
        walletId: wallet.walletId,
        nonce: "consent-" + Date.now(),
        ts: Math.floor(Date.now() / 1000),
        deviceKid: DEVICE_KID,
        sig: "",
      };
      consent.sig = edSign(null, consentCanonical(consent), deviceKey).toString("base64");

      const payReq = {
        quote,
        consent,
        selectedWalletId: wallet.walletId,
        selectedWalletCurrencyId: String(wallet.currencyId),
      };

      const r = await fetch(`${PLATFORM}/v1/services/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mintSessionToken()}`,
        },
        body: JSON.stringify(payReq),
      });
      const order = await r.json().catch(() => ({}));
      return send(res, r.status, order);
    }

    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`mock wallet shell on :${PORT}`);
  console.log(`  user:     ${USER_ID}`);
  console.log(`  platform: ${PLATFORM}`);
  console.log(`  device public key (set as platform DEVICE_KEY_PEM):`);
  console.log(createPublicKey(deviceKey).export({ type: "spki", format: "pem" }));
});
