# Covar — Fitur yang sudah ada & yang belum

_Posisi per 9 Nov 2026 · staging testnet (Robinhood Chain 46630) sudah online._

Legenda: ✅ jalan dan sudah diuji · 🟢 jalan di testnet (staging) · 🟡 sebagian / menunggu input · ❌ belum dibangun

---

## 1. Ringkasan satu paragraf

Covar adalah platform **agen trading berbasis aturan**. Creator menyusun strategi (lewat chat atau editor), mengujinya ke data
historis, menjalankannya dengan uang latihan, lalu mempublikasikannya. Investor menaruh USDG ke **vault on-chain** di Robinhood
Chain, dan bisa menarik dananya kapan saja lewat alur withdrawal yang aman. Hari ini alur investor (deposit → withdrawal → claim),
login wallet, Copilot AI berbayar kredit, indexer data on-chain, operator otomatis dan alert Telegram **sudah berjalan di testnet**.
Yang belum: **trading sungguhan di Lighter**, audit, mainnet, token/staking, dan beberapa fitur pelengkap.

---

## 2. Fitur yang sudah ada

### A. Untuk investor

| Fitur | Di mana | Kegunaan | Status |
|---|---|---|---|
| **Login wallet (Sign-In with Ethereum)** | tombol wallet kanan atas | Membuktikan wallet milik Anda dengan tanda tangan gratis (tanpa gas). Data Anda (strategi, riwayat) tersimpan per wallet dan ikut di perangkat mana pun | 🟢 |
| **Deposit ke vault** | My money → Invest, halaman vault | Menaruh USDG ke vault, mendapat shares sesuai harga per share. Fee 1% + 0,10 USDG. Ada cek minimum, batas per deposit (100), batas total vault (1.000), dan harga vault harus segar | 🟢 |
| **Withdrawal 3 langkah** | Invest card | Request → operator menutup posisi & settle di harga segar → Anda **claim** sendiri. Claim selalu ke wallet Anda, tidak bisa dialihkan | 🟢 |
| **My money** | `/portfolio` | Saldo USDG wallet & nilai di vault (langsung dari chain), riwayat transaksi asli dengan link explorer, status withdrawal. Data demo disembunyikan (bisa ditampilkan berlabel *Practice*) | 🟢 |
| **Discover** | `/explore` | Daftar agen. Vault yang benar-benar di-deploy tampil paling atas bertanda **on-chain** dengan TVL, return, drawdown, jumlah investor dari indexer | 🟢 (agen lain masih demo berlabel) |
| **Halaman agen / vault** | `/agents/[id]` | Performa, decision log, aturan publik, versi, risiko, riwayat event vault dengan link transaksi, panel Invest | 🟢 |
| **Notifikasi in-app** | ikon lonceng, `/notifications` | Deposit, withdrawal, claim, top-up, publish versi baru, peringatan risiko — hanya dari kejadian nyata | ✅ |
| **Pesan error yang mudah dipahami** | seluruh aplikasi | Error wallet/jaringan/kontrak diterjemahkan ke kalimat biasa + apa yang harus dilakukan; cek saldo sebelum transaksi | ✅ |

### B. Untuk creator

| Fitur | Di mana | Kegunaan | Status |
|---|---|---|---|
| **Strategy builder (chat)** | `/studio` | Tulis strategi dalam bahasa biasa ("Long SOL breakout 1h, stop 1.5× ATR") → diubah jadi aturan terstruktur yang pasti | ✅ |
| **Copilot AI** | `/studio` | Model AI (sekarang **Groq**, bisa Gemini/OpenAI/Anthropic/Orbio) membantu menyusun aturan; selalu dalam batas risiko. Kalau AI gagal atau kredit habis → parser aturan gratis, tidak dipotong | 🟢 |
| **Editor visual & code view** | `/studio` | Ubah aturan langsung, lihat diff antar versi, validasi otomatis | ✅ |
| **Backtest** | `/studio` | Uji ke data historis (EMA, RSI, ATR, Bollinger, volume) dengan fee, slippage, funding eksplisit; hasil bisa diulang persis | ✅ |
| **Practice** | `/studio`, halaman agen | Kartu agen/draft: pilih modal pura-pura → Start/Stop. Harga live dari Lighter (Robinhood Chain; mark + bid/ask), badge *Live marks · Lighter*, ticker naik/turun, Practice ledger (saldo, ekuitas, P&L, posisi), riwayat sesi terpisah dari My money | ✅ |
| **Lifecycle & publish** | `/studio` | Versi & riwayat; publish butuh backtest + persetujuan; investor diberi notice 48 jam sebelum versi baru berlaku | ✅ |
| **Halaman creator** | `/creators/[id]` | Profil dan daftar agen creator | ✅ |

