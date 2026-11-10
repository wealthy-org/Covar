# Covar — Peluncuran Mainnet (Robinhood Chain 4663)

Keputusan owner (10 Nov 2026):
- **covar.vercel.app dipindah ke mainnet.** Tidak ada lagi staging testnet.
- **Agen contoh disembunyikan.** Ini otomatis di mainnet lewat `IS_MAINNET` / `SHOW_EXAMPLES`.
- **Batas awal vault:** TVL 100 USDG · 25 USDG per deposit. Ini diset otomatis oleh `pnpm deploy:mainnet`.
- **Minimum deposit 1 USDG saat uji (sementara).** Owner ingin uji tanpa top-up lagi; saldo Rabby cuma 1.1149 USDG + 0.0005 ETH. Karena itu deploy memasang minimum 1 USDG. Setelah uji selesai, naikkan lagi ke 10 USDG di `/chain/console` → *Minimum deposit* (wallet A). Biayanya cuma gas (≈$0.002).
- **CLI klip 10:** dikerjakan setelah mainnet jalan.

Wallet yang dipakai sama seperti di testnet (brief §4):

| Peran | Alamat | Butuh di mainnet |
|---|---|---|
| A · owner / deployer | `0x1FBaDaFb2056Af662aa11732e86B28aF550af0d9` | **0.00015 ETH** dari Rabby (deploy ≈0.00005 + setLimits + setMinDeposit; wallet harus punya ≈2× biaya deploy di awal untuk cek maxFee) |
| B · operator | `0x3d2faC269954487a63f51bF059701fbD9647e3Bf` | **0.00022 ETH** dari Rabby (laporan NAV + settle; ≈0.00013 ETH/bulan dengan `OPERATOR_NAV_REFRESH_SEC=19800`, jadi cukup ±1.5 bulan) |
| C · treasury / fee recipient | `0x8b43AC0f705D18D2C42D12EB2fABe3e45e1045B1` | tidak perlu apa-apa (fee masuk ke sini, ini wallet Anda sendiri) |
| Rabby · investor uji | (alamat Rabby Anda) | sisa **≈0.00012 ETH** + **1.1149 USDG** (alur uji penuh ≈0.000008 ETH) |

Gas mainnet terukur 10 Nov: 0.0203 gwei. Deploy 2,461,863 gas ≈ 0.00005 ETH (≈$0.10). Approve ≈1.4e-6 ETH. Alur investor lengkap (approve, deposit, request, claim) ≈7e-6 ETH. Satu laporan NAV ≈1e-6 ETH.

USDG mainnet: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (Paxos, 6 desimal). Cek ulang di `https://docs.robinhood.com/chain/contracts/` sebelum deploy.

---

## Langkah 1 — Isi saldo (di dompet Anda)

1. Dari Rabby (Robinhood Chain), kirim **0.00015 ETH ke A** dan **0.00022 ETH ke B**. Sisanya (≈0.00012 ETH) tetap di Rabby untuk uji.
2. USDG jangan dipindah: 1.1149 USDG di Rabby cukup untuk uji 1 USDG + top-up credits 0.5 USDG.
3. Kabari saya. Saya cek saldonya dari sini (read-only).

## Langkah 2 — Deploy vault dari laptop (PowerShell)

```powershell
cd C:\path\ke\covar
git pull
pnpm install
```

Edit `.env` (key **hanya** di laptop, jangan pernah di Vercel/Railway/chat):

```
DEPLOYER_KEY=<private key wallet A>
OPERATOR_ADDRESS=0x3d2faC269954487a63f51bF059701fbD9647e3Bf
FEE_RECIPIENT_ADDRESS=0x8b43AC0f705D18D2C42D12EB2fABe3e45e1045B1
RH_MAINNET_RPC=https://rpc.mainnet.chain.robinhood.com
USDG_ADDRESS=
CONFIRM_MAINNET=yes
```

**Pastikan checkout terbaru dulu.** Dua deploy pertama (10 Nov, `0xe3B2eDD0…bc2d` dan `0x157981Bf…F877`) dijalankan dari kode lama. Kontraknya tidak punya `setMinDeposit` dan minimumnya terkunci di 10 USDG. Keduanya tidak dipakai. Tanpa NAV dari operator, deposit ke sana selalu ditolak (`StaleNav`), jadi aman dibiarkan. Cek sebelum deploy:

```powershell
git log -1 --oneline                                   # harus commit terbaru
Select-String -Path contracts\CovarVault.sol -Pattern setMinDeposit   # harus ada hasil
```

Deploy mengecek saldo gas sebelum mengirim apa pun. Max fee dipilih otomatis: setinggi yang muat di saldo (maksimal 1.5× base fee, minimal 1.1×), tanpa tip. Biaya nyata ≈0.00005 ETH. Dengan saldo A 0.0000597 ETH, max fee-nya ≈1.23× base: cukup, tapi mepet. Lebih aman kirim dulu **0.00003 ETH dari Rabby ke A** (Rabby cuma butuh ≈0.00001 untuk uji). Manifest lama otomatis disimpan sebagai `deployments\4663.superseded-<alamat>.json`.

