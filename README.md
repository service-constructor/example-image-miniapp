# Service Constructor — Example Mini-App

A reference **Service Web App** (white paper §4.1, §13.1) for the
[Service Constructor](../constructor) platform: a tiny "Image Shop" that buys
random images through the wallet bridge and shows the user's gallery of
purchases.

It demonstrates the *front* of a service integration — the WebView app the
wallet embeds — paired with a **mock wallet shell** that stands in for the
native wallet (holds the device key, signs consent, calls the platform).

```
 mini-app (React)            mock wallet shell           platform
 ┌──────────────┐  quote     ┌──────────────┐  /pay      ┌──────────┐
 │ Buy → bridge │──────────► │ consent sign │──────────► │  saga    │
 │ Gallery      │ ◄──────────│ (device key) │ ◄──────────│ execute  │
 └──────┬───────┘   order    └──────────────┘   order    └────┬─────┘
        │ /quote, /orders                                      │ HTTP /execute
        └──────────────────────► example-service ◄─────────────┘
```

The mini-app itself is pure UI: it gets a **signed quote** from the service,
hands it to `WalletBridge.pay()`, and renders the gallery from the service's
`/orders`. The device key and consent signing live in the shell — never in the
browser — exactly as the security model requires.

## Run it (one command)

With the platform (`../constructor`) and service (`../example-service`) as
siblings and Docker running:

```bash
npm install
bash demo/run.sh
```

This boots Postgres, the platform (real HTTP executor), the example service, the
mock wallet shell and the mini-app, wiring the shell's device key into the
platform automatically. It opens **http://localhost:5180** — click **Buy** on a
product and the image appears in *Your images*.

Ctrl+C stops everything. Logs are in `demo/.logs/`.

## Pieces

| Path                         | Role                                                        |
|------------------------------|-------------------------------------------------------------|
| `src/bridge/WalletBridge.ts` | Client SDK: `init()` handshake, `getContext()`, `pay(quote)`|
| `src/api.ts`                 | Service calls: catalog, `createQuote`, gallery              |
| `src/App.tsx`                | Shop UI: catalog + buy + gallery                            |
| `mock-shell/server.ts`       | Stand-in wallet: device key, `/context`, `/pay` (consent)   |

## How a purchase flows

1. The shop asks the **service** for a signed quote (`POST /quote`).
2. `bridge.pay(quote)` posts it to the **shell**.
3. The shell recomputes `sha256(quote)`, builds the **device-signed consent**,
   mints the user session, and calls the platform `POST /v1/services/pay`.
4. The platform verifies the quote (service key) and consent (device key), runs
   the saga, and HTTP-calls the service's `/execute` to deliver the image.
5. The shop refreshes the gallery from the service's `/orders?userId=`.

## Notes

- The shell mints a demo user JWT (`AUTH_JWT_SECRET`, default `devsecret`) so
  the platform authenticates `/pay`. In production the wallet already holds a
  real session.
- The shell auto-generates its device key in `mock-shell/keys/`; the demo passes
  its public PEM to the platform as `DEVICE_KEY_PEM`.
