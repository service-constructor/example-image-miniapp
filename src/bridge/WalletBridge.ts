// WalletBridge — the Client SDK a service web app uses to talk to the wallet
// shell (white paper §13.1). When the mini-app is hosted inside the cabinet, the
// shell is the parent window and the bridge speaks **postMessage** to it:
//
//   const bridge = await WalletBridge.init();
//   const ctx = bridge.getContext();          // { userId }
//   const result = await bridge.pay(quote);    // { orderId, state } | null (cancel)
//
// The trusted consent screen is rendered by the SHELL, not the mini-app, so the
// service cannot alter what the user approves. The mini-app just calls pay().

export interface WalletContext {
  // userId is a plaintext hint from the shell — fine for display, but NOT to be
  // trusted for identity (a hosting shell could lie).
  userId: string;
  // encUserId is the user id sealed to THIS service's encryption key by the
  // shell. The mini-app sends it to its own backend, which decrypts it with the
  // service private key — yielding a user id that cannot be forged. This is the
  // trusted identity.
  encUserId: string;
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

const CHANNEL = "sc-wallet-bridge";

type ReqBody =
  | { type: "getContext" }
  | { type: "prepare"; quote: Quote }
  | { type: "pay"; quote: Quote; selectedWalletId: string };
type Req = ReqBody & { id: string };

type Resp = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: string };

function isEnvelope(data: unknown): data is { channel: string; payload: Resp } {
  return typeof data === "object" && data !== null && (data as { channel?: unknown }).channel === CHANNEL;
}

export class WalletBridge {
  private seq = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(private ctx: WalletContext) {
    window.addEventListener("message", (ev) => {
      if (ev.source !== window.parent) return;
      if (!isEnvelope(ev.data)) return;
      const resp = ev.data.payload;
      const p = this.pending.get(resp.id);
      if (!p) return;
      this.pending.delete(resp.id);
      if (resp.ok) p.resolve(resp.result);
      else p.reject(new Error(resp.error));
    });
  }

  // init handshakes with the host shell (the parent window) for user context.
  static async init(): Promise<WalletBridge> {
    if (window.parent === window) {
      throw new Error("WalletBridge: not hosted in a wallet shell (open via the cabinet)");
    }
    const tmp = new WalletBridge({ userId: "", encUserId: "" });
    const ctx = (await tmp.call({ type: "getContext" })) as WalletContext;
    tmp.ctx = ctx;
    return tmp;
  }

  getContext(): WalletContext {
    return this.ctx;
  }

  // pay hands the quote to the shell, which shows the consent screen and, if the
  // user approves, performs the authenticated payment. Returns null on cancel.
  async pay(quote: Quote): Promise<PayResult | null> {
    // selectedWalletId is chosen by the user on the shell's consent screen; the
    // pay request carries it back. We pass an empty placeholder — the shell owns
    // wallet selection in the hosted model.
    const result = (await this.call({ type: "pay", quote, selectedWalletId: "" })) as PayResult | null;
    return result;
  }

  private call(req: ReqBody): Promise<unknown> {
    const id = `${Date.now()}-${this.seq++}`;
    const envelope = { channel: CHANNEL, payload: { ...req, id } as Req };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      window.parent.postMessage(envelope, "*");
    });
  }
}
