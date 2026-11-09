# Covar — Runbook Go-Live (dari kondisi sekarang → deployment resmi)

**Disusun:** 7 Nov 2026 · **Diperbarui:** 8 Nov 2026 (paket 3.1–3.7 + 3.10 selesai) · **Acuan:** `COVAR_ROBINHOOD_DEV_BRIEF.md` (2 Nov 2026) · repo `wealthy-org/Covar`

Dokumen ini adalah **urutan kerja lengkap** supaya semua fitur brief aktif dan Covar siap deployment
resmi. Setiap langkah diberi penanggung jawab:

- **👤 ANDA**: akun, wallet, uang, keputusan owner, dan rahasia (hanya Anda yang boleh memegangnya)
- **🛠 DEV**: pekerjaan kode (bisa saya kerjakan setelah Anda memberi input yang disebut)
- **🤝 BERSAMA**: Anda menjalankan perintah atau memberi akses, dev memverifikasi

> **Jujur dulu:** paket kode 3.1–3.7 dan 3.10 sudah dibangun dan lolos test **lokal** (termasuk E2E
> browser on-chain di chain lokal). Itu **belum** berarti live: semuanya masih harus diuji di testnet
> (Fase 5–7) dengan vault v2 yang baru di-deploy ulang. Yang belum dibangun: 3.8 (`rehearse:testnet`)
> dan 3.9 (token, tetap *pending*). Brief §14 dan §15 melarang mengklaim platform live hanya karena
> UI-nya berfungsi.

---

## Ringkasan urutan

```
Fase 0  Keputusan owner                    👤      (½–1 hari)
Fase 1  Buat akun & layanan                👤      (1 hari)
Fase 2  Siapkan wallet                     👤      (1–2 jam)
Fase 3  Paket kode                        🛠      (3.1–3.7, 3.10 ✅ · 3.8 sisa · 3.9 pending)
Fase 4  Verifikasi lokal penuh             🤝
Fase 5  Deploy kontrak ke TESTNET 46630    🤝
Fase 6  Deploy infrastruktur staging       🤝
Fase 7  Uji penerimaan di testnet (§15)    🤝      (min. 7 hari soak)
Fase 8  Keamanan & dokumen handover        🤝
Fase 9  MAINNET 4663 — nilai kecil dulu    🤝
Fase 10 Operasional & scale bertahap       👤🛠
```

Aturan yang tidak boleh dilanggar (brief §4): **testnet dulu → semua test lolos → baru mainnet,
dimulai dengan nilai kecil.** Mainnet tanpa testnet yang lolos penuh = dilarang.

---

## Fase 0 — Keputusan owner 👤

Tulis jawabannya. Cukup dikirim ke dev lewat chat, karena isinya bukan rahasia.

| # | Keputusan | Pilihan / catatan | Memblok apa |
|---|---|---|---|
| 0.1 | **Domain** resmi (mis. `covar.xyz`) | Beli di registrar (Namecheap/Cloudflare) | Fase 6 |
| 0.2 | **Logo final** | Logo sekarang `public/logo.png`, ganti kalau ada versi final | tidak memblok |
| 0.3 | **Tabel parameter fee** (brief §12) | Default referensi: deposit/withdraw **1% + 0,10 USDG**, fee creator **≤20% profit trade menang**, split **80/20** creator/platform, trade rugi tidak di-net. Konfirmasi: pembulatan, pengecualian dana creator sendiri, dan kapan fee ditagih | Fase 5 |
| 0.4 | **Batas nilai awal mainnet** | Mis. TVL maks **1.000 USDG per vault** dan **100 USDG per deposit** untuk 2–4 minggu pertama | paket 3.1 |
| 0.5 | **Venue trading** | ✅ Diputuskan: **Lighter di Robinhood Chain** (`api.rh.lighter.xyz`, testnet `api.rh-testnet.lighter.xyz`). Dicek on-chain 8 Nov: Lighter RH **mainnet** berjalan di chain **4663** dengan **USDG yang sama** dengan vault (kontrak `0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d`). ⚠️ Lighter RH **testnet tidak berada di 46630** (USDG uji-nya `0xAd355C2d…0033`, beda dengan USDG Paxos testnet), jadi di testnet dana vault **tidak bisa** dikirim ke Lighter. Uji testnet = vault 46630 + akun Lighter RH testnet yang didanai terpisah (lihat Fase 7) | paket 3.4 |
| 0.6 | **AI credits**: Orbio atau provider LLM langsung | **Rekomendasi: Orbio** (lihat Lampiran B). Kode sudah mendukung keduanya lewat env | paket 3.7 |
| 0.7 | **Login wallet**: injected EVM (MetaMask/Rabby) atau **Privy** (seperti referensi) | Privy perlu akun dan App ID | paket 3.2 |
| 0.8 | **Token protokol, staking, buyback/burn** | Bangun sekarang **atau** biarkan berlabel *pending* (brief §15 membolehkan asal dicatat jujur). Saran: pending dulu | paket 3.9 |
| 0.9 | **Terima risiko single-key** secara tertulis | Brief §4: satu wallet admin tanpa multisig. Kalau key bocor atau hilang, semua kontrak yang dikendalikannya ikut terkompromi | Fase 8 |
| 0.10 | **Anggaran operasional** | Perkiraan: Vercel Pro ~$20/bln, Neon ~$0–19, Railway ~$5–20, Alchemy ~$0–49, AI sesuai pemakaian, audit kontrak (opsional, sangat disarankan) | — |

