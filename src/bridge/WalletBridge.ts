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
  status: string;
  externalRef?: string;
  amount?: string;
  fee?: string;
  net?: string;
}

const SHELL_BASE = "/shell";

export class WalletBridge {
  private constructor(private ctx: WalletContext) {}

  // init performs the handshake and caches the user context.
  static async init(): Promise<WalletBridge> {
    const res = await fetch(`${SHELL_BASE}/context`);
    if (!res.ok) throw new Error(`bridge handshake failed: ${res.status}`);
    const ctx = (await res.json()) as WalletContext;
    return new WalletBridge(ctx);
  }

  getContext(): WalletContext {
    return this.ctx;
  }

  // pay hands a signed quote to the shell, which renders consent (here: auto),
  // signs the device consent and calls the platform. Returns the resulting order.
  async pay(quote: Quote): Promise<PayResult> {
    const res = await fetch(`${SHELL_BASE}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote }),
    });
    const order = await res.json();
    if (!res.ok) {
      throw new Error(order?.message ?? order?.error ?? `pay failed: ${res.status}`);
    }
    return order as PayResult;
  }
}