Jalankan (VPN menyala kalau RPC diblokir ISP):

```powershell
pnpm preflight:mainnet
pnpm deploy:mainnet
```

Output yang diharapkan: alamat `vault`, lalu `setting launch limits: TVL 100 USDG · per deposit 25 USDG`,
`setting minimum deposit: 1 USDG`, lalu `limits TVL 100 · per deposit 25 · minimum 1 USDG`. Semua tercatat di `deployments\4663.json`. Catat **address** dan **blockNumber**-nya.

`pnpm verify:mainnet` memverifikasi kontrak baru ini dari awal (Blockscout, fallback ke Sourcify). Verifikasi testnet tidak terbawa, karena bytecode-nya sudah berubah (ada `setMinDeposit`). Hasil yang dicari: *exact match*.

```powershell
pnpm verify:mainnet
git add deployments/4663.json
git commit -m "Mainnet vault 4663"
git push origin main
```

Setelah itu **hapus `DEPLOYER_KEY` dan `CONFIRM_MAINNET` dari `.env`.**

**Hasil deploy (10 Nov 2026):** vault `0x9f0172A7B568A9C38557dCD7C31Db9cb78e0f31B`, blok `110941861`, tx `0xd8f3263d…d87e`. Limits 100 / 25, minimum 1 USDG. Sourcify: *exact_match*.

> ⚠️ **Alamatnya sama persis dengan vault v2 testnet.** Ini karena deployer (A) dan nonce-nya (4) sama di kedua chain. Jadi `NEXT_PUBLIC_COVAR_VAULT_ADDRESS` / `*_VAULT_ADDRESS` **tidak berubah nilainya**. Yang wajib berubah adalah *chain*-nya (`mainnet`), `INDEXER_START_BLOCK`, dan `COVAR_STATE_DIR=/data/mainnet` di kedua service Railway. Indexer sekarang juga mendeteksi checkpoint dari chain lain dan meng-index ulang sendiri, tapi journal operator tidak. Karena itu `/data/mainnet` tetap wajib.

## Langkah 3 — Database baru (Neon)

Kredit Copilot dari testnet **tidak boleh** ikut ke mainnet, karena saldo credits tidak dipisah per chain. Buat database baru yang bersih:

1. Neon → project yang sama → **Databases → New database** → nama `covar_mainnet` (owner `neondb_owner`).
2. Salin connection string-nya: versi *pooled* untuk `DATABASE_URL` dan versi *direct* untuk `DIRECT_URL` (tambahkan `?sslmode=require&connect_timeout=30`).
3. Migrasi dari laptop, pakai URL direct:

```powershell
$env:DATABASE_URL="<direct url covar_mainnet>"; $env:DIRECT_URL="<direct url covar_mainnet>"; pnpm db:pg:deploy
Remove-Item Env:DATABASE_URL; Remove-Item Env:DIRECT_URL
```

## Langkah 4 — Railway

**Service indexer** (`covar-production`):

| Key | Nilai |
|---|---|
| `INDEXER_CHAIN` | `mainnet` |
| `INDEXER_VAULT_ADDRESS` | `0x9f0172A7B568A9C38557dCD7C31Db9cb78e0f31B` |
| `INDEXER_START_BLOCK` | `110941861` ⚠️ wajib diganti; nilai testnet 150482951 lebih tinggi dari blok mainnet |
| `RH_MAINNET_RPC` | `https://rpc.mainnet.chain.robinhood.com` (atau Alchemy mainnet) |
| `COVAR_STATE_DIR` | `/data/mainnet` |

Kalau ada `OPERATOR_CHAIN` / `NEXT_PUBLIC_COVAR_VAULT_ADDRESS` lama di service ini, samakan nilainya atau hapus.

**Service ops** (`pnpm ops`):

| Key | Nilai |
|---|---|
| `OPERATOR_CHAIN` | `mainnet` |
| `OPERATOR_MAINNET_CONFIRM` | `yes` |
| `OPERATOR_VAULT_ADDRESS` | `0x9f0172A7B568A9C38557dCD7C31Db9cb78e0f31B` |
| `RH_MAINNET_RPC` | `https://rpc.mainnet.chain.robinhood.com` |
| `COVAR_STATE_DIR` | `/data/mainnet` (journal testnet tidak tercampur) |
| `OPERATOR_MODE` | `live` (tetap) |
| `OPERATOR_VENUE` | `none` (tetap: belum trading, uang tetap di vault) |
| `OPERATOR_NAV_REFRESH_SEC` | `19800` (baru: NAV tiap 5.5 jam, di bawah batas basi 6 jam; hemat gas B) |
| `OPERATOR_ADDRESS`, `OPERATOR_PRIVATE_KEY`, `MONITOR_TARGETS`, `TELEGRAM_*` | tetap |

