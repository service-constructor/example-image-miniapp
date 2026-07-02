// Calls to the service backend (via the /service proxy): get a signed quote and
// list the user's purchased images.
import type { Quote } from "./bridge/WalletBridge";

const SERVICE_BASE = "/service";

// decryptUser sends the shell's encrypted user id to our backend, which decrypts
// it with the service private key and returns the trusted user id. This is the
// identity the mini-app relies on (the plaintext ctx.userId is only a hint).
export async function decryptUser(encUserId: string): Promise<string> {
  const res = await fetch(`${SERVICE_BASE}/decrypt-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encUserId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `decrypt failed: ${res.status}`);
  return (data as { userId: string }).userId;
}

export interface Product {
  id: string;
  title: string;
}

// The service exposes its catalog via /healthz (product ids). We pair them with
// friendly titles known to the mini-app.
const TITLES: Record<string, string> = {
  cat: "A random cat",
  "cat-says": "A cat with a caption",
  photo: "A random stock photo",
};

export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch(`${SERVICE_BASE}/healthz`);
  const data = await res.json();
  return (data.products as string[]).map((id) => ({ id, title: TITLES[id] ?? id }));
}

export interface Scenario {
  id: string;
  title: string;
}

// The service publishes the saga demo scenarios it supports.
export async function fetchScenarios(): Promise<{ scenarios: Scenario[]; default: string }> {
  const res = await fetch(`${SERVICE_BASE}/scenarios`);
  if (!res.ok) throw new Error(`scenarios failed: ${res.status}`);
  return res.json();
}

export async function createQuote(userId: string, productId: string, scenario: string): Promise<Quote> {
  const res = await fetch(`${SERVICE_BASE}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, productId, scenario }),
  });
  if (!res.ok) throw new Error(`quote failed: ${res.status}`);
  const data = await res.json();
  return data.quote as Quote;
}

// Poll the SERVICE's own delivery status for an order. This is the provider-side
// view (DONE / PENDING / NOT_DONE / UNKNOWN) — no auth needed, unlike the
// platform order state — and is enough to watch async/reconcile transitions.
export interface DeliveryStatus {
  status: string; // DONE | PENDING | NOT_DONE | UNKNOWN
  externalRef?: string;
  imageUrl?: string;
}

export async function fetchOrderStatus(orderId: string): Promise<DeliveryStatus | null> {
  const res = await fetch(`${SERVICE_BASE}/status/${encodeURIComponent(orderId)}`);
  if (!res.ok) return null;
  return res.json();
}

export interface PurchasedImage {
  orderId: string;
  productId?: string;
  imageUrl?: string;
  createdAt: number;
}

export async function fetchGallery(userId: string): Promise<PurchasedImage[]> {
  const res = await fetch(`${SERVICE_BASE}/orders?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`gallery failed: ${res.status}`);
  const data = await res.json();
  return (data.orders as PurchasedImage[]) ?? [];
}
