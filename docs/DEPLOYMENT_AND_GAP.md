# Covar — status terhadap brief & panduan menjalankan semua fitur (incl. deployment)

> **Urutan langkah go-live yang lengkap & terbaru ada di [`GO_LIVE_RUNBOOK.md`](./GO_LIVE_RUNBOOK.md).** Dokumen ini adalah status & gap.

Dokumen ini menjawab dua pertanyaan secara eksplisit:

1. **Apa yang harus dilakukan supaya semua fitur berjalan** — lokal penuh maupun di deployment (Vercel + hosting services).
2. **Apakah semua fitur brief sudah ada** — pemetaan satu per satu terhadap matrix §7, acceptance §15, dan delivery sequence §14, dengan bukti.

Tanggal penjabaran: 6 Nov 2026. Acuan repo: `github.com/wealthy-org/Covar` @ commit terbaru (`4b619e0`).

---

## A. Jawaban singkat

| Pertanyaan | Jawaban |
|---|---|
| Apakah semua fitur brief sudah selesai? | **Belum.** Milestone A–D selesai dan teruji; **E (vault/investor) selesai di chain lokal, menunggu 4 input dari Anda untuk testnet**; F & G sebagian. Tidak ada yang disembunyikan — UI melabeli setiap bagian yang masih simulasi/belum dibangun. |
| Bisakah dijalankan semua secara lokal sekarang? | **Ya, penuh** — tanpa env var apa pun (kecuali opsional `AI_PROVIDER_API_KEY`). |
| Bisakah di-deploy? | **Ya**: web di Vercel (plus catatan DB penting di §D.2), execution plane di host proses-panjang (Railway/Render/Fly/VPS). Hardhat hanya rehearsal lokal. |
| Tingkat kejujuran label | Semua angka "Simulated/practice/backtest" diberi label provenance; `VENUE_ADAPTER=live` **menolak boot** kalau adapter live belum di-review. |

---

## B. Status per milestone (§14 brief)

| Milestone | Output brief | Status | Bukti |
|---|---|---|---|
| A — Reference baseline | captures, register, dependency review | ✅ selesai | `docs/reference/`, `docs/PARITY_REGISTER.md`, `docs/UI_PARITY.md` |
| B — UI & builder | shell + tokens, drafts, editor/chat, validasi | ✅ selesai | 16 route, `design tokens cobalt`, suite builder |
| C — Testing & practice | backtest reproducible, practice harga live, record berlabel | ✅ selesai | seeded backtest, `/api/prices` Hyperliquid/Coinbase, label priceMode |
| D — Exchange & risk | test trading, signer terisolasi, rekonsiliasi order, limit independen | ✅ selesai (venue=paper) | 5 services, 39+20+19 check lolos, crash-test nyata |
| E — Vault / investor | kontrak, valuasi, funding, withdraw, fee, emergency | 🟡 **lokal selesai, testnet menunggu input** | `CovarVault.sol` 18 test + rehearsal E2E 19/19 di chain lokal 31337 |
| F — Full suite | discovery, records, Copilot, lifecycle, token/ekonomi, treasury, alerts | 🟡 sebagian | discovery/records/Copilot lifecycle ✅; token/staking/burn sengaja belum (diberi label) |
| G — Release evidence | findings, demo acceptance, manifest, runbooks | ⏳ setelah E-testnet | `docs/rehearsals/*.json` sudah jadi template |

---

## C. Matrix fitur §7 → status kami (detail)

Legend: ✅ bekerja dan punya bukti test · 🟡 permukaan ada, substansi sebagian simulasi/tergantung input · ❌ belum dibangun (dan UI bilang begitu).

