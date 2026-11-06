# Panduan Tes Covar — langkah demi langkah

Dokumen ini memandu Anda mengetes **semua** yang sudah dibangun: lewat UI, lewat kode
(unit/service/contract), lewat browser end-to-end, dan lewat rehearsal chain lokal dengan
transaksi sungguhan (di EVM lokal — bukan uang asli). Di akhir: checklist input yang Anda
perlukan untuk testnet.

> Prinsip yang dipegang proyek ini: setiap hal yang disimulasikan **harus tertulis
> "simulated" di layar**. Kalau Anda menemukan angka tanpa label asal-usulnya, itu bug —
> laporkan.

---

## 0. Persiapan (sekali saja)

Repo ini hidup di [github.com/wealthy-org/Covar](https://github.com/wealthy-org/Covar) (`main`).
Untuk mesin baru (Windows/PowerShell juga OK):

```powershell
git clone https://github.com/wealthy-org/Covar.git
cd Covar
pnpm install            # postinstall otomatis: membuat .env dari contoh + prisma generate
pnpm dev                # atau pnpm test — tidak perlu edit apa pun dulu
```

> `postinstall` hanya membuat `.env` **kalau belum ada** (`.env`/`.env.local` yang sudah ada
> tidak pernah ditimpa). Nilai rahasia (key, URL produksi) selalu diisi manual pada `.env`,
> **bukan** dengan menempelkannya ke `prisma/schema.prisma` — schema hanya berisi
> `env("DATABASE_URL")`.
>
> Kalau folder berisi sisa codebase lama (mis. scaffold Milestone-B lama dengan `src/features/`,
> `generated/`, atau Prisma 7), jangan dicampur: gunakan clone/checkout repo yang bersih.
> In-place: `git fetch origin && git reset --hard origin/main` (hanya untuk untracked, `git clean -fd`
> setelah backup file lokal Anda; **jangan** pakai `-x` supaya `.env` tidak ikut terhapus).

| Kebutuhan | Versi |
|---|---|
| Node.js | ≥ 20 |
| OS | Linux / macOS / Windows (WSL2 — atau PowerShell native, perintah di atas aman) |
| RAM kosong | ±1 GB |

> Corepack bawaan Node 20 otomatis memakai **pnpm 10.0.0** (dipin di `packageManager`).
> Kalau pnpm belum aktif: `corepack pnpm install`. npm tetap bisa, tapi pnpm canonical —
> lockfile-nya `pnpm-lock.yaml`.

CI (`.github/workflows/ci.yml`) berjalan di setiap push/PR: typecheck → suite → build → E2E → rehearsal.

Tanpa env var apa pun app sudah bisa jalan penuh dalam mode review (data sesi lokal).

---

## A. Tes lewat UI (jalan fungsional utama)

```bash
pnpm dev               # http://localhost:3000
```

Alur yang disarankan, lengkap dari atas ke bawah:

1. **Landing `/`** — hero, "how it works", FAQ; strip di paling atas tertulis
   `not deployed yet` — itu benar, bukan error.
2. **Wallet gate `/studio`** — sebelum connect, Studio tertutup kartu "Welcome".
   Klik **Connect wallet** → session wallet (tertulis jelas: membuktikan apa).
   Alternatif wallet sungguhan: set `NEXT_PUBLIC_WALLET_PROVIDER=evm` (MetaMask dsb.)
   lalu restart dev server — akses akun saja, **tidak ada tanda tangan**.
3. **Builder `/studio?new=1`** — ketik misalnya:
   `Long SOL breakouts on the 1h. Stop 1.5x ATR, only take 2R or better.` → **Send**.
   - Draf rule set muncul; pesan menyebut mesin yang menjawab (*Interpreted by: …*).
   - Tanpa `ANTHROPIC_API_KEY` tertulis `rules parser`. Dengan key: model mengusulkan
     interpretasi, mesin deterministik yang meng-encode (model tidak bisa menulis rule
     langsung, apalagi mengeksekusi order).
   - Tab **Rules** (editor visual) dan **Code** bisa diedit; invalid = publish ditolak.
   - Klik **Run backtest** → hasil vs benchmark, cost assumption, daftar trade, seed.
4. **Practice `/studio`** — **Start practice** pada agent. Perhatikan kolom P&L:
   tertulis `live $…(Hyperliquid perp mids)` bila feed hidup, atau `simulated` bila
   feed sedang tidak terjangkau. Tidak pernah campur.
5. **Notifikasi 🔔 / `/notifications`** — start/stop practice, publish, deposit,
   withdrawal menulis entri ke inbox. Inbox kosong = belum ada kejadian, itu normal.
6. **Portfolio `/portfolio`** — deposit ke vault live (ledger **simulated**, kolom
   referensi tx tertulis `simulated`, bukan hash palsu) → **request withdrawal** →
   tunggu state `claimable` → **claim**. Empat langkah terpisah: request ≠ claim.
7. **`/economics` + `/treasury`** — fee 1% + 0.10 USDG, ≤20% profit trade menang,
   split 80/20; token/staking tertulis belum diimplementasi (disengaja).
8. **`/chain`, `/execution`, `/docs`** — status jaringan, pesawat eksekusi 5 layanan,
   dan dokumentasi.

---

## B2. Penyimpanan durabel (Prisma + SQLite)

State web (draft, practice runs, ledger, notifikasi) tetap hidup lewat localStorage, **dan**
dimirror ke database setiap kali ada perubahan — jadi state bertahan walau localStorage
dibersihkan atau Anda ganti browser:

```bash
pnpm exec prisma migrate deploy     # siapkan schema (otomatis di CI)
curl localhost:3000/api/state       # → {"ok":true,"db":"prisma-sqlite","simulated":true,…}
```

Tabel nyata yang bisa Anda query: `SessionState`, `Notification`, `LedgerEntry`,
`PracticeRun`, `StrategyVersion`. `pnpm exec prisma studio` membuka GUI-nya. Default dev
`prisma/dev.db` (tidak di-commit); Postgres tinggal ganti `DATABASE_URL`. Services
eksekusi **sengaja tidak** pakai DB ini — journal per-proses mereka adalah audit trail
order yang authoritative.

## B. Tes by code (tanpa browser)

```bash
pnpm test                # engine & rule set        → 25 lolos
pnpm test:integration    # eksekusi/risk/signer      → 39 lolos (alias: pnpm test:services)
pnpm test:contracts      # CovarVault + MockUSDG    → 18 lolos
pnpm exec playwright install chromium   # sekali saja
pnpm test:e2e            # browser end-to-end       → 10 lolos
pnpm typecheck           # tsc bersih
pnpm lint                # eslint (next/core-web-vitals + next/typescript) bersih
pnpm db:validate / db:generate / db:migrate   # prisma (schema → client → migrasi)
```

Atau semuanya sekaligus: `pnpm test:all`.

---

## C. Tes end-to-end di chain lokal (transaksi sungguhan, koin simulasi)

Ini bukti paling berat: deposit→trade→withdraw dengan tx asli di EVM lokal, index
event-nya dibaca dari log chain, dan ada crash proses sungguhan di tengah.

```bash
# terminal 1 — node EVM lokal
pnpm exec hardhat node

# terminal 2 — rehearsal penuh (19 check)
pnpm rehearse:e2e
```

Yang dibuktikan (otomatis): deposit mint share → indexer melaporkan event `Deposit`
dari log chain → operator pause → intent **ditahan**, vault tidak bergerak sama sekali
(tanpa posisi venue, tanpa perubahan NAV) → resume → tepat satu fill → withdraw
4 langkah, semua event ter-index → eksekusi **dibunuh paksa (exit 137)** setelah venue
meng-ACK → recovery mengadopsi order tanpa duplikat. Laporan per-run:
`docs/rehearsals/e2e-<tanggal>.json`.

Opsional, agar UI `/chain` membaca kontrak lokal ini:

```bash
pnpm deploy:local
NEXT_PUBLIC_COVAR_VAULT_ADDRESS=0xe7f1… NEXT_PUBLIC_RH_CHAIN_ID=31337 pnpm dev
```

---

## D. Testnet (46630) — tahap berikutnya, butuh 4 input dari Anda

Kode testnet sudah siap; yang menunggu adalah input operasional:

| # | Input | Kenapa |
|---|---|---|
| 1 | `DEPLOYER_KEY` berisi gas testnet | Faucet diblokir dari sandbox (429/captcha) — butuh wallet Anda |
| 2 | `OPERATOR_ADDRESS` + `FEE_RECIPIENT_ADDRESS` (2 wallet **terpisah**) | Script menolak bila sama; kunci KITA independen dari Sharpe |
| 3 | Alamat USDG testnet terkonfirmasi | Ada kandidat impostor; alternatif aman: deploy MockUSDG di testnet dulu sebagai kolateral uji |
| 4 | Adapter venue live | Masih sengaja ditolak (`VENUE_ADAPTER=live` gagal boot) sampai ditulis & direview |

Lalu jalankan:

```bash
pnpm preflight:testnet   # memeriksa chain, saldo, token, konfigurasi — gagal = berhenti jujur
pnpm deploy:testnet      # deploy vault ke 46630
# pasang NEXT_PUBLIC_COVAR_VAULT_ADDRESS=<alamat hasil deploy>, restart dev, ulangi
# rehearsal (deposit → trade → withdraw) memakai koin uji testnet
```

Mainnet (4663) memakai **script yang sama persis**, bedanya aset USDG asli + gerbang
`CONFIRM_MAINNET=yes`. Sesuai arahan: tidak perlu dipikir berat dulu.

> **Jangan pernah paste private key ke chat atau file repo.** Masukkan lewat environment
> variable saat menjalankan: `DEPLOYER_KEY=… pnpm deploy:testnet`. Jika RPC Anda
> ke-blokir ISP (ISP Indonesia kadang memblok), pakai VPN dulu sebelum menganggap
> endpoint gagal.

---

## E. Daftar port (kalau ada yang bentrok)

| Port | Layanan |
|---|---|
| 3000 | web app |
| 4010–4013 | execution, venue (paper), risk, signer |
| 4014 | vault indexer |
| 4310–4314 | ring rehearsal (otomatis, dibuat dan dihapus script) |
| 8545 | hardhat node (EVM lokal) |

## F. Kalau tes gagal

- `pnpm install` error peer dep → seharusnya tidak terjadi (`.npmrc` proyek sudah `auto-install-peers=true`); kalau iya, laporkan.
- Port sudah dipakai → matikan proses lama atau ganti lewat env (`EXEC_PORT`, dst.).
- Harga/API eksternal tidak terjangkau → app otomatis berlabel `simulated`/`unavailable`;
  itu perilaku benar, bukan crash.
- RPC Robinhood `400/403` → coba VPN (ISP block), baru selidiki endpoint.