---

## Fase 1 — Buat akun & layanan 👤

Pakai email bisnis dan aktifkan 2FA di semua akun.

| # | Layanan | Untuk apa | Yang perlu Anda siapkan / berikan ke dev |
|---|---|---|---|
| 1.1 | **VPN** (mis. Cloudflare WARP, Proton) | RPC Robinhood Chain sering diblokir ISP Indonesia (brief §4) | Nyalakan setiap kali menjalankan perintah chain |
| 1.2 | **GitHub** `wealthy-org/Covar` | Source code | Push commit yang sudah ada (`git push`) |
| 1.3 | **Vercel** | Hosting web Next.js | Undang dev sebagai member, atau Anda yang import repo |
| 1.4 | **Neon** (atau Vercel Postgres) | Database production | Connection string → nanti jadi `DATABASE_URL` (diisi di Vercel, **jangan** dikirim lewat chat) |
| 1.5 | **Railway / Fly.io / VPS** | Execution plane (proses jangka panjang: execution, venue, risk, signer, indexer, operator) | Akun dan billing aktif |
| 1.6 | **Alchemy** (atau QuickNode/dRPC) | RPC production. RPC publik di-rate-limit (brief §4) | Buat app untuk *Robinhood Chain Testnet* dan *Mainnet*, simpan URL-nya |
| 1.7 | **Lighter testnet** | Venue trading uji (test-money, brief §7) | Buka `testnet.app.lighter.xyz`, connect wallet **operator** (Fase 2), lalu klaim dana uji |
| 1.8 | **Orbio** (rekomendasi) atau Anthropic/OpenAI | Copilot AI | `orbio.so` → login wallet (Privy) → isi saldo CREDIT → dashboard → API key `sk-orbio-…` → `AI_PROVIDER_API_KEY` (lihat Lampiran B) |
| 1.9 | **Privy** (hanya jika 0.7 = Privy) | Login dan embedded wallet | App ID dan App Secret |
| 1.10 | **Domain + DNS** | Alamat resmi | Akses DNS (Cloudflare disarankan) |
| 1.11 | **Password manager** (1Password/Bitwarden) | Menyimpan semua rahasia | Wajib, karena rahasia **tidak pernah** dikirim lewat chat, repo, atau dokumen |

---

## Fase 2 — Siapkan wallet 👤

Brief §4 menetapkan **satu wallet admin yang sama untuk testnet dan mainnet**, tanpa multisig.
Kontrak juga mewajibkan *operator* dan *fee recipient* memakai wallet berbeda (dicek oleh `scripts/deploy.ts`).

| Wallet | Peran di kontrak | Env | Catatan keamanan |
|---|---|---|---|
| **A. Admin / Owner / Deployer** | `owner`: pause, ganti operator, ubah fee, transfer ownership | `DEPLOYER_KEY` | **Paling kritis.** Disarankan wallet yang baru dibuat khusus Covar, dengan seed phrase dicatat offline. Karena dipakai juga di mainnet, key ini **hanya** boleh ada di `.env` laptop Anda saat deploy. **Jangan pernah** taruh di Vercel, Railway, atau server mana pun. Hapus dari `.env` setelah deploy selesai. |
| **B. Operator** | `operator`: `reportNav`, `markPositionsClosed`, `settleWithdrawal`, plus akun Lighter | `OPERATOR_ADDRESS` (address) + `TRADING_SIGNER_PRIVATE_KEY` (key) | Hot key yang berjalan di server signer/operator. Tidak bisa menarik dana investor ke alamat lain (dijamin kontrak). Isi ETH secukupnya untuk gas. |
| **C. Fee recipient / Treasury** | Penerima fee platform | `FEE_RECIPIENT_ADDRESS` | Yang dibutuhkan hanya address-nya. Untuk mainnet sebaiknya hardware wallet. |

Langkah:

1. Install MetaMask atau Rabby, lalu buat **3 akun baru** (A, B, C). Jangan memakai wallet pribadi lama.
2. Tambahkan network **Robinhood Chain Testnet**: chainId `46630`, RPC `https://rpc.testnet.chain.robinhood.com`, simbol `ETH`, explorer `https://explorer.testnet.chain.robinhood.com`.
3. **Nyalakan VPN**, buka faucet resmi `https://faucet.testnet.chain.robinhood.com`, lalu isi ETH testnet ke **A** dan **B**.
4. **Testnet USDG — sudah terkonfirmasi.** Alamat USDG mainnet tidak ada di testnet. Paxos (penerbit USDG)
   mempublikasikan token Robinhood Testnet di `docs.paxos.com/guides/stablecoin/usdg/testnet`:
   `0x7E955252E15c84f5768B83c41a71F9eba181802F` (*Global Dollar*, `USDG`, 6 desimal; dicek on-chain 7 Nov 2026).
   Ambil USDG uji untuk wallet investor di **`https://faucet.paxos.com`** (pilih Robinhood Testnet).
   Script deploy/preflight memakai alamat ini secara default di testnet.
5. Siapkan juga **wallet D (investor uji)** dan **wallet E (creator uji)** untuk skenario acceptance.
6. Simpan semua seed phrase dan private key di password manager.

---

## Fase 3 — Paket kode yang masih kurang 🛠

Ini daftar jujur hal yang **belum** ada di repo hari ini. Semuanya bisa saya kerjakan bertahap. Kolom
"Input Anda" menunjukkan apa yang harus tersedia lebih dulu.