| # | Modul (brief) | Status | Rincian & bukti |
|---|---|---|---|
| 1 | Strategy builder | ✅ | NL→typed rules (parser deterministik + Copilot bounded), visual editor, code view, diff tervalidasi, draft persisten (DB + localStorage). Test engine 25/25. |
| 2 | Historical testing | ✅ | Replay deterministik ber-seed, indikator EMA/RSI/ATR/Bollinger/volume, asumsi fee+slippage+funding eksplisit, chart + daftar trade + laporan reproducible. |
| 3 | Practice | ✅ | Harga live (Hyperliquid mid → fallback Coinbase spot), uang simulasi, start/stop eksplisit, ledger terisolasi, label `live`/`simulated` jelas. |
| 4 | Test-money trading | 🟡 | Arsitektur + adapter seam + journal siap; venue nyata (Lighter testnet) **menunggu adapter live yang direview** — saat ini venue paper deterministic di proses sendiri. Tidak pernah dicampur dengan practice/mainnet. |
| 5 | Live trading | 🟡 | Provisioning/order/fill/rekonsiliasi sudah diuji ujung-ke-ujung di rehearsal lokal; live venue sama seperti #4. |
| 6 | AI Copilot | 🟡 | Seam provider (`AI_PROVIDER_API_KEY`), interpretasi terbatas → engine deterministik, fallback berlabel (`rules-fallback`), kredit + rules-only twin. Belum: tools konteks (news/X/on-chain), pembelian kredit uang sungguhan. |
| 7 | Risk engine | ✅ | Proses independen; cek setiap order (7 check): allowlist market, leverage ≤5×, posisi ≤40%, pause harian 10%, stop drawdown 25%, force-close-only, persetujuan Copilot **tidak bisa** menaikkan batas. Service test 39/39. |
| 8 | Strategy lifecycle | ✅ | Versi, history, diff, publikasi butuh backtest + acknowledgement, notice investor 48h, practice side-by-side twin. |
| 9 | Discovery | 🟡 | Ranking/sort (score, return, TVL, drawdown, usia, creator, status) + kolom provenance. Data agen saat ini seeded-demo — sudah berlabel; memindahkan ke data indexer on-chain adalah wiring tersisa. |
| 10 | Agent detail | ✅ | Performance, decision log, ringkasan aktivitas, rules public/private, versi, risk, dan tab vault. |
| 11 | Vaults | 🟡 | Kontrak: deposit/valuasi/share/withdraw-request/settle/claim/fee/emergency/pause — 18 test lolos + UI membaca state kontrak saat address diset. Belum: deploy 46630 (lihat §F). |
| 12 | Creator economics | 🟡 | Fee 1% + 0.10 USDG, ≤20% dari profit trade menang, split 80/20, kalkulator, treasury. Settlement on-chain menunggu deploy. |
| 13 | AI credits | 🟡 | Estimasi/reservasi/rekonsiliasi pemakaian + top-up (simulasi). Integrasi Orbio: diputuskan memakai dependency kompatibel (provider LLM via `AI_PROVIDER_API_KEY`); billing sungguhan menunggu akun owner. |
| 14 | Token features | ❌ (berlabel) | Bar pengumuman "not deployed yet", halaman ekonomi menjelaskan tanpa mengilustrasikan. Sesuai brief §7/§15: halaman dekoratif ≠ fitur. |
| 15 | Treasury/staking | 🟡/❌ | Akunting fee nyata ✅; buyback/burn = nol dan ditulis eksplisit (tidak dibuat-buat); staking ❌ labelled coming-soon. |
| 16 | Notifications | ✅ | Inbox in-app: practice start/stop, publish, deposit, request/claim, credit top-up, risk — hanya dari transisi state nyata; badge unread. Channel email/push ❌ (tidak diklaim). |
| 17 | Documentation | ✅ | `/docs`, README, TESTING.md, PARITY_REGISTER, FEATURE_STATUS, rehearsal report, runbook CI. |
| 18 | Application storage | ✅ | Prisma + SQLite dev (Postgres-ready), snapshot sesi + tabel queryable (notifications, ledger, practice runs, strategy versions), roundtrip terverifikasi; services sengaja **tidak** pakai DB ini (journal mereka sumber kebenaran order). |