### C. Copilot credits (pembayaran AI)

| Fitur | Kegunaan | Status |
|---|---|---|
| **Top-up dengan USDG** | Kirim USDG ke alamat treasury kredit; server memverifikasi transfer dari chain (sekali per transfer, tidak bisa dobel) | 🟢 |
| **Pemotongan sesuai pemakaian** | Tiap panggilan AI dipotong token × harga + fee aplikasi (sekarang $1/$5 per 1M token + 20%). Gagal = gratis | 🟢 |
| **Riwayat kredit** | Setiap top-up dan pemakaian tercatat dengan jumlah token & biayanya | 🟢 |
| **Laporan di Treasury** | Kredit terjual, terpakai, biaya provider, fee aplikasi, sisa liabilitas | 🟢 |

### D. Admin / owner & operator

| Fitur | Di mana | Kegunaan | Status |
|---|---|---|---|
| **Kontrak vault v2** | `0x9f01…f31B` (testnet) | Deposit/withdraw/claim, batas TVL & deposit, harga harus segar (≤6 jam), pause, close-only, trading account, alokasi ke venue. Source terverifikasi (Sourcify) | 🟢 |
| **Owner console** | `/chain/console` | Report NAV, pause/close-only, ubah batas, set trading account, alokasi dana, settle manual | 🟢 |
| **Operator otomatis** | Railway (`pnpm ops`) | Update harga vault (NAV) tiap ≥3 jam, tutup posisi & settle withdrawal otomatis, tahan lonjakan NAV yang aneh untuk review manual | 🟢 (soak berjalan) |
| **Monitor + alert Telegram** | Railway (`pnpm ops`) | Pantau service mati, NAV menua/basi, gas operator menipis, operator macet, withdrawal telat, kas claim kurang, vault di-pause; heartbeat harian | 🟢 |
| **Indexer** | Railway (`covar-production.up.railway.app`) | Membaca semua event vault & transfer fee dari chain → sumber data Discover, halaman vault, treasury, riwayat portfolio | 🟢 |
| **Treasury** | `/treasury` | Fee yang benar-benar diterima wallet treasury dari vault (persis dari chain) + laporan kredit Copilot | 🟢 |
| **Status chain** | `/chain` | Cek RPC, chain id, blok terbaru, info deployment | ✅ |

### E. Mesin di belakang layar (execution plane)

| Komponen | Kegunaan | Status |
|---|---|---|
| **Risk engine** (proses terpisah) | Cek setiap order: market yang diizinkan, leverage ≤5×, posisi ≤40%, pause harian −10%, stop drawdown −25%, mode close-only. Copilot tidak bisa menaikkan batas | ✅ (paper) |
| **Signer & execution** | Order idempotent dengan journal; setelah crash, order yang sudah terkirim diadopsi, tidak dikirim ulang | ✅ (paper) |
| **Adapter Lighter** | Signer resmi Lighter, order limit IOC dengan batas slippage, NAV dari equity akun | 🟡 dibangun & dites, **belum pernah order sungguhan** |
| **Rekonsiliasi** | Cocokkan journal vs venue setelah restart | ✅ |

### F. Infrastruktur & kualitas

