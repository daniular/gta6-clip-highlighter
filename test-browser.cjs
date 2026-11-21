// Browser test for Leonida Clip Cutter.
// Usage: NODE_PATH=~/workspace/makefun/fps-tools/node_modules node test-browser.cjs
// Serves index.html locally, drives it with Playwright (chromium-1148).
// Checks: upload -> waveform + highlights -> transcription (if HF reachable)
// -> 9:16 preview -> .webm export (ffprobe) + .srt valid.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("playwright-core");

const DIR = __dirname;
const PORT = 8932;
const TEST_CLIP = path.join(DIR, "test-clip.webm");
// Sandbox egress proxy blocks the browser's external fetches (ERR_TUNNEL_CONNECTION_FAILED),
// so for the transcription check we serve the real transformers.js / onnxruntime / Whisper
// files from local fixtures (downloaded via curl, which can reach the CDNs).
// Set TF_FIXTURES to that dir; if absent, the transcription step is reported unverified.
const TF_FIXTURES = process.env.TF_FIXTURES || "/tmp/tf-test";
let failures = 0;
const check = (cond, msg) => {
  if (!cond) { failures++; console.error("FAIL: " + msg); }
  else console.log("ok: " + msg);
};

const MIME = { ".html": "text/html", ".mp4": "video/mp4", ".webm": "video/webm", ".js": "text/javascript", ".md": "text/plain" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(DIR, p === "/" ? "index.html" : p);
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log("serving on :" + PORT);
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream",
           "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300)); });

  // Route external ML assets to local fixtures (see TF_FIXTURES note above).
  const fixturesOk = fs.existsSync(path.join(TF_FIXTURES, "transformers.min.js"))
    && fs.existsSync(path.join(TF_FIXTURES, "model/onnx/encoder_model_quantized.onnx"));
  if (fixturesOk) {
    await page.route("**/transformers.min.js", r => r.fulfill({ path: path.join(TF_FIXTURES, "transformers.min.js") }));
    await page.route("**/transformers@2.17.2/dist/*.wasm", r => {
      const name = r.request().url().split("/").pop();
      r.fulfill({ path: path.join(TF_FIXTURES, "onnx", name) });
    });
    await page.route("**/huggingface.co/Xenova/whisper-tiny.en/resolve/main/**", r => {
      const rel = r.request().url().split("/resolve/main/")[1];
      const local = path.join(TF_FIXTURES, "model", rel);
      if (fs.existsSync(local)) r.fulfill({ path: local });
      else { console.log("   (fixture missing for " + rel + ", 404)"); r.fulfill({ status: 404, body: "missing fixture" }); }
    });
    console.log("   fixtures: local transformers.js + Whisper tiny.en routed");
  } else {
    console.log("   fixtures MISSING at " + TF_FIXTURES + " — transcription will be attempted live (likely blocked in sandbox)");
  }

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  check(await page.title().then(t => t.includes("Leonida Clip Cutter")), "page title");

  // --- 1. upload test clip via file input ---
  await page.setInputFiles("#fileInput", TEST_CLIP);
  await page.waitForFunction(() => {
    const el = document.querySelector("#fileInfo");
    return el && /durasi/.test(el.textContent) && /audio OK/.test(el.textContent);
  }, { timeout: 20000 });
  const info = await page.textContent("#fileInfo");
  console.log("   fileInfo:", info.slice(0, 160));
  check(/30\.0 dtk/.test(info), "clip duration read as 30.0s");

  // --- 2. waveform + highlights ---
  await page.waitForFunction(() => document.querySelectorAll("#hlList .hl").length > 0, { timeout: 10000 });
  const hlCount = await page.locator("#hlList .hl").count();
  const hlText = await page.textContent("#hlList");
  console.log("   highlights:", hlText.replace(/\s+/g, " ").slice(0, 300));
  check(hlCount >= 1, `highlight windows found (${hlCount})`);
  const rangeStart = await page.inputValue("#rangeStart");
  const rangeEnd = await page.inputValue("#rangeEnd");
  console.log(`   selected range: ${rangeStart} - ${rangeEnd}`);
  check(parseFloat(rangeEnd) - parseFloat(rangeStart) > 0, "range start < end");
  // first highlight should cover the speech region (0-11s) or a burst (17/24s)
  const firstStart = parseFloat(rangeStart);
  check(firstStart <= 11.5, `first highlight starts near speech/burst (start=${firstStart})`);

  // waveform canvas actually painted (non-blank pixels)
  const wavePainted = await page.evaluate(() => {
    const c = document.querySelector("#waveCanvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let nz = 0; for (let i = 3; i < d.length; i += 400) if (d[i] > 0) nz++;
    return nz > 10;
  });
  check(wavePainted, "waveform canvas painted");

  // --- 3. transcription (Whisper tiny.en; HF may be unreachable in sandbox) ---
  let transcribed = false, trNote = "";
  try {
    await page.click("#transcribeBtn");
    await page.waitForFunction(() => {
      const t = document.querySelector("#trStatus").textContent;
      return /Dapet \d+ segmen/.test(t) || /Nggak kedeteksi/.test(t) || /gagal/.test(t);
    }, { timeout: 240000 });
    trNote = await page.textContent("#trStatus");
    console.log("   transcribe status:", trNote.slice(0, 220));
    transcribed = /Dapet \d+ segmen/.test(trNote);
    check(transcribed || /Nggak kedeteksi/.test(trNote), "transcription finished with a clear verdict");
    if (transcribed) {
      const segText = await page.$$eval("#transcriptList textarea", els => els.map(e => e.value).join(" "));
      console.log("   transcript:", segText.slice(0, 300));
      check(/fellow|america|country|ask not/i.test(segText), "transcript contains expected JFK words");
    }
  } catch (e) {
    console.log("   transcription wait timed out: " + e.message.split("\n")[0]);
    trNote = await page.textContent("#trStatus");
    console.log("   transcribe status at timeout:", trNote.slice(0, 220));
    check(false, "transcription completed within timeout (see status above)");
  }

  // --- 4. 9:16 preview renders ---
  await page.click("#playBtn");
  await page.waitForTimeout(2500);
  const previewPainted = await page.evaluate(() => {
    const c = document.querySelector("#previewCanvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 401) { sum += d[i] + d[i + 1] + d[i + 2]; n++; }
    return sum / n;
  });
  console.log("   preview mean pixel value:", previewPainted.toFixed(1));
  check(previewPainted > 5, "9:16 preview canvas renders video frames (non-black)");
  const timeLabel = await page.textContent("#timeLabel");
  console.log("   timeLabel:", timeLabel);
  check(/dtk/.test(timeLabel), "preview time label updates");
  await page.click("#pauseBtn");

  // --- 5a. SRT export ---
  const dlDir = path.join(DIR, ".test-dl");
  fs.mkdirSync(dlDir, { recursive: true });
  const client = await page.context().newCDPSession(page);
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  // use a short manual range for a fast video export
  await page.fill("#rangeStart", "4");
  await page.fill("#rangeEnd", "7");
  await page.click("#applyRangeBtn");
  await page.click("#exportSrtBtn");
  await page.waitForTimeout(1500);
  const srtFiles = fs.readdirSync(dlDir).filter(f => f.endsWith(".srt"));
  check(srtFiles.length >= 1, "SRT file downloaded");
  if (srtFiles.length) {
    const srt = fs.readFileSync(path.join(dlDir, srtFiles[0]), "utf8");
    console.log("   srt head:\n" + srt.split("\n").slice(0, 8).join("\n"));
    check(/^\d+\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/m.test(srt), "SRT format valid (index + timestamps)");
    check(srt.includes("00:00:00,000 -->"), "SRT times relative to export start");
  }

  // --- 5b. video export (3s range, real-time record) ---
  await page.click("#exportVideoBtn");
  const webmPath = path.join(dlDir, "leonida-highlight.webm");
  let gotWebm = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    if (fs.existsSync(webmPath) && fs.statSync(webmPath).size > 10000) { gotWebm = true; break; }
  }
  const expStatus = await page.textContent("#exportStatus");
  console.log("   export status:", expStatus.slice(0, 200));
  check(gotWebm, "video export produced a .webm download");
  if (gotWebm) {
    try {
      const probe = execSync(`ffprobe -v error -show_entries stream=codec_type,codec_name,width,height -of default=noprint_wrappers=1 "${webmPath}"`, { encoding: "utf8" });
      console.log("   ffprobe webm:\n" + probe);
      check(/codec_type=video/.test(probe) && /codec_type=audio/.test(probe), "exported webm has video + audio streams");
      check(/width=540/.test(probe) && /height=960/.test(probe), "exported video is 540x960 (9:16)");
      // MediaRecorder webm has no duration header (ffprobe says N/A) — measure by decoding.
      const dec = execSync(`ffmpeg -v info -i "${webmPath}" -f null - 2>&1 | grep -o "time=[0-9:.]*" | tail -1`, { encoding: "utf8" });
      const t = (dec.match(/time=(\d+):(\d+):([\d.]+)/) || []).slice(1);
      const dur = t.length === 3 ? (+t[0]) * 3600 + (+t[1]) * 60 + parseFloat(t[2]) : 0;
      console.log("   decoded duration:", dur.toFixed(2) + "s (headless swiftshader plays video slower than wall-clock, so the real-time recording runs long; on real hardware it tracks the 3s range)");
      check(dur >= 2 && dur <= 6, `exported duration ~3s (got ${dur.toFixed(2)}s)`);
    } catch (e) { check(false, "ffprobe on exported webm: " + e.message.slice(0, 200)); }
  }

  console.log("\npage errors seen:", errors.length ? errors.slice(0, 8) : "none");
  if (errors.length) { failures++; }
  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error("HARNESS ERROR:", e); server.close(); process.exit(2); });
