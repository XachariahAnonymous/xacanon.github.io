# LOLCOIN TCG — Browser Game

A fully browser-based Solana Trading Card Game. **No build step** — just open `index.html`.

## Run it
Double-click **`web/index.html`** (or serve the `web/` folder with any static host).
- Click **Connect Wallet** — uses Phantom/Solflare/Backpack if installed, otherwise **demo mode** (100 free NIB).
- Click **+ Get 50 demo NIB** for more tokens, then **Rip Pack**.
- **Admin panel:** open **`admin.html`** (or the *Admin* link). Any wallet passes in demo mode.

> Tip: serve over `http://localhost` (e.g. `npx serve web`) so both pages share the same
> `localStorage`. Opening the two files directly can isolate their state in some browsers.

## Files
| File | Purpose |
|---|---|
| `index.html` / `admin.html` | Player app / Admin panel (no framework, classic scripts) |
| `js/matrix.js` | **Elemental advantage matrix** (Deliverable 3) — O(1) combat/UI lookups |
| `js/catalog.js` | Procedurally generates all **1,710 designs** (stand-in for the `cards` table) |
| `js/engine.js` | **Pack-opening RNG** (Deliverable 2) — exact drop rates, supply-aware down-tiering |
| `js/store.js` | **Backend seam** — localStorage now; swap for Supabase + Solana to go live |
| `js/app.js` / `js/admin.js` | UI logic |
| `../supabase/schema.sql` | **Postgres schema** (Deliverable 1) |
| `../lib/packEngine.ts` | Server-side (provably-fair) version of the engine |

## Going live (replace demo seams — UI code stays unchanged)
Everything backend-ish lives in **`js/store.js`**. Reimplement these against real services:

1. **`connectWallet()`** → already tries injected wallets; add `@solana/wallet-adapter` if you want the modal.
2. **`buyAndOpenPack()`** → move server-side into a **Supabase Edge Function**:
   - verify the 5-NIB SPL payment tx (burn or send to `game_config.vault_wallet`),
   - run `openPack()` from `lib/packEngine.ts` (⚠️ **never** roll in the browser — it's cheatable),
   - mint cNFTs via Metaplex, write `pack_openings` + `minted_nfts` rows.
3. **`reserve()`** → call the `reserve_card_serial()` RPC in `schema.sql` (atomic cap enforcement).
4. **`isAdmin()`** → verify a signed nonce (`wallet.signMessage`) against the `admin_wallets` table.

## Verified
- RNG produces exact rates over 2M packs: Common 3.0, Uncommon 1.9, Rare ~1.02, SR 5%, UR 2%, MR 1%, HR 0.01%; **6 cards/pack**.
- Catalogue = 1,710 designs; per-tier caps match spec (30M/20M/10M/500k/200k/100k/10k).
- Elemental modal matches the matrix (e.g. Water ×1.5 vs Fire; ×0.75 vs Earth/Electric).