| Item | Status |
|---|---|
| Web di **Vercel**, database **Neon Postgres**, indexer + operator/monitor di **Railway** | 🟢 |
| **CI GitHub Actions**: typecheck, engine 25, kontrak 25, service tests (39/44/102/30/34/41), build, E2E browser, rehearsal on-chain 22 | ✅ |
| Dokumentasi: `docs/GO_LIVE_RUNBOOK.md`, `DEPLOYMENT_AND_GAP.md`, `PARITY_REGISTER.md`, `.env.example`, bukti rehearsal di `docs/rehearsals/` | ✅ |
| Tampilan: warna cobalt, P&L hijau/merah, keyboard & focus, reduced motion, desktop & mobile | ✅ |

---

## 3. Fitur yang belum ada

### A. Wajib sebelum mainnet (urut prioritas)

| # | Item | Kenapa penting | Butuh apa |
|---|---|---|---|
| 1 | **Soak testnet 7 hari** | Bukti sistem jalan sendiri tanpa intervensi | Sedang berjalan — tinggal tes Hari 1 + pantau |
| 2 | **Trading sungguhan di Lighter (test-money)** | Adapter sudah ada tapi belum pernah order nyata | API key + akun **Lighter RH testnet** yang didanai (terpisah dari vault, karena Lighter testnet bukan chain 46630) |
| 3 | **Audit keamanan kontrak** | Belum ada audit independen; dana publik berisiko | Auditor eksternal (disarankan) |
| 4 | **Dokumen risiko & insiden** (`docs/SECURITY.md`) | Risiko single-key (1 wallet admin tanpa multisig) harus diterima tertulis; runbook kalau key bocor, venue down, NAV macet | Keputusan owner 0.9 |
| 5 | **Deploy mainnet 4663 dengan batas kecil** | Produksi | Fase 9 runbook; ETH mainnet untuk wallet A & B, akun Lighter mainnet |
| 6 | **Alur dana vault → Lighter → vault** | Hanya bisa diuji penuh di mainnet | Setelah #5, dengan nilai kecil |

### B. Fitur produk yang belum dibangun

| Item | Keterangan |
|---|---|
| **Fee performa creator on-chain (≤20% profit, split 80/20)** | Saat ini hanya di simulasi/kalkulator. Kontrak vault baru memotong fee deposit & withdrawal; bagi hasil creator/platform belum di-settle on-chain |
| **Vault per agen / per creator** | Sekarang satu vault (Covar vault). Agen lain di Discover masih data demo berlabel |
| **Token protokol, staking, buyback/burn** | Sengaja pending (keputusan 0.8), berlabel "not deployed" |
| **Copilot dengan konteks** (berita, X, data on-chain) | Copilot sekarang hanya menyusun aturan dari prompt |
| **"Connect Orbio" per pengguna** | Menunggu akses partner Orbio |
| **Login Privy** & **pemilih banyak wallet (EIP-6963)** | Sekarang wallet injected (MetaMask/Rabby); kalau dua extension terpasang, yang aktif yang menang |
| **Notifikasi email / push** | Baru in-app + Telegram untuk admin |
| **Script `rehearse:testnet`** | Uji testnet otomatis; sekarang manual lewat console + panel Invest |
| **Multisig / timelock admin** | Sesuai brief belum; risiko dicatat |
| **Dark mode, multi-bahasa, aplikasi mobile, dashboard metrics** | Belum |

### C. Hal kecil / perapian

- Domain resmi (sekarang `covar.vercel.app`) — keputusan 0.1.
- Logo final — keputusan 0.2.
- Saat sign out, perubahan yang belum tersinkron belum dipaksa tersimpan dulu.
- `DEPLOYMENT_AND_GAP.md` sebagian sudah usang; dokumen ini yang terbaru.

---

## 4. Urutan kerja yang disarankan

1. Selesaikan **soak 7 hari** (tes Hari 1: deposit 2 USDG → request → operator settle → claim; restart service; alert).
2. Siapkan **akun Lighter RH testnet** → uji order sungguhan + NAV dari equity (`VENUE_ADAPTER=live`).
3. Putuskan **fee creator on-chain** (perlu perubahan kontrak → lakukan **sebelum** audit).
4. **Audit** + `SECURITY.md` + runbook insiden.
5. **Mainnet** dengan batas kecil, uji dengan dana tim sendiri, baru buka publik.
