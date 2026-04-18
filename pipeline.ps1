# ============================================
#  CityScraper Pipeline Runner
#  Usage:  .\pipeline.ps1           (scrape + push + geocode)
#          .\pipeline.ps1 -Clear    (clear tables first, then scrape + push + geocode)
# ============================================
param([switch]$Clear)

$check  = [char]0x2713   # checkmark
$cross  = [char]0x2717   # X mark
$arrow  = [char]0x25B6   # arrow

function Write-Status($icon, $color, $msg) {
    Write-Host "  $icon " -ForegroundColor $color -NoNewline
    Write-Host $msg
}

function Write-Step($msg) {
    Write-Host ""
    Write-Host "  $arrow $msg" -ForegroundColor Cyan
}

# Load secret
try {
    $secret = (Get-Content .env.vercel | Select-String "CRON_SECRET").ToString().Split("=",2)[1]
} catch {
    Write-Status $cross Red "Failed to load CRON_SECRET from .env.vercel"
    exit 1
}

Write-Host ""
Write-Host "  =============================" -ForegroundColor Yellow
Write-Host "   CityScraper Pipeline Runner" -ForegroundColor Yellow
Write-Host "  =============================" -ForegroundColor Yellow

# ---------- CLEAR (optional) ----------
if ($Clear) {
    Write-Step "Clearing both databases..."
    $clearScript = @"
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = {};
fs.readFileSync('.env.vercel', 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
});
async function run() {
  const cs = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { error: e1 } = await cs.from('yard_sales').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const ys = createClient(env.YARDSHOPPERS_SUPABASE_URL, env.YARDSHOPPERS_SUPABASE_KEY);
  const { error: e2 } = await ys.from('external_sales').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(JSON.stringify({ cs: e1 ? e1.message : 'ok', ys: e2 ? e2.message : 'ok' }));
}
run();
"@
    $clearScript | Out-File -FilePath _clear_tmp.js -Encoding utf8
    $clearResult = node _clear_tmp.js 2>&1
    Remove-Item _clear_tmp.js -ErrorAction SilentlyContinue
    try {
        $clearJson = $clearResult | ConvertFrom-Json
        if ($clearJson.cs -eq 'ok' -and $clearJson.ys -eq 'ok') {
            Write-Status $check Green "CityScraper yard_sales cleared"
            Write-Status $check Green "YardShoppers external_sales cleared"
        } else {
            if ($clearJson.cs -ne 'ok') { Write-Status $cross Red "CityScraper: $($clearJson.cs)" }
            if ($clearJson.ys -ne 'ok') { Write-Status $cross Red "YardShoppers: $($clearJson.ys)" }
        }
    } catch {
        Write-Status $cross Red "Clear failed: $clearResult"
    }
}

# ---------- STEP 1: CRON SCRAPE ----------
Write-Step "Scraping yard sales (this takes ~60s)..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $cronResp = Invoke-WebRequest -Uri "https://www.cityscraper.org/api/cron" -Headers @{authorization="Bearer $secret"} -TimeoutSec 300 -UseBasicParsing
    $sw.Stop()
    $cronData = $cronResp.Content | ConvertFrom-Json
    Write-Status $check Green "Scrape complete ($([math]::Round($sw.Elapsed.TotalSeconds))s) - $($cronData.totalScraped) listings scraped"
} catch {
    $sw.Stop()
    if ($_.Exception.Message -match "timed out") {
        Write-Status $check Yellow "Scrape sent ($([math]::Round($sw.Elapsed.TotalSeconds))s) - timed out waiting but likely completed on server"
    } else {
        Write-Status $cross Red "Scrape failed: $($_.Exception.Message)"
        exit 1
    }
}

# ---------- STEP 2: PUSH ----------
Write-Step "Pushing to YardShoppers + CheapHouseHub..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $pushResp = Invoke-WebRequest -Uri "https://www.cityscraper.org/api/push" -Headers @{authorization="Bearer $secret"} -TimeoutSec 120 -UseBasicParsing
    $sw.Stop()
    $pushData = $pushResp.Content | ConvertFrom-Json
    Write-Status $check Green "Push complete ($($pushData.duration)) - $($pushData.totalPushed) listings pushed"
} catch {
    $sw.Stop()
    Write-Status $cross Red "Push failed: $($_.Exception.Message)"
    exit 1
}

# ---------- STEP 3: GEOCODE ----------
Write-Step "Geocoding addresses for map pins..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $geoResp = Invoke-WebRequest -Uri "https://www.cityscraper.org/api/geocode" -Headers @{authorization="Bearer $secret"} -TimeoutSec 120 -UseBasicParsing
    $sw.Stop()
    $geoData = $geoResp.Content | ConvertFrom-Json
    Write-Status $check Green "Geocode complete ($($geoData.duration)) - $($geoData.citiesGeocoded) cities, $($geoData.listingsUpdated) listings updated, $($geoData.failed) failed"
} catch {
    $sw.Stop()
    Write-Status $cross Red "Geocode failed: $($_.Exception.Message)"
    exit 1
}

# ---------- DONE ----------
Write-Host ""
Write-Host "  =============================" -ForegroundColor Green
Write-Host "   $check Pipeline complete!    " -ForegroundColor Green
Write-Host "  =============================" -ForegroundColor Green
Write-Host ""