### Acceptance criteria (§15) — ringkas

- Visual: token cobalt `#3B5BDB`/`#2F49B5` diimplementasi global; hierarki nav/kartu/tabel/chart/dialog mengikuti capture; P&L merah/hijau semantik; responsive + keyboard. ✅
- Fungsional: 8 dari 10 poin ✅ hari ini. Yang tersisa: "test/live orders bounded/direkonsiliasi" (✅ di venue paper — menunggu adapter live untuk label "testnet") dan "Discovery/records/treasury dari real on-chain data" (🟡 — indexer sudah berjalan; wiring ranking ke indexer tersisa).
- Emergency path: didemokan dalam rehearsal (pause → exit tetap berfungsi, vault tak tersentuh). ✅ lokal.

---

## D. Cara menjalankan SEMUA fitur

### D.1 Lokal (pengalaman penuh)

```bash
git clone https://github.com/wealthy-org/Covar.git && cd Covar
pnpm install          # postinstall: .env dibuat + prisma client digenerate (tidak menimpa .env lama)
pnpm db:migrate       # siapkan tabel SQLite dev
pnpm dev              # web → http://localhost:3000
pnpm services         # execution plane → :4010 execution · :4011 venue · :4012 risk · :4013 signer
pnpm indexer          # (opsional) indexer event vault → :4014, butuh node EVM lokal (lihat rehearsal)
```

Tanpa env apa pun app berjalan penuh dalam mode review; Copilot tanpa `AI_PROVIDER_API_KEY` memakai parser rules dan **diberi label**.

Opsional penuh-chain (rehearsal lokal, koin simulasi di transaksi sungguhan):

```bash
corepack pnpm exec hardhat node --hostname 0.0.0.0 --port 8545   # terminal 1
pnpm deploy:local        # terminal 2 — deploy MockUSDG + CovarVault (catat address)
pnpm rehearse:e2e        # 19 check: deposit→pause→resume→withdraw, crash-recovery
```

Set env `NEXT_PUBLIC_COVAR_VAULT_ADDRESS=<address>` + restart `pnpm dev` → `/chain`, `/portfolio` membaca kontrak lokal secara langsung.

### D.2 Deployment production/demo

**Web (Next.js) → Vercel**

1. Import repo `wealthy-org/Covar` di Vercel, framework Next.js, build command default (`pnpm build`). `postinstall` otomatis men-generate Prisma client — tidak perlu ubah build command.
2. Set env di **Vercel → Settings → Environment Variables** (jangan ditaruh di repo):

| Key | Wajib? | Keterangan |
|---|---|---|
| `NEXT_PUBLIC_CHAIN_ENV` | opsional | `practice` (default) / `testnet` / `mainnet` |
| `NEXT_PUBLIC_APP_ENV` | opsional | label UI |
| `NEXT_PUBLIC_RH_TESTNET_CHAIN_ID` / `NEXT_PUBLIC_RH_TESTNET_RPC_URL` | default terset | 46630 / rpc testnet robinhood |
| `NEXT_PUBLIC_RH_MAINNET_CHAIN_ID` / `…_RPC_URL` | default terset | 4663 / rpc mainnet |
| `NEXT_PUBLIC_COVAR_VAULT_ADDRESS` | saat testnet deploy | kosong = UI "Simulated" (jujur) |
| `NEXT_PUBLIC_WALLET_PROVIDER` | opsional | `session`/`evm` (Privy belum di-ship) |
| `DATABASE_URL` | **penting** (lihat catatan DB) | Postgres URL untuk sync sesi |
| `AI_PROVIDER_API_KEY` | opsional | mengaktifkan Copilot model; tanpa ini parser rules (berlabel) |
| `EXEC_URL` | saat services dihosting | URL service execution (default `http://127.0.0.1:4010`) — isi URL publik host services Anda |

