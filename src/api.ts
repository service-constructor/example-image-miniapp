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

export async function createQuote(userId: string, productId: string): Promise<Quote> {
  const res = await fetch(`${SERVICE_BASE}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, productId }),
  });
  if (!res.ok) throw new Error(`quote failed: ${res.status}`);
  const data = await res.json();
  return data.quote as Quote;
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