**Urutannya penting:** paket yang mengubah kontrak (3.1) harus selesai **sebelum** deploy testnet,
supaya yang diuji sama persis dengan yang nanti naik ke mainnet.

| # | Paket | Status (8 Nov 2026) | Cara pakai / yang Anda siapkan |
|---|---|---|---|
| 3.1 | **Kontrak v2: batas TVL & deposit, trading account** | ✅ `4296369`. `maxTotalAssets` 1.000 USDG, `maxDepositPerTx` 100 USDG (owner bisa ubah lewat `setLimits`), `setTradingAccount`, `allocateToVenue`, settle memotong fee dan butuh likuiditas cukup, deposit butuh NAV segar. Test kontrak 25, rehearsal 22 | **Deploy ulang v2 di testnet** (Fase 5), lalu `setTradingAccount` dari `/chain/console` |
| 3.2 | **Transaksi wallet di web** | ✅ `677c38c`. Panel **Invest · on-chain** di Portfolio dan di halaman vault: approve → deposit → request withdrawal → claim. Simulasi dulu sebelum prompt wallet; validasi min/cap/NAV basi; baris ledger hanya setelah receipt sukses | `NEXT_PUBLIC_WALLET_PROVIDER=evm` (MetaMask/Rabby) |
| 3.3 | **Layanan operator** (`pnpm operator`, :4014) | ✅ `df38234`. `reportNav` dari equity venue (dengan batas perubahan dan hold + alert kalau melonjak), `markPositionsClosed` → `settleWithdrawal`, auto-fund dari wallet B, alokasi kelebihan kas ke trading account. Default `OPERATOR_MODE=dry-run` | Wallet B + env `OPERATOR_*` (lihat `services/operator/README.md`) |
| 3.4 | **Adapter venue live: Lighter** | ✅ `601845b`. Signer WASM resmi Lighter, order limit IOC dengan slippage, idempotent (`clientOrderIndex` dari id intent), NAV dari `total_asset_value` akun | `VENUE_ADAPTER=live`, `LIVE_TRADING_CONFIRM=yes`, `LIGHTER_NETWORK`, `LIGHTER_ACCOUNT_INDEX`, `LIGHTER_API_KEY_INDEX`, `LIGHTER_API_PRIVATE_KEY` (di server) |
| 3.5 | **Database multi-user + login SIWE** | ✅ `677c38c`. Sign-In with Ethereum (nonce sekali pakai, cookie HttpOnly, hash token di DB), state per wallet, SQLite (dev) dan **PostgreSQL** (production) | `DATABASE_URL` Postgres → `pnpm db:pg:generate` lalu `pnpm db:pg:deploy`; `APP_ORIGIN` = domain |
| 3.6 | **Discover, record, treasury dari data on-chain** | ✅ `65564b6`. Indexer (:4016) membaca event vault + transfer USDG keluar dari vault (fee persis), timestamp blok, scan bertahap dari blok deploy. Vault muncul di Discover (tag **on-chain**), halaman vault menampilkan riwayat event dengan link tx, treasury menampilkan fee tercatat | `INDEXER_URL` di web, indexer jalan bersama `pnpm services` |
| 3.7 | **AI credits nyata** | ✅ `46c3378`. Top-up = transfer USDG ke `CREDITS_TREASURY_ADDRESS`, diverifikasi server dari receipt (sekali per transfer). Tiap panggilan model dipotong sesuai token usage × harga + fee aplikasi; gagal = gratis; tanpa kredit → parser aturan gratis. "Connect Orbio" per pengguna masih menunggu akses partner Orbio | `CREDITS_MODE=enforce`, `CREDITS_TREASURY_ADDRESS`, `AI_PRICE_IN_PER_MTOK` / `AI_PRICE_OUT_PER_MTOK`, `AI_APP_FEE_PCT` |
| 3.8 | **Script testnet** `rehearse:testnet` | ⏳ belum. Uji testnet sekarang lewat `/chain/console` + panel Invest (manual, bukti ke `docs/rehearsals/`) | — |
| 3.9 | **Token / staking / buyback** | ⏸ pending (keputusan 0.8), berlabel *not deployed* | — |
| 3.10 | **Monitoring & alert** (`pnpm monitor`, :4015) | ✅ `df38234`. Health semua service, NAV menua/basi, saldo gas operator, operator macet, withdrawal tertunda, kas claim kurang, vault pause/close-only → **Telegram** (dengan cooldown) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` → lihat `.env.example` bagian monitor |

**Test lokal per 8 Nov 2026 (semua hijau):** engine 25 · reconciliation 39 · lighter 44 (+3 wire check) ·
operator 95 · auth 30 (SQLite **dan** Postgres) · indexer 27 · credits 41 (SQLite **dan** Postgres) ·
kontrak 25 · rehearsal on-chain 22 · E2E app 10 · **E2E on-chain browser 4** (`pnpm test:e2e:invest`:
investor SIWE → deposit → withdraw → operator settle → claim; owner console v2; Discover → vault → treasury;
top-up kredit USDG).

---

## Fase 4 — Verifikasi lokal penuh 🤝

Jalankan di laptop Anda (atau dev yang menjalankan):

```bash
git clone https://github.com/wealthy-org/Covar.git && cd Covar
corepack enable
pnpm install                 # postinstall membuat .env + prisma client
pnpm db:migrate
pnpm lint && pnpm typecheck
pnpm test                    # engine 25
pnpm test:services           # reconciliation 39 · lighter 44 · operator 95 · auth 30 · indexer 27 · credits 41
pnpm test:contracts          # kontrak 25
pnpm exec playwright install chromium && pnpm test:e2e   # E2E 10
pnpm test:e2e:invest         # E2E on-chain 4 (menyalakan Hardhat, indexer, Next sendiri — tutup pnpm dev dulu)
pnpm build