> ⚠️ **Catatan SQLite di Vercel (penting):** filesystem serverless read-only. Tanpa `DATABASE_URL` Postgres, route `/api/state` tidak bisa persist (GET/POST error → app tetap jalan di localStorage, DB sync mati). Untuk deployment serius: buat Postgres (Neon atau Vercel Postgres), ubah `provider = "postgresql"` di `prisma/schema.prisma`, `pnpm exec prisma migrate deploy`, set `DATABASE_URL` di Vercel. Ini langkah 10 menit dan path-nya sudah disiapkan (schema tanpa tipe khusus SQLite).

**Execution plane (services :4010–4013) → HARUS host proses-panjang** (bukan Vercel): Railway / Render / Fly.io / VPS.

```bash
pnpm services     # atau: pnpm indexer utk indexer berdampingan
```

- Semua service sudah bind `0.0.0.0` dan punya `/health`. Yang boleh diekspos publik hanya port **execution (4010)** — sisanya internal. Set `EXEC_URL` di Vercel menunjuk ke situ.
- Journal hidup di `.covar-state/` (persist volume di host pilihan Anda) — itu audit trail restart/rekonsiliasi; jangan sampai ephemeral kalau mau demonstrasikan recovery di deployment.
- `VENUE_ADAPTER` biarkan default (paper). `live` menolak boot sampai adapter direview — by design.

**Kontrak/chain:** gunakan `pnpm preflight:testnet` + `pnpm deploy:testnet` HANYA setelah §F terpenuhi; rehearsal lokal adalah bukti yang berlaku sampai saat itu.

---

## E. Yang dilakukan di luar brief scope — tidak ada

- High-water-mark fee: **tidak** diimplementasi (brief §12 melarang).
- Follow/copy-trading: out of scope, vault funding sebagai investor path.
- Multisig/timelock: sengaja absen, single-key risk terdokumentasi.

---

## F. Yang masih kurang/belum — daftar jujur

### F.1 Menunggu INPUT DARI ANDA (blocker testnet) — apa dan dari mana asalnya

| Env key | Isinya | Dari mana Anda mendapatkannya | Dimana diisi |
|---|---|---|---|
| `DEPLOYER_KEY` | Private key wallet **admin/owner** — brief §4: wallet yang SAMA untuk testnet & mainnet (buat wallet baru khusus Covar, bukan wallet pribadi lama; key hanya di `.env` laptop saat deploy) | MetaMask → buat akun baru → Account details → Show private key. Isi testnet ETH via faucet resmi `faucet.testnet.chain.robinhood.com` (backup: `faucets.chain.link/robinhood-testnet`). Add network dulu: chainId 46630, RPC `https://rpc.testnet.chain.robinhood.com`. Catatan brief: akses RPC butuh VPN di sebagian region. | `.env` lokal (server-only, jangan commit) |
| `OPERATOR_ADDRESS` | Address wallet ke-2 (operator vault: reporter NAV & settler withdrawal) | MetaMask akun baru lagi — yang dibutuhkan hanya address-nya | `.env` lokal |
| `TRADING_SIGNER_PRIVATE_KEY` | Private key dari wallet operator itu (dipakai signer/executor saat anchor ke chain) | Akun operator yang sama → Show private key | `.env` lokal |
| `FEE_RECIPIENT_ADDRESS` | Address wallet ke-3 (penerima fee platform) | MetaMask akun baru — cukup address | `.env` lokal |
| `USDG_ADDRESS` | Kontrak token USDG **testnet** | **Terkonfirmasi:** `0x7E955252E15c84f5768B83c41a71F9eba181802F` — dipublikasikan Paxos (penerbit USDG) di docs.paxos.com/guides/stablecoin/usdg/testnet; on-chain Global Dollar · USDG · 6 desimal. Dana uji: faucet.paxos.com. Default di script testnet. | `.env` lokal |
| `AI_PROVIDER_API_KEY` (+ `AI_PROVIDER`, `AI_MODEL`) | API key Copilot (opsional) | **Orbio** (rekomendasi, = referensi): `orbio.so/dashboard` → API key `sk-orbio-…`; atau `console.anthropic.com` / OpenAI | `.env` lokal + Vercel env |
| `DATABASE_URL` | Connection string **Postgres** (hanya deployment) | Neon / Vercel Postgres → copy "connection string"-nya | Vercel env saja (lokal biarkan default SQLite) |
| `NEXT_PUBLIC_COVAR_VAULT_ADDRESS` | Address vault | **Tidak dicari — dihasilkan:** muncul di output `pnpm deploy:testnet` dan `deployments/46630.json` | `.env` + Vercel env, setelah deploy |
| `CONFIRM_MAINNET` | persis `yes` | Hanya saat mainnet deploy (setelah semua gate lolos) | `.env` lokal |

