import { useState } from "react";
import type { ConsentDecision, ConsentPreview } from "./bridge/WalletBridge";

interface Props {
  preview: ConsentPreview;
  onDecision: (d: ConsentDecision) => void;
}

// ConsentModal is the wallet's trusted confirmation screen (white paper 7.2):
// it shows the amount, the service and the source wallet, and only on explicit
// approval does the shell sign the device consent and pay. It is styled as a
// distinct "wallet" surface to signal it is not part of the service UI.
export function ConsentModal({ preview, onDecision }: Props) {
  const [walletId, setWalletId] = useState(preview.wallets[0]?.walletId ?? "");
  const expired = preview.exp > 0 && Date.now() / 1000 > preview.exp;
  const canPay = !!walletId && !expired;

  return (
    <div className="consent-backdrop">
      <div className="consent">
        <div className="consent-head">
          <span className="lock">🔒</span> Wallet · Confirm payment
        </div>

        <div className="consent-amount">
          {preview.amount} <span className="ccy">{preview.currency}</span>
        </div>
        <div className="consent-desc">{preview.description}</div>
        <div className="consent-row">
          <span className="muted">Service</span>
          <span className="mono">{preview.serviceId}</span>
        </div>

        <label className="consent-row col">
          <span className="muted">Pay from</span>
          {preview.wallets.length === 0 ? (
            <span className="warn">No eligible wallet for {preview.currency}</span>
          ) : (
            <select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              {preview.wallets.map((w) => (
                <option key={w.walletId} value={w.walletId}>
                  {w.label} ({w.walletId})
                </option>
              ))}
            </select>
          )}
        </label>

        {expired && <div className="warn">This quote has expired — please retry.</div>}

        <div className="consent-actions">
          <button className="ghost" onClick={() => onDecision({ approved: false })}>
            Cancel
          </button>
          <button
            disabled={!canPay}
            onClick={() => onDecision({ approved: true, walletId })}
          >
            Confirm & pay
          </button>
        </div>
        <div className="consent-foot muted">
          You are approving this exact amount. The service cannot change it.
        </div>
      </div>
    </div>
  );
}