# Rehearsal chain lokal (2 terminal)
pnpm exec hardhat node --hostname 0.0.0.0 --port 8545
pnpm rehearse:e2e            # 22 check: deposit→pause→resume→withdraw, crash recovery, ringkasan indexer
# (rehearse:e2e mengubah deployments/31337-e2e.json dan menulis docs/rehearsals/e2e-*.json — buang kalau tidak perlu)
```

**Syarat lanjut:** semua hijau, tanpa test yang di-skip.

---

## Fase 5 — Deploy kontrak ke TESTNET 46630 🤝

Prasyarat: Fase 0–4 selesai (terutama paket 3.1 dan 3.8), dan **VPN menyala**.

1. Isi `.env` di laptop Anda (file ini sudah di-`.gitignore`, **jangan di-commit**):
   ```env
   DEPLOYER_KEY=0x...            # wallet A
   OPERATOR_ADDRESS=0x...        # wallet B
   FEE_RECIPIENT_ADDRESS=0x...   # wallet C
   USDG_ADDRESS=0x7E955252E15c84f5768B83c41a71F9eba181802F   # USDG testnet resmi Paxos (boleh dikosongkan = default)
   RH_TESTNET_RPC=https://<url-alchemy-testnet>              # atau biarkan RPC publik
   ```
2. Cek kesiapan (read-only, tidak mengirim transaksi):
   ```bash
   pnpm preflight:testnet
   ```
   Semua baris harus ✓: chain id 46630, RPC reachable, USDG punya bytecode dan 6 desimal, deployer punya gas.
   Kalau RPC gagal, **cek VPN dulu** sebelum menganggap endpoint-nya rusak.
3. Deploy:
   ```bash
   pnpm deploy:testnet
   ```
   Hasilnya: alamat vault plus `deployments/46630.json` (commit file ini, karena isinya publik dan tidak rahasia).
4. Verifikasi source di Blockscout testnet: `pnpm verify:testnet` (tanpa private key; mengecek bytecode on-chain = checkout ini, lalu submit).
5. Laporkan NAV pertama dari wallet operator (dijalankan layanan operator 3.3), lalu tes deposit kecil (mis. 10 USDG) dari wallet D.
6. **Hapus `DEPLOYER_KEY` dari `.env`** setelah selesai.

### Status testnet (7 Nov 2026)

| Item | Nilai |
|---|---|
| Vault | `0xe3B2eDD026e2cb2736743C8c4Db021E15298bc2d` — **source terverifikasi** di explorer testnet |
| Tx deploy | `0xe1bd54482211acbaa28b38859a7c0d5e12bd1f93ea75dc53edd420fc53762fdc` (blok 149841837, status sukses) |
| Owner (wallet A) | `0x1FBaDaFb2056Af662aa11732e86B28aF550af0d9` |
| Operator (wallet B) | `0x3D2FAC269954487a63F51bf059701FbD9647E3Bf` |
| Fee recipient (wallet C) | `0x8b43AC0f705D18D2C42D12EB2fABe3e45e1045B1` |
| Parameter | fee deposit/withdraw 1% + 0,10 USDG · min deposit 10 USDG · NAV maks 6 jam · lonjakan NAV maks 20% |
| Catatan | Deploy **percobaan** (v1) — belum ada batas TVL/deposit. **Digantikan v2** (paket 3.1): deploy ulang untuk uji penerimaan resmi, lihat 5.8. |

### 5.7 Uji alur vault lewat **Vault console** (`/chain/console`)

> **Status 8 Nov 2026:** alur utama 8/8 ✅, BelowMinimum ✅, pause (deposit ditolak, penarikan tetap selesai) ✅,
> resume ✅. Sisa: NAV basi (>6 jam). Bukti dan tx hash ada di `docs/rehearsals/46630-manual-vault-2026-11-08.json`.
> Kontrak ini versi **sebelum cap (3.1)**, jadi uji ini harus diulang setelah redeploy.

Explorer testnet Robinhood (Blockscout v2.8.0) **tidak mengaktifkan connect wallet**, jadi tab *Write contract*
hanya bisa dibaca. Karena itu Covar punya halaman sendiri: buka `localhost:3000/chain/console` (atau `/chain` →
**Vault console**), lalu klik **Connect wallet** (MetaMask, network 46630). Halaman ini mengikuti akun yang aktif
di MetaMask, jadi peran cukup diganti dengan berpindah akun di wallet.

Setiap aksi **disimulasikan dulu**. Kalau akan gagal, alasannya ditampilkan (misalnya *StaleNav* atau
*NotOperator*) tanpa membuka wallet dan tanpa membayar gas. Tx hash tercatat di *Session log* dengan link explorer.

| # | Akun aktif di MetaMask | Bagian | Aksi | Isi |
|---|---|---|---|---|
| 1 | B (operator) | Operator actions | **Report NAV** | `0` |
| 2 | D (investor) | Investor actions | **Approve USDG** | `10` |
| 3 | D | Investor actions | **Deposit** | `10` → fee 0,2 USDG ke C, D dapat 9,8 share (harus dalam 6 jam setelah #1) |
| 4 | D | Investor actions | **Request withdrawal** | `9.8` (terisi otomatis) |
| 5 | B | Withdrawal queue | **Mark closed** | — |
| 6 | B | Withdrawal queue | **Settle 9.8** | — (netAssets = share × NAV) |
| 7 | D | Investor actions | **Claim** | — (D menerima ±9,602 USDG) |

Uji kasus gagal juga: deposit `5` (harus gagal *BelowMinimum*), deposit setelah >6 jam tanpa `reportNav`
(harus gagal *StaleNav*), lalu wallet A klik **Pause deposits** → deposit gagal (*Paused_*) tetapi `claim` tetap jalan. Terakhir klik **Resume**.
Simpan semua tx hash — itu bukti untuk `docs/rehearsals/46630-manual.json`.

---

### 5.8 Deploy ulang **vault v2** (wajib sebelum Fase 6–7)

> **Status 8 Nov 2026:** vault v2 **ter-deploy** di testnet 46630.
>
> | | |
> |---|---|
> | Vault v2 | `0x9f0172A7B568A9C38557dCD7C31Db9cb78e0f31B` |
> | Tx deploy | `0x93fc13a748ddd69bd9fdd58434c20492d3b4c4152859fae96541ad10fc18c31f` |
> | Constructor | asset USDG `0x7E95…802F` · fee recipient C `0x8b43…45B1` · operator B `0x3D2F…E3Bf` |
> | Limits | TVL 1.000 USDG · per deposit 100 USDG |
> | Source | **Sourcify exact match** (creation + runtime): https://repo.sourcify.dev/46630/0x9f0172A7B568A9C38557dCD7C31Db9cb78e0f31B |
> | Blockscout | verifier explorer testnet sedang rusak (backend v10.2.6, daftar compiler kosong → *"Unable to verify"*). Jalankan ulang `pnpm verify:testnet` nanti; tidak ada langkah lain. |
>
> **Uji console v2 (8 Nov, 23:22–23:26 WIB): 8/8 ✅** — set trading account, alur 7 langkah (D menerima tepat 9,602 USDG;
> C menerima 0,2 + 0,198), serta penolakan BelowMinimum, DepositTooLarge, NotOperator, InsufficientLiquidity ✅.
> Sisa: StaleNav (setelah 05:24 WIB 9 Nov). Bukti: `docs/rehearsals/46630-manual-vault-v2-2026-11-08.json`.
>
> Vault v1 `0xe3B2…bc2d` sudah tidak dipakai (manifest-nya diarsip di `deployments/46630-v1.json`).
> `pnpm verify:*` sekarang memverifikasi ke Sourcify dulu, lalu Blockscout.

1. `git pull`, lalu dengan VPN menyala: `pnpm preflight:testnet` → `pnpm deploy:testnet` → `pnpm verify:testnet`.
2. Catat alamat vault v2 baru dari `deployments/46630.json`, lalu ganti `NEXT_PUBLIC_COVAR_VAULT_ADDRESS` dan `OPERATOR_VAULT_ADDRESS` (alamat lama v1 jangan dipakai lagi).
3. Buka `/chain/console` dengan wallet **A**: pastikan kartu **Caps** menampilkan 1.000 / 100 USDG, lalu **Set trading account** = alamat yang menerima dana untuk venue (untuk testnet: wallet B).
4. `Allocate to venue` di console = memindahkan kas bebas vault ke trading account (operator juga bisa melakukannya otomatis, `OPERATOR_AUTO_ALLOCATE`).
5. Ulangi tabel 5.7 (kali ini fee withdrawal dipotong saat settle, jadi D menerima ±9,602 USDG dari 9,8 share).
6. Uji tambahan v2: deposit 101 USDG harus ditolak `DepositTooLarge`; deposit saat NAV lebih dari 6 jam harus ditolak `StaleNav`; `Allocate` lebih dari kas bebas harus ditolak `InsufficientLiquidity`.

## Fase 6 — Deploy infrastruktur staging (testnet) 🤝

### 6.1 Database (Neon)
1. Buat project Neon dan salin *connection string* (pooled) serta *direct*.
2. **Tidak perlu** mengubah `prisma/schema.prisma`: skema Postgres diturunkan otomatis ke `prisma/postgres/` (paket 3.5).
3. Dari laptop (PowerShell), dengan connection string *direct*:
   ```powershell
   $env:DATABASE_URL="<direct connection string>"; pnpm db:pg:generate; pnpm db:pg:deploy
   ```
4. Di Vercel, perintah build menjadi `pnpm db:pg:generate && pnpm build` supaya client Prisma yang dipakai adalah versi Postgres.

### 6.2a Indexer saja (staging minimal untuk web)
Kalau execution plane belum perlu, cukup host indexer agar `/treasury`, Discover dan halaman vault di Vercel punya data:
1. Railway → New Project → Deploy from GitHub repo (repo Covar). Settings → **Start Command** `pnpm indexer`.
2. Variables: `INDEXER_VAULT_ADDRESS` (vault v2), `INDEXER_CHAIN=testnet`, `INDEXER_RPC_URL=https://rpc.testnet.chain.robinhood.com`, `INDEXER_START_BLOCK=150482951`. Port otomatis memakai `PORT` dari Railway.
3. Settings → Networking → **Generate Domain**. Cek `https://<domain>/health` harus `ok: true` dan `behind` mendekati 0.
4. Tanpa volume, restart akan memindai ulang dari `INDEXER_START_BLOCK` (±1 menit dengan RPC publik). Hasilnya sama karena semua data dibaca ulang dari chain.
5. Isi `INDEXER_URL=https://<domain>` di Vercel.