Prosedurnya: buat 3 wallet testnet terpisah di MetaMask → isi deployer dari faucet → isi
`DEPLOYER_KEY`/`OPERATOR_ADDRESS`/`TRADING_SIGNER_PRIVATE_KEY`/`FEE_RECIPIENT_ADDRESS`/`USDG_ADDRESS`
di `.env` → `pnpm preflight:testnet` (cek kesiapan, read-only) → `pnpm deploy:testnet` → ambil address
dari output/`deployments/46630.json` → isi `NEXT_PUBLIC_COVAR_VAULT_ADDRESS` di `.env` **dan** Vercel →
ulangi `pnpm rehearse:e2e` di chain 46630. Aturan keamanan: private key tidak pernah ke chat/repo/file
yang ter-commit; `.env` sudah masuk `.gitignore`; wallet admin yang sama dipakai di mainnet (brief §4) — karena itu key-nya tidak pernah ditaruh di server mana pun dan dihapus dari `.env` setelah deploy.

### F.2 Engineering tersisa (tidak butuh keputusan Anda, urutan kerja berikutnya)

1. **Live venue adapter** (`services/shared/venue-adapters.ts` — seam sudah final): Lighter testnet adapter + review security; harus lolos `rehearse:e2e` tanpa diubah.
2. **Postgres production** untuk storage aplikasi (switch provider + migrate deploy; langkah ada di §D.2).
3. **Wiring discovery/treasury → indexer** (indexer sudah decode event vault; ranking/sejarah belum membaca dari sana).
4. **Adapter wallet penuh**: `NEXT_PUBLIC_WALLET_PROVIDER=evm` sudah baca akun injected; Privy (provider referensi) belum di-ship.
5. Copilot context tools (news/X/on-chain) + pembelian kredit.
6. Pengujian beban/chaos multi-hari (soak) sebelum mainnet.

### F.3 Sengaja belum dibangun (berlabel, menunggu keputusan)

- Token protokol + launch + staking + buyback/burn.
- Channel notifikasi email/push.
- i18n/dark mode/mobile apps; observability metrics.

---

## G. Handover (§15) — posisi hari ini

| Deliverable | Status |
|---|---|
| Source repository + history | ✅ di GitHub |
| Dependency/license inventory | ✅ `package.json` + lockfile; dependency policy di docs |
| Architecture/schema/API docs | ✅ `README`, `docs/`, `prisma/schema.prisma`, services README di kode |
| Deployment manifest | ✅ `.env.example` + panduan di atas (§D.2) |
| Test results | ✅ engine 25 · integration 39 · cross-process 20 · contracts 18 · E2E 10 · rehearsal 19 |
| Parity register | ✅ `docs/PARITY_REGISTER.md` |
| Operator runbook / recovery | ✅ rehearsal report `docs/rehearsals/` + TESTING §F |
| Unresolved decisions list | ✅ §F dokumen ini |
| Secrets | ⚠️ transfer lewat jalur aman, tidak pernah di repo — sesuai brief |

---

*Perubahan status yang sebenarnya selalu tercermin duluan di `docs/FEATURE_STATUS.md` dan `docs/PARITY_REGISTER.md`; dokumen ini adalah sintesis untuk pengambilan keputusan.*
