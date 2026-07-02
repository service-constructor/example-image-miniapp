import { useCallback, useEffect, useRef, useState } from "react";
import { WalletBridge } from "./bridge/WalletBridge";
import {
  createQuote,
  decryptUser,
  fetchGallery,
  fetchOrderStatus,
  fetchProducts,
  fetchScenarios,
  type Product,
  type PurchasedImage,
  type Scenario,
} from "./api";

type Status =
  | { kind: "idle" }
  | { kind: "buying"; productId: string }
  | { kind: "error"; message: string }
  | { kind: "cancelled" }
  | { kind: "bought"; orderId: string; state: string };

// A live-tracked order: we poll the service /status until it resolves, so the
// user can watch the async webhook / reconciler recovery play out.
interface TrackedOrder {
  orderId: string;
  productId: string;
  scenario: string;
  status: string; // DONE | PENDING | NOT_DONE | UNKNOWN
}

export function App() {
  const [bridge, setBridge] = useState<WalletBridge | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenario, setScenario] = useState<string>("sync-success");
  const [gallery, setGallery] = useState<PurchasedImage[]>([]);
  const [tracked, setTracked] = useState<TrackedOrder[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [booting, setBooting] = useState(true);
  const pollRef = useRef<number | null>(null);

  const refreshGallery = useCallback(async (uid: string) => {
    try {
      setGallery(await fetchGallery(uid));
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const b = await WalletBridge.init();
        const context = b.getContext();
        setBridge(b);
        const trusted = await decryptUser(context.encUserId);
        setUserId(trusted);
        setProducts(await fetchProducts());
        try {
          const sc = await fetchScenarios();
          setScenarios(sc.scenarios);
          setScenario(sc.default);
        } catch {
          /* scenarios optional */
        }
        await refreshGallery(trusted);
      } catch (err) {
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBooting(false);
      }
    })();
  }, [refreshGallery]);

  // Poll the service status of any non-terminal tracked orders every 1.5s.
  useEffect(() => {
    const hasPending = tracked.some((t) => t.status === "PENDING");
    if (!hasPending) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    if (pollRef.current) return; // already polling
    pollRef.current = window.setInterval(async () => {
      const updated = await Promise.all(
        tracked.map(async (t) => {
          if (t.status !== "PENDING") return t;
          const s = await fetchOrderStatus(t.orderId);
          return s ? { ...t, status: s.status } : t;
        }),
      );
      setTracked(updated);
      if (userId) refreshGallery(userId);
    }, 1500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [tracked, userId, refreshGallery]);

  const buy = async (product: Product) => {
    if (!bridge || !userId) return;
    setStatus({ kind: "buying", productId: product.id });
    try {
      const quote = await createQuote(userId, product.id, scenario);
      const result = await bridge.pay(quote);
      if (result === null) {
        setStatus({ kind: "cancelled" });
        return;
      }
      const state = result.state ?? "unknown";
      setStatus({ kind: "bought", orderId: result.orderId, state });
      // Track the order so we can watch it resolve (async/reconcile scenarios).
      setTracked((prev) => [
        { orderId: result.orderId, productId: product.id, scenario, status: state === "ORDER_STATE_COMPLETED" ? "DONE" : "PENDING" },
        ...prev.filter((t) => t.orderId !== result.orderId),
      ].slice(0, 8));
      await refreshGallery(userId);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (booting) return <div className="center muted">Connecting to wallet…</div>;

  const activeScenarioTitle = scenarios.find((s) => s.id === scenario)?.title ?? scenario;

  return (
    <div className="app">
      <header className="appbar">
        <span className="brand">🖼️ Image Shop</span>
        {userId && <span className="muted">user: {userId}</span>}
      </header>

      <main className="content">
        {status.kind === "error" && <div className="error">{status.message}</div>}
        {status.kind === "cancelled" && <div className="muted">Payment cancelled.</div>}
        {status.kind === "bought" && (
          <div className="ok">
            Order {status.orderId.slice(0, 14)}… → {prettyState(status.state)}
          </div>
        )}

        {scenarios.length > 0 && (
          <section className="card scenario-box">
            <label className="strong" htmlFor="scenario">Saga scenario</label>
            <select id="scenario" value={scenario} onChange={(e) => setScenario(e.target.value)}>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
            <p className="muted small">{scenarioHint(scenario)}</p>
          </section>
        )}

        <section>
          <h2>Buy an image</h2>
          <p className="muted small">Scenario: <strong>{activeScenarioTitle}</strong></p>
          <div className="catalog">
            {products.map((p) => (
              <div key={p.id} className="card product">
                <div className="thumb">{emojiFor(p.id)}</div>
                <div className="strong">{p.title}</div>
                <div className="mono muted">{p.id}</div>
                <button disabled={status.kind === "buying"} onClick={() => buy(p)}>
                  {status.kind === "buying" && status.productId === p.id ? "Paying…" : "Buy"}
                </button>
              </div>
            ))}
          </div>
        </section>

        {tracked.length > 0 && (
          <section>
            <h2>Order tracker</h2>
            <div className="tracker">
              {tracked.map((t) => (
                <div key={t.orderId} className="card track-row">
                  <span className={`badge ${badgeClass(t.status)}`}>{t.status}</span>
                  <span className="mono muted">{t.orderId.slice(0, 16)}…</span>
                  <span className="small muted">{t.scenario}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="toolbar">
            <h2>Your images ({gallery.length})</h2>
            {userId && (
              <button className="ghost" onClick={() => refreshGallery(userId)}>Refresh</button>
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
    </div>
  );
}

function prettyState(state: string): string {
  return state.replace("ORDER_STATE_", "").toLowerCase();
}

function badgeClass(status: string): string {
  if (status === "DONE") return "ok";
  if (status === "NOT_DONE") return "bad";
  if (status === "UNKNOWN") return "warn";
  return "pending";
}

function scenarioHint(id: string): string {
  const hints: Record<string, string> = {
    "sync-success": "Service returns SUCCESS immediately → order COMPLETED.",
    "sync-fail": "Service returns FAILED → funds released (refund).",
    "async-success": "Service parks PENDING, then a signed webhook completes it.",
    "async-fail": "Service parks PENDING, then a webhook fails it → refund.",
    "retry-success": "First attempts 503; the platform retries then succeeds.",
    "retry-exhausted": "Every attempt 503; retries exhausted → refund.",
    "reconcile-done": "PENDING, no webhook; the reconciler queries status=DONE.",
    "reconcile-notdone": "PENDING, no webhook; reconciler queries NOT_DONE → refund.",
    "stuck-unknown": "PENDING, status UNKNOWN; reconciler leaves it for later.",
  };
  return hints[id] ?? "";
}

function emojiFor(productId: string): string {
  if (productId.startsWith("cat")) return "🐈";
  if (productId === "photo") return "📷";
  return "🖼️";
}
