# Leonida Clip Cutter

Auto highlight + subtitle Inggris buat klip GTA 6 — jadiin short 9:16 (TikTok / Shorts / Reels) langsung dari browser.

**Live:** https://daniular.github.io/gta6-clip-highlighter/

## Yang bisa dilakuin (v1)

1. **Upload klip** (drag-drop atau pilih file). Klip dari rekaman / download VOD atau stream lo sendiri — GTA VI belum ada di PC, jadi belum ada capture langsung. File lo nggak pernah keluar dari browser.
2. **Auto highlight** — tool ini baca gelombang audio (Web Audio API) dan cari jendela waktu paling keras/rame. Durasi klip bisa dipilih 15 / 30 / 60 detik, sensitivitas + jumlah highlight bisa diatur. Waveform ditampilin, highlight bisa diklik buat preview, start/end bisa digeser manual.
3. **Subtitle Inggris otomatis** — transkrip pakai Whisper `tiny.en` (model Inggris aja) via transformers.js, jalan lokal di browser, tanpa API key, tanpa upload. Download pertama ~75 MB, abis itu ke-cache. Teks hasil transkrip bisa diedit, dan kalau nggak ada omongan yang kedeteksi, tool ini bilang terus terang — nggak ngarang teks.
4. **Preview 9:16** — video di-crop tengah ke vertikal, posisi crop bisa digeser. Subtitle tampil gaya caption TikTok (kata yang lagi diomongin jadi kuning).
5. **Export** — download video hasil (.webm, subtitle nempel) + file subtitle (.srt, waktunya relatif dari awal klip export).

## Kenapa export-nya .webm, bukan .mp4?

Video hasil export direkam dari preview pakai `MediaRecorder` (canvas + audio asli). Alternatifnya ffmpeg.wasm butuh download ~30 MB plus header server khusus (COOP/COEP) yang GitHub Pages nggak kasih — jadi MediaRecorder yang kepilih, dan udah dites jalan di Chromium. TikTok, YouTube Shorts & Reels nerima .webm. Kalau butuh .mp4:

```bash
ffmpeg -i leonida-highlight.webm -c:v libx264 -c:a aac leonida-highlight.mp4
```

## Klip test

Repo ini bawa `test-clip.webm` — video test pattern 30 detik yang di-generate pakai ffmpeg, isinya pidato JFK (public domain, 11 detik) + nada keras di detik 17 & 24 buat ngetes deteksi highlight. **Bukan gameplay GTA 6**, cuma buat ngetes tool ini. Tombol "Coba klip test" di halaman bakal load file ini.

## Jalanin lokal

```bash
# dari folder repo
python3 -m http.server 8000
# buka http://localhost:8000
```

Nggak ada build step, nggak ada server, nggak ada API key. Satu file `index.html` (+ `test-clip.webm` buat demo).

## Yang sengaja nggak ada di v1

Face tracking, audio cleanup, upscaling — sesuai pesanan. Mungkin nyusul kalau diminta.

## Test

`test-browser.cjs` — Playwright (Chromium) lawan halaman yang di-serve lokal: upload klip test, cek waveform + highlight muncul, transcribe (model Whisper di-download dari Hugging Face — kalau sandbox nggak bisa reach HF, langkah ini dilaporkan apa adanya), preview 9:16 ke-render, export video (.webm, dicek pakai ffprobe) + .srt valid.

```bash
NODE_PATH=~/workspace/makefun/fps-tools/node_modules node test-browser.cjs
```
