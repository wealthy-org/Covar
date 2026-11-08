# Covar — Runbook Go-Live (dari kondisi sekarang → deployment resmi)

**Disusun:** 7 Nov 2026 · **Acuan:** `COVAR_ROBINHOOD_DEV_BRIEF.md` (2 Nov 2026) · repo `wealthy-org/Covar`

Dokumen ini adalah **urutan kerja lengkap** supaya semua fitur brief aktif dan Covar siap deployment
resmi. Setiap langkah diberi penanggung jawab:

- **👤 ANDA**: akun, wallet, uang, keputusan owner, dan rahasia (hanya Anda yang boleh memegangnya)
- **🛠 DEV**: pekerjaan kode (bisa saya kerjakan setelah Anda memberi input yang disebut)
- **🤝 BERSAMA**: Anda menjalankan perintah atau memberi akses, dev memverifikasi

> **Jujur dulu:** saat ini web, builder, backtest, practice, risk engine, dan kontrak vault sudah
> jalan dan teruji **di lokal**. Namun mengisi env saja **tidak** membuat semuanya "100% live".
> Masih ada 9 paket kode (Fase 3) yang harus dibangun lalu diuji di testnet sebelum mainnet.
> Brief §14 dan §15 melarang mengklaim platform live hanya karena UI-nya berfungsi.

---

## Ringkasan urutan

