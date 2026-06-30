// WalletBridge — the Client SDK a service web app uses to talk to the wallet
// shell (white paper §13.1). It mirrors the real SDK surface:
//
//   const bridge = await WalletBridge.init();
//   const ctx = await bridge.getContext();   // { userId, wallets, ... }
//   const result = await bridge.pay(quote);   // { orderId, status }
//
// In the real product the bridge speaks postMessage to the native shell hosting
// the WebView. In this demo it talks to the mock shell backend over the /shell
// proxy, so the device key and consent signing stay in the trusted shell.

export interface Wallet {
  walletId: string;
  currencyId: number;
  label: string;
}

export interface WalletContext {
  userId: string;
  wallets: Wallet[];
}

// Quote is the signed payment instruction the service issues; opaque to the
// mini-app, passed straight through to pay().
export type Quote = Record<string, unknown>;

export interface PayResult {
  orderId: string;
  // The platform order state, e.g. "ORDER_STATE_COMPLETED" / "ORDER_STATE_PENDING".
  state: string;
  externalRef?: string;
  amount?: string;
  fee?: string;
  net?: string;
}

// ConsentPreview is what the wallet shows the user before they approve. It comes
// from the shell, not the mini-app, so the service cannot alter what is shown.
export interface ConsentPreview {
  amount: string;
  currencyId: number;
  currency: string;
  description: string;
  serviceId: string;
  wallets: Wallet[];
  exp: number;
}

// ConsentDecision is the user's answer on the trusted consent screen.
export type ConsentDecision = { approved: true; walletId: string } | { approved: false };

// ConsentRenderer draws the trusted consent screen and resolves with the user's
// decision. The mini-app provides this so the screen can render in-app, but it
// is driven by the shell's preview data and is conceptually the wallet's UI.
export type ConsentRenderer = (preview: ConsentPreview) => Promise<ConsentDecision>;

const SHELL_BASE = "/shell";

export class WalletBridge {
  private constructor(
    private ctx: WalletContext,
    private renderConsent: ConsentRenderer,
  ) {}

  // init performs the handshake and registers the consent renderer.
  static async init(renderConsent: ConsentRenderer): Promise<WalletBridge> {
    const res = await fetch(`${SHELL_BASE}/context`);
    if (!res.ok) throw new Error(`bridge handshake failed: ${res.status}`);
    const ctx = (await res.json()) as WalletContext;
    return new WalletBridge(ctx, renderConsent);
  }

  getContext(): WalletContext {
    return this.ctx;
  }

  // pay runs the full consent flow: it asks the shell for a preview, shows the
  // trusted consent screen, and — only if the user approves — has the shell sign
  // the device consent and call the platform. Returns null if the user cancels.
  async pay(quote: Quote): Promise<PayResult | null> {
    // 1. Preview from the shell (amount, currency, eligible wallets).
    const prep = await fetch(`${SHELL_BASE}/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote }),
    });
    const preview = await prep.json();
    if (!prep.ok) {
      throw new Error(preview?.message ?? preview?.error ?? `prepare failed: ${prep.status}`);
    }

    // 2. Trusted consent screen — the user confirms or cancels.
    const decision = await this.renderConsent(preview as ConsentPreview);
    if (!decision.approved) return null;

    // 3. Confirm: the shell signs the device consent and pays.
    const res = await fetch(`${SHELL_BASE}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote, selectedWalletId: decision.walletId }),
    });
    const order = await res.json();
    if (!res.ok) {
      throw new Error(order?.message ?? order?.error ?? `pay failed: ${res.status}`);
    }
    if (!order || typeof order.state !== "string") {
      throw new Error(order?.message ?? "payment failed: malformed response");
    }
    return order as PayResult;
  }
}