### 6.2 Execution plane (Railway/Fly/VPS)
1. Buat service dari repo yang sama dengan perintah start `pnpm services`. Kalau alamat vault di-set, perintah ini sekaligus menyalakan **operator** (:4014), **indexer** (:4016), dan **monitor** (:4015) selain execution/risk/signer/venue.
2. Pasang **persistent volume** di `COVAR_STATE_DIR` (default `.covar-state/`). Isinya journal audit untuk rekonsiliasi setelah restart, jadi jangan sampai hilang.
3. Ekspos publik **hanya** port execution (4010) dan indexer (4016, hanya-baca) bila web berada di host lain. Risk, signer, venue, operator, dan monitor tetap internal.
4. Env server (diisi di dashboard host, bukan di repo):

| Key | Nilai |
|---|---|
| `TRADING_SIGNER_PRIVATE_KEY` | key wallet B |
| `VENUE_ADAPTER` | `paper` → `live` setelah paket 3.4 lolos review |
| `LIGHTER_*` (dari paket 3.4) | URL API, account index, API key index, API private key |
| `RPC_URL` | Alchemy testnet |
| `OPERATOR_VAULT_ADDRESS` | alamat vault v2 (indexer memakai alamat ini juga) |
| `OPERATOR_PRIVATE_KEY` | key wallet B (operator) |
| `OPERATOR_CHAIN` | `testnet` |
| `OPERATOR_MODE` | `dry-run` dulu (hanya log rencana) → `live` setelah log-nya masuk akal |
| `OPERATOR_VENUE` / `OPERATOR_CLOSE` | `lighter` / `execution` (atau `manual` selama uji) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | dari @BotFather dan chat tujuan alert |
| `COVAR_STATE_DIR` | path volume |
| `RISK_START_EQUITY` dll. | default kecuali ada keputusan lain |