Kalau ada `OPERATOR_RPC_URL` yang menunjuk ke testnet, hapus.

## Langkah 5 — Vercel (covar.vercel.app)

Ubah / tambah di *Production*:

| Key | Nilai |
|---|---|
| `NEXT_PUBLIC_CHAIN_ENV` | `mainnet` |
| `NEXT_PUBLIC_APP_ENV` | `mainnet` |
| `NEXT_PUBLIC_COVAR_VAULT_ADDRESS` | `0x9f0172A7B568A9C38557dCD7C31Db9cb78e0f31B` |
| `NEXT_PUBLIC_RH_MAINNET_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` (atau Alchemy mainnet) |
| `NEXT_PUBLIC_WALLET_PROVIDER` | `evm` |
| `DATABASE_URL` | pooled URL `covar_mainnet` + `&connect_timeout=15` |
| `DIRECT_URL` | direct URL `covar_mainnet` |
| `CREDITS_MODE` | `enforce` (tetap) |
| `CREDITS_TREASURY_ADDRESS` | C (tetap) |
| `CREDITS_MIN_TOPUP_USD` | `0.5` (baru, sementara: supaya uji credits muat di sisa USDG Rabby) |

**Hapus** kalau ada: `NEXT_PUBLIC_RH_CHAIN_ID`, `CREDITS_CHAIN_ID`, `CREDITS_USDG_ADDRESS`, `CREDITS_RPC_URL` (kalau menunjuk testnet) (default-nya sudah mainnet), dan `NEXT_PUBLIC_SHOW_EXAMPLES`.

Lalu **Redeploy tanpa build cache**, karena `NEXT_PUBLIC_*` ditanam saat build.

## Langkah 6 — Cek sebelum uji

- Strip atas di covar.vercel.app: alamat vault mainnet dan `ROBINHOOD CHAIN · 4663` dengan titik hijau.
- `/chain`: node *Connected*, chain 4663, vault *Live*, Source code *Verified (exact match)*, dan "At most 25 USDG per deposit and 100 USDG in total. Minimum 1 USDG."
- Operator memposting NAV pertama dalam ±1 menit setelah service ops jalan. Ini terlihat di `/chain` → *NAV confirmed on-chain*.
- `/explore`: hanya vault Covar. Arena dan Backtests kosong ("Nothing here yet").

## Langkah 7 — Uji coba dengan Rabby (1 USDG, tanpa top-up)

Urutannya penting: **vault dulu, credits sesudahnya.** Top-up credits mengirim USDG ke C, jadi kalau dikerjakan duluan, sisa Rabby tidak cukup untuk deposit 1 USDG.

| Langkah | Yang terjadi | Angka yang diharapkan | Saldo USDG Rabby |
|---|---|---|---|
| 0 · Awal | — | — | 1.1149 |
| 1 · Deposit 1 | Approve, lalu deposit | fee 0.11 (1% + 0.10) ke C → 0.89 USDG masuk, 0.89 shares | 0.1149 |
| 2 · Request withdrawal (Max) | status *Closing positions* | — | 0.1149 |
| 3 · Settlement | operator 2 siklus (markPositionsClosed, lalu settleWithdrawal) | fee 0.1089 ke C → 0.7811 bersih | 0.1149 |
| 4 · Claim USDG | dana kembali ke Rabby | +0.7811 | 0.8960 |
| 5 · Credits | top-up 0.5 USDG di My money | "receipt verified ✓", saldo credits $0.50 | 0.3960 |

Total yang "keluar" dari Rabby ≈0.72 USDG, tapi semuanya masuk ke C (wallet Anda sendiri): fee 0.2189 + credits 0.5. Biaya nyata hanya gas (≈0.00001 ETH).

Setelah itu `/treasury` harus menampilkan 2 fee receipts (deposit 0.11, withdrawal 0.1089) plus 0.5 credits, dan `/chain` menampilkan transaksinya.

**Setelah uji:**
1. `/chain/console` (wallet A) → *Minimum deposit* → isi `10` → *Set minimum*. `/chain` lalu menampilkan "Minimum 10 USDG".
2. Opsional: hapus `CREDITS_MIN_TOPUP_USD` di Vercel (kembali ke 1 USDG), lalu redeploy.

## Kalau ada masalah

- **Darurat:** di `/chain/console`, wallet A → *Pause deposits* atau *Close-only*. Klaim tetap selalu terbuka.
- **Deposit ditolak `StaleNav`:** operator belum memposting NAV. Cek log service ops (gas B? `OPERATOR_MAINNET_CONFIRM`?).
- **Indexer kosong:** cek `INDEXER_START_BLOCK` dan `INDEXER_CHAIN=mainnet`.