```
Fase 0  Keputusan owner                    👤      (½–1 hari)
Fase 1  Buat akun & layanan                👤      (1 hari)
Fase 2  Siapkan wallet                     👤      (1–2 jam)
Fase 3  Bangun 9 paket kode yang kurang    🛠      (bertahap, lihat estimasi)
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
| 0.5 | **Venue trading** | Lighter (sesuai brief §8). Pilih **zkLighter** (venue utama Lighter) **atau** deployment Lighter di Robinhood Chain (`api.rh-testnet.lighter.xyz` / `api.rh.lighter.xyz`, sumber pihak ketiga dan **harus dikonfirmasi** ke tim Lighter) | paket 3.4 |
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

| # | Paket | Kenapa wajib (brief) | Kondisi sekarang | Input Anda |
|---|---|---|---|---|
| 3.1 | **Kontrak: batas TVL & batas deposit** (`maxTotalAssets`, `maxDeposit`, hanya bisa diubah owner) + test | §4: mainnet dimulai dengan "small controlled value", dan ini harus ditegakkan kontrak, bukan janji | Belum ada batas | Angka 0.4 |
| 3.2 | **Transaksi wallet di web**: approve USDG → `deposit`, `requestWithdrawal`, `claim` dari wallet pengguna, termasuk tampilan fee, network, dan status pending sebelum tanda tangan | §6 Investor, §15 "investor deposits… claims" | Web hanya **membaca** chain. Wallet masih "session" untuk pengembangan | Keputusan 0.7 (+ Privy App ID bila dipilih) |
| 3.3 | **Layanan operator**: menandatangani `reportNav` berkala dari equity venue, serta `markPositionsClosed` → `settleWithdrawal` | §10: share tidak boleh di-mint dari NAV basi, withdrawal dilacak sampai claim | Alur ini baru ada di script rehearsal lokal. `TRADING_SIGNER_PRIVATE_KEY` belum dipakai layanan mana pun | Wallet B |
| 3.4 | **Adapter venue live: Lighter** (testnet → mainnet), lewat seam `services/shared/venue-adapters.ts` | §7 Test-money & Live trading, §8 Market service | Venue masih *paper*. `VENUE_ADAPTER=live` sengaja menolak boot | Keputusan 0.5, akun Lighter testnet, API key Lighter (diisi di server, bukan chat) |
| 3.5 | **Database multi-user + login SIWE** (Sign-In with Ethereum), migrasi ke Postgres | §8 Application storage. Saat ini `SessionState` hanya satu baris "local" (mode review satu operator) | Belum multi-user | `DATABASE_URL` Neon |
| 3.6 | **Discovery, record, dan treasury dari data on-chain** (indexer → ranking/riwayat/treasury, plus confirmation policy dan penanganan reorg) | §11, §15 "real data with provenance and actual transaction links" | Indexer sudah decode event, tetapi halaman masih memakai data seed berlabel | RPC Alchemy |
| 3.7 | **AI credits nyata**: estimasi → reservasi → rekonsiliasi pemakaian dari data `usage` gateway, top-up berbayar, lalu "Connect Orbio" per pengguna | §7 AI credits, §9 | ✅ Copilot sudah bisa memanggil Orbio/Anthropic/OpenAI (`AI_PROVIDER`). Ledger kredit masih simulasi | Keputusan 0.6 + API key |
| 3.8 | **Script testnet**: `rehearse:testnet` (deposit → trade → withdraw → claim + kasus gagal, memakai USDG asli testnet) dan deploy dengan hardware wallet (opsional). ✅ Verifikasi Blockscout sudah ada: `pnpm verify:testnet` / `verify:mainnet` | §4 langkah 2–3 | `rehearse:e2e` hanya untuk chain lokal 31337 | — |
| 3.9 | **Token / staking / buyback** | §7 Token features, §15 | Berlabel *not deployed* | Keputusan 0.8 (saran: tetap pending) |
| 3.10 | **Monitoring & alert operator** (health, NAV basi, saldo gas operator, gagal rekonsiliasi), dikirim ke Telegram/Slack/email | §6 Operator, §15 handover | Baru ada `/health` per layanan | Channel alert pilihan Anda |

Estimasi kasar (dikerjakan berurutan, termasuk test): 3.1 ±1 hari · 3.2 ±2–3 hari · 3.3 ±2 hari ·
3.4 ±4–7 hari (paling tidak pasti, karena bergantung dokumentasi dan akses Lighter) · 3.5 ±2–3 hari ·
3.6 ±2–3 hari · 3.7 ±2 hari · 3.8 ±1–2 hari · 3.10 ±1 hari.

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
pnpm test:services           # integrasi 39 (+ cross-process 20)
pnpm test:contracts          # kontrak 18 (+ test paket 3.1)
pnpm exec playwright install chromium && pnpm test:e2e   # E2E 10
pnpm build

# Rehearsal chain lokal (2 terminal)
pnpm exec hardhat node --hostname 0.0.0.0 --port 8545
pnpm rehearse:e2e            # 19 check: deposit→pause→resume→withdraw, crash recovery
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
| Catatan | Deploy **percobaan** — belum ada batas TVL/deposit (paket 3.1). Deploy ulang setelah 3.1 untuk uji penerimaan resmi. |

### 5.7 Uji alur vault lewat **Vault console** (`/chain/console`)

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

## Fase 6 — Deploy infrastruktur staging (testnet) 🤝

### 6.1 Database (Neon)
1. Buat project Neon dan salin *connection string* (pooled) serta *direct*.
2. Dev mengubah `prisma/schema.prisma` ke `provider = "postgresql"` (bagian dari paket 3.5).
3. Jalankan migrasi dari laptop: `DATABASE_URL=<direct> pnpm exec prisma migrate deploy`.

### 6.2 Execution plane (Railway/Fly/VPS)
1. Buat service dari repo yang sama dengan perintah start `pnpm services`. Jalankan indexer dan operator sebagai service terpisah (`pnpm indexer`, dan perintah operator dari paket 3.3).
2. Pasang **persistent volume** di `COVAR_STATE_DIR` (default `.covar-state/`). Isinya journal audit untuk rekonsiliasi setelah restart, jadi jangan sampai hilang.
3. Ekspos publik **hanya** port execution (4010). Risk, signer, venue, dan operator tetap internal.
4. Env server (diisi di dashboard host, bukan di repo):

| Key | Nilai |
|---|---|
| `TRADING_SIGNER_PRIVATE_KEY` | key wallet B |
| `VENUE_ADAPTER` | `paper` → `live` setelah paket 3.4 lolos review |
| `LIGHTER_*` (dari paket 3.4) | URL API, account index, API key index, API private key |
| `RPC_URL` | Alchemy testnet |
| `INDEXER_VAULT_ADDRESS` | alamat vault dari Fase 5 |
| `COVAR_STATE_DIR` | path volume |
| `RISK_START_EQUITY` dll. | default kecuali ada keputusan lain |

### 6.3 Web (Vercel)
1. Import repo dengan framework Next.js. Build default (`pnpm build`) sudah cukup, karena postinstall men-generate Prisma.
2. Isi Environment Variables:

| Key | Nilai staging (testnet) |
|---|---|
| `NEXT_PUBLIC_APP_NAME` | `Covar` |
| `NEXT_PUBLIC_APP_ENV` | `testnet` |
| `NEXT_PUBLIC_CHAIN_ENV` | `testnet` |
| `NEXT_PUBLIC_RH_TESTNET_CHAIN_ID` | `46630` |
| `NEXT_PUBLIC_RH_TESTNET_RPC_URL` | URL RPC (publik atau Alchemy; ingat, nilai `NEXT_PUBLIC_` terlihat di browser) |
| `NEXT_PUBLIC_COVAR_VAULT_ADDRESS` | alamat vault testnet |
| `NEXT_PUBLIC_WALLET_PROVIDER` | `evm` (atau `privy` setelah paket 3.2) |
| `DATABASE_URL` | Neon pooled |
| `DIRECT_URL` | Neon direct |
| `AI_PROVIDER` / `AI_PROVIDER_API_KEY` / `AI_MODEL` | `orbio` / `sk-orbio-…` / opsional |
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
- [ ] Copilot: tetap dalam izinnya. Uji output invalid, kredit habis, dan provider error, lalu pastikan fallback berjalan dan risk tetap aktif
- [ ] Creator publish versi baru → notice investor 48 jam → posisi ditangani sesuai aturan
- [ ] Investor (wallet D): approve → deposit → share bernilai benar → request withdrawal → posisi ditutup → settle → **claim jumlah yang benar**
- [ ] Fee trading, alokasi creator/platform (80/20), dan biaya AI cocok dengan aktivitas sebenarnya (rekonsiliasi)
- [ ] **Darurat:** pause deposit + close-only, lalu pastikan withdrawal dan claim **tetap** berfungsi. NAV basi harus membuat deposit ditolak
- [ ] Discover, record, dan treasury menampilkan data nyata dengan link transaksi explorer
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