### 6.3 Web (Vercel)
1. Import repo dengan framework Next.js. **Build Command** di Settings → Build & Deployment harus diubah menjadi `pnpm db:pg:generate && pnpm build`. Postinstall hanya men-generate client SQLite, dan client itu menolak `DATABASE_URL` Postgres (error P1012).
2. Isi Environment Variables:

| Key | Nilai staging (testnet) |
|---|---|
| `NEXT_PUBLIC_APP_NAME` | `Covar` |
| `NEXT_PUBLIC_APP_ENV` | `testnet` |
| `NEXT_PUBLIC_CHAIN_ENV` | `testnet` |
| `NEXT_PUBLIC_RH_TESTNET_CHAIN_ID` | `46630` |
| `NEXT_PUBLIC_RH_TESTNET_RPC_URL` | URL RPC (publik atau Alchemy; ingat, nilai `NEXT_PUBLIC_` terlihat di browser) |
| `NEXT_PUBLIC_COVAR_VAULT_ADDRESS` | alamat vault testnet |
| `NEXT_PUBLIC_WALLET_PROVIDER` | `evm` |
| `DATABASE_URL` | Neon pooled |
| `DIRECT_URL` | Neon direct |
| `AI_PROVIDER` / `AI_PROVIDER_API_KEY` / `AI_MODEL` | `orbio` / `sk-orbio-…` / opsional |
| `APP_ORIGIN` | `https://testnet.covar.xyz` (domain staging; SIWE terikat ke origin ini) |
| `INDEXER_URL` | URL indexer (6.2), dibaca server saja |
| `CREDITS_MODE` / `CREDITS_TREASURY_ADDRESS` | `enforce` / alamat penerima top-up (mis. wallet C) |
| `AI_PRICE_IN_PER_MTOK` / `AI_PRICE_OUT_PER_MTOK` / `AI_APP_FEE_PCT` | harga model dari price list provider / fee aplikasi |
| `EXEC_URL` | URL publik service execution (6.2) |

3. Hubungkan domain staging (mis. `testnet.covar.xyz`) di Vercel → Domains, lalu set DNS sesuai instruksi Vercel.
4. Smoke test: semua halaman terbuka, `/chain` menampilkan **On-chain · 46630** (bukan "Simulated"), dan `/execution` terhubung ke services.

---

## Fase 7 — Uji penerimaan di testnet (brief §15) 🤝

Setiap poin harus punya **bukti**: tx hash, screenshot, atau log, yang disimpan ke `docs/rehearsals/46630-*.json`.

