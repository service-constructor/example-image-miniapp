import { useCallback, useEffect, useRef, useState } from "react";
import {
  WalletBridge,
  type ConsentDecision,
  type ConsentPreview,
  type WalletContext,
} from "./bridge/WalletBridge";
import { ConsentModal } from "./ConsentModal";
import { createQuote, fetchGallery, fetchProducts, type Product, type PurchasedImage } from "./api";

type Status =
  | { kind: "idle" }
  | { kind: "buying"; productId: string }
  | { kind: "error"; message: string }
  | { kind: "cancelled" }
  | { kind: "bought"; orderId: string };

export function App() {
  const [bridge, setBridge] = useState<WalletBridge | null>(null);
  const [ctx, setCtx] = useState<WalletContext | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [gallery, setGallery] = useState<PurchasedImage[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [booting, setBooting] = useState(true);

  // Pending consent screen: the preview to show and the resolver the modal
  // calls with the user's decision.
  const [consent, setConsent] = useState<ConsentPreview | null>(null);
  const consentResolve = useRef<((d: ConsentDecision) => void) | null>(null);

  // renderConsent is handed to the bridge; it pops the trusted consent screen
  // and resolves once the user confirms or cancels.
  const renderConsent = useCallback((preview: ConsentPreview): Promise<ConsentDecision> => {
    return new Promise<ConsentDecision>((resolve) => {
      consentResolve.current = resolve;
      setConsent(preview);
    });
  }, []);

  const onConsentDecision = (d: ConsentDecision) => {
    setConsent(null);
    consentResolve.current?.(d);
    consentResolve.current = null;
  };

  const refreshGallery = useCallback(async (userId: string) => {
    try {
      setGallery(await fetchGallery(userId));
    } catch {
      /* gallery is best-effort */
    }
  }, []);

  // Handshake with the wallet + load the catalog on mount.
  useEffect(() => {
    (async () => {
      try {
        const b = await WalletBridge.init(renderConsent);
        const context = b.getContext();
        setBridge(b);
        setCtx(context);
        setProducts(await fetchProducts());
        await refreshGallery(context.userId);
      } catch (err) {
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBooting(false);
      }
    })();
  }, [refreshGallery, renderConsent]);

  const buy = async (product: Product) => {
    if (!bridge || !ctx) return;
    setStatus({ kind: "buying", productId: product.id });
    try {
      // 1. Ask our service backend for a signed quote.
      const quote = await createQuote(ctx.userId, product.id);
      // 2. Hand it to the wallet: it shows the consent screen and, if approved,
      //    signs the device consent and pays. Returns null on cancel.
      const result = await bridge.pay(quote);
      if (result === null) {
        setStatus({ kind: "cancelled" });
        return;
      }
      if (result.state !== "ORDER_STATE_COMPLETED" && result.state !== "ORDER_STATE_PENDING") {
        throw new Error(`payment ${result.state ?? "failed"}`);
      }
      setStatus({ kind: "bought", orderId: result.orderId });
      // 3. Refresh the gallery (PENDING images appear once the callback lands).
      await refreshGallery(ctx.userId);
      setTimeout(() => refreshGallery(ctx.userId), 2000);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (booting) return <div className="center muted">Connecting to wallet…</div>;

  return (
    <div className="app">
      <header className="appbar">
        <span className="brand">🖼️ Image Shop</span>
        {ctx && <span className="muted">user: {ctx.userId}</span>}
      </header>

      <main className="content">
        {status.kind === "error" && <div className="error">{status.message}</div>}
        {status.kind === "cancelled" && <div className="muted">Payment cancelled.</div>}
        {status.kind === "bought" && (
          <div className="ok">Purchased! order {status.orderId.slice(0, 14)}…</div>
        )}

        <section>
          <h2>Buy an image</h2>
          <div className="catalog">
            {products.map((p) => (
              <div key={p.id} className="card product">
                <div className="thumb">{emojiFor(p.id)}</div>
                <div className="strong">{p.title}</div>
                <div className="mono muted">{p.id}</div>
                <button
                  disabled={status.kind === "buying"}
                  onClick={() => buy(p)}
                >
                  {status.kind === "buying" && status.productId === p.id ? "Paying…" : "Buy"}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="toolbar">
            <h2>Your images ({gallery.length})</h2>
            {ctx && (
              <button className="ghost" onClick={() => refreshGallery(ctx.userId)}>
                Refresh
              </button>
            )}
          </div>
          {gallery.length === 0 ? (
            <p className="muted">No images yet. Buy one above.</p>
          ) : (
            <div className="gallery">
              {gallery.map((g) => (
                <a key={g.orderId} className="card shot" href={g.imageUrl} target="_blank" rel="noreferrer">
                  {g.imageUrl && <img src={g.imageUrl} alt={g.productId ?? "image"} loading="lazy" />}
                  <div className="mono muted">{g.productId}</div>
                </a>
              ))}
            </div>
          )}
        </section>
      </main>

      {consent && <ConsentModal preview={consent} onDecision={onConsentDecision} />}
    </div>
  );
}

function emojiFor(productId: string): string {
  if (productId.startsWith("cat")) return "🐈";
  if (productId === "photo") return "📷";
  return "🖼️";
}