**Fungsional**
- [ ] Creator: buat strategi via chat → review diff → edit → backtest → start/stop practice
- [ ] Practice, test-money (Lighter testnet), dan vault on-chain **tidak pernah** berbagi saldo atau label
- [ ] Order test bounded dan idempotent: matikan service di tengah order, restart, pastikan tidak ada order ganda dan rekonsiliasi cocok
- [ ] Lighter RH testnet: karena testnet Lighter **bukan** chain 46630, danai akun Lighter RH testnet secara terpisah (cara mendapat USDG uji Lighter RH perlu dikonfirmasi ke tim Lighter), jalankan adapter `live` dengan `LIGHTER_NETWORK=rh-testnet`, dan uji order + NAV dari equity akun itu. Alur dana vault → Lighter → vault baru bisa diuji penuh di mainnet 4663 dengan nilai kecil
- [ ] Kredit Copilot: top-up USDG kecil → saldo bertambah sekali; panggilan Copilot memotong sesuai token; saldo habis → parser aturan gratis dengan pesan jelas
- [ ] Copilot: tetap dalam izinnya. Uji output invalid, kredit habis, dan provider error, lalu pastikan fallback berjalan dan risk tetap aktif
- [ ] Creator publish versi baru → notice investor 48 jam → posisi ditangani sesuai aturan
- [ ] Investor (wallet D): approve → deposit → share bernilai benar → request withdrawal → posisi ditutup → settle → **claim jumlah yang benar**
- [ ] Fee trading, alokasi creator/platform (80/20), dan biaya AI cocok dengan aktivitas sebenarnya (rekonsiliasi)
- [ ] **Darurat:** pause deposit + close-only, lalu pastikan withdrawal dan claim **tetap** berfungsi. NAV basi harus membuat deposit ditolak
- [ ] Discover, record, dan treasury menampilkan data nyata dengan link transaksi explorer (vault bertanda **on-chain**; fee di treasury = saldo USDG yang diterima wallet C dari vault)
- [ ] Token/staking: implemented **atau** tercatat pending (sesuai keputusan 0.8)

**Kasus gagal yang wajib dicoba:** RPC putus, venue menolak order, NAV melampaui batas deviasi,
deposit melebihi cap (3.1), saldo gas operator habis, dan restart semua service sekaligus.

**Soak:** jalankan staging **minimal 7 hari** dengan agen practice dan test-money aktif, tanpa intervensi manual.

**Visual:** token cobalt `#3B5BDB`/`#2F49B5`, P&L hijau/merah, keyboard dan focus, reduced motion, serta tampilan desktop dan mobile.
Semua ini sudah ✅ dan cukup dicek ulang.

---

## Fase 8 — Keamanan & handover 🤝

1. Review internal kontrak dan layanan signer/operator. **Audit eksternal sangat disarankan** sebelum dana publik masuk; brief §13 menyatakan belum ada audit independen.
2. Dokumentasikan **risiko single-key** sebagai risiko yang diterima secara sadar (keputusan 0.9), di `docs/SECURITY.md`.
3. Siapkan runbook insiden: key operator bocor (owner → `setOperator`), venue down, NAV macet, dan RPC diblokir.
4. Lengkapi dokumen handover §15: deployment manifest, hasil test, parity register, konfigurasi operator, laporan rekonsiliasi, dan daftar keputusan yang belum final.
5. Serahkan rahasia **hanya** lewat password manager bersama, tidak pernah lewat chat atau repo.

---

## Fase 9 — MAINNET 4663, nilai kecil dulu 🤝

Prasyarat: Fase 7 dan 8 lolos penuh.

1. Siapkan ETH mainnet: bridge sedikit ETH ke Robinhood Chain untuk **wallet A** (gas deploy) dan **wallet B** (gas NAV/settle).
2. Verifikasi ulang alamat USDG mainnet di `https://docs.robinhood.com/chain/contracts/` (saat ini `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 desimal).
3. Isi `.env` laptop: wallet **A yang sama** (brief §4), `RH_MAINNET_RPC=<Alchemy mainnet>`, kosongkan `USDG_ADDRESS` (default mainnet) atau isi alamat yang sudah diverifikasi, lalu `CONFIRM_MAINNET=yes`.
4. Jalankan dengan VPN menyala:
   ```bash
   pnpm preflight:mainnet
   pnpm deploy:mainnet
   ```
5. Verifikasi source: `pnpm verify:mainnet`, set **cap kecil** (keputusan 0.4), lalu commit `deployments/4663.json`.
6. Hapus `DEPLOYER_KEY` dan `CONFIRM_MAINNET` dari `.env`.
7. Buat **environment production terpisah** di Vercel dan host services: `NEXT_PUBLIC_APP_ENV=mainnet`, `NEXT_PUBLIC_CHAIN_ENV=mainnet`, `NEXT_PUBLIC_RH_MAINNET_RPC_URL`, vault mainnet, Lighter **mainnet** (akun dan API key baru), serta database production terpisah dari staging.
8. Arahkan domain utama ke production. Staging tetap hidup di subdomain testnet.
9. Uji pertama dengan dana tim sendiri: deposit kecil → trade → withdraw → claim, sebelum dibuka ke publik.

---

## Fase 10 — Operasional & scale 👤🛠

- Rekonsiliasi harian: saldo vault vs venue vs ledger, serta fee vs aktivitas.
- Pantau alert (paket 3.10): NAV basi, gas operator, dan service down.
- Naikkan cap bertahap hanya setelah periode stabil (mis. 2–4 minggu tanpa insiden), dan catat setiap perubahan cap.
- Fitur pembeda dan perubahan model bisnis dibahas **setelah** parity selesai (brief §16).

---

## Lampiran — Daftar env lengkap per tempat

| Key | Laptop `.env` (deploy) | Server services | Vercel | Rahasia? |
|---|---|---|---|---|
| `DEPLOYER_KEY` | ✅ sementara | ❌ | ❌ | 🔴 sangat |
| `OPERATOR_ADDRESS` | ✅ | — | — | tidak |
| `FEE_RECIPIENT_ADDRESS` | ✅ | — | — | tidak |
| `USDG_ADDRESS` | ✅ | — | — | tidak |
| `RH_TESTNET_RPC` / `RH_MAINNET_RPC` | ✅ | — | — | URL Alchemy = semi-rahasia |
| `CONFIRM_MAINNET` | ✅ hanya saat deploy mainnet | — | — | tidak |
| `TRADING_SIGNER_PRIVATE_KEY` | ❌ | ✅ | ❌ | 🔴 |
| `LIGHTER_*` | ❌ | ✅ | ❌ | 🔴 |
| `VENUE_ADAPTER`, `COVAR_STATE_DIR`, `RPC_URL`, `INDEXER_VAULT_ADDRESS` | — | ✅ | — | tidak |
| `OPERATOR_PRIVATE_KEY` | ❌ | ✅ | ❌ | 🔴 |
| `OPERATOR_*` (selain key), `MONITOR_*`, `INDEXER_*` | — | ✅ | — | tidak |
| `TELEGRAM_BOT_TOKEN` | — | ✅ | — | 🔴 |
| `APP_ORIGIN`, `SESSION_*`, `INDEXER_URL`, `CREDITS_*`, `AI_PRICE_*`, `AI_APP_FEE_PCT` | — | — | ✅ | tidak |
| `DATABASE_URL`, `DIRECT_URL` | lokal: SQLite | — | ✅ | 🔴 |
| `AI_PROVIDER_API_KEY` | opsional | — | ✅ | 🔴 |
| `EXEC_URL` | — | — | ✅ | tidak |
| `NEXT_PUBLIC_*` | — | — | ✅ | **publik** (terlihat di browser) |

---

## Lampiran B — Keputusan AI credits: Orbio vs provider LLM langsung

### Apa itu Orbio (dicek 7 Nov 2026)

- Gateway AI di Robinhood Chain: **satu API key untuk 447 model** (Claude, GPT, Gemini, DeepSeek, …),
  kompatibel dengan format OpenAI di `https://api.orbio.so/api/v1`. Katalog model dan harga publik di `/models`.
- Saldo dalam **CREDIT** (1 CREDIT = $1 pemakaian AI), dibeli langsung atau didapat dari staking `$ORBIO`.
  Model sering di bawah harga list.
- Ada **tools** (berita, post X, data on-chain) yang ditagih dari saldo yang sama. Ini yang dipakai
  Copilot referensi untuk riset.
- **Referensi (Sharpe) dibangun di atas Orbio:** "Connect Orbio once". Chat edit, riset, dan Copilot
  memakai saldo Orbio milik pengguna, sedangkan dana trading dan key tidak pernah menyentuh Orbio.

### Perbandingan

| Aspek | **Orbio** | **Provider langsung** (Anthropic/OpenAI) |
|---|---|---|
| Kesesuaian brief (parity) | ✅ sama dengan referensi (§7 "Orbio integration") | 🟡 diizinkan hanya sebagai "dependency kompatibel yang disepakati" |
| Pilihan model | 447 model, ganti cukup lewat `AI_MODEL` | Model dari satu vendor |
| Biaya | Sering di bawah harga list, bayar CREDIT | Harga list, kartu kredit |
| Tools riset (news/X/on-chain) | ✅ tersedia | ❌ harus dibangun/berlangganan terpisah |
| Pengguna bayar AI sendiri | ✅ model "Connect Orbio" (saldo pengguna) | ❌ Covar harus menjual kredit dan menanggung biaya |
| Keandalan / ketergantungan | 🟡 bergantung infrastruktur Orbio dan provider di belakangnya; proyek muda | ✅ vendor besar, ada SLA enterprise |
| Lock-in | Rendah, karena format OpenAI (pindah = ganti env) | Rendah |

### Rekomendasi: **Orbio sebagai provider utama**, dengan 2 pengaman

1. **Tahap 1 (sekarang, sudah didukung kode):** Covar memakai **satu key Orbio milik platform**.
   Pemakaian per pengguna dicatat di ledger kredit Covar (paket 3.7).
2. **Tahap 2 (parity penuh):** alur **"Connect Orbio" per pengguna**, sehingga pengguna memakai saldonya sendiri.
   ⚠️ Alur koneksi akun untuk aplikasi pihak ketiga **belum terdokumentasi publik**. Docs Orbio hanya
   menyebut koneksi tools dilakukan pemilik akun di dashboard. 👤 **Hubungi tim Orbio** untuk akses
   partner/OAuth sebelum tahap ini dikerjakan.
3. **Pengaman:** kalau Orbio error atau saldo habis (HTTP 402), Copilot otomatis jatuh ke parser aturan
   dengan label jelas, dan risk engine tetap berjalan (brief §9: kredit habis tidak boleh mematikan kontrol risiko).
   Untuk cadangan, key Anthropic/OpenAI bisa disiapkan dan cukup ditukar lewat env.

### Cara mengaktifkan Orbio 👤

1. Buka `https://www.orbio.so` → login (wallet via Privy) → isi saldo CREDIT (mulai kecil, misalnya $10–20).
2. Dashboard → **API keys** → buat key (`sk-orbio-…`). Simpan di password manager.
3. Isi di `.env` lokal **dan** Vercel → Environment Variables:
   ```env
   AI_PROVIDER=orbio
   AI_PROVIDER_API_KEY=sk-orbio-...
   AI_MODEL=anthropic/claude-haiku-4.5   # opsional; murah dan cukup untuk interpretasi strategi
   ```
4. Restart `pnpm dev` (atau redeploy Vercel), buka **Studio → New agent**, lalu tulis ide strategi.
   Label jawaban harus **`Orbio · anthropic/claude-haiku-4.5`**, bukan `rules parser`.
   Kalau tertulis `rules-fallback (HTTP 401)` berarti key salah, dan `HTTP 402` berarti saldo habis.
