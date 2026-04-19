# ============================================================
# FILE: pipeline.ps1 (CityScraper project root)
# REPLACE the existing pipeline.ps1
#
# CHANGES:
# 1. Added Phase 0: Crawlee deep scraper (optional, local only)
# 2. Rest of pipeline unchanged — scrape, push, cleanup
# 3. Crawlee runs BEFORE the normal scrape for maximum coverage
#
# RUN: .\pipeline.ps1
# RUN WITH CRAWLEE: .\pipeline.ps1 -Deep
# ============================================================

param(
    [switch]$Deep  # Add -Deep flag to run Crawlee deep scraper first
)

$ErrorActionPreference = "Continue"
$BASE = $PSScriptRoot
$TIMESTAMP = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  CITYSCRAPER PIPELINE v5.0" -ForegroundColor Cyan
Write-Host "  $TIMESTAMP" -ForegroundColor Gray
if ($Deep) {
    Write-Host "  MODE: DEEP (Crawlee + Standard)" -ForegroundColor Yellow
} else {
    Write-Host "  MODE: Standard" -ForegroundColor Green
}
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# ── PHASE 0: CRAWLEE DEEP SCRAPER (optional) ──
if ($Deep) {
    Write-Host "[Phase 0] Running Crawlee deep scraper..." -ForegroundColor Yellow
    Write-Host "  This may take 10-30 minutes depending on how many sites respond." -ForegroundColor Gray
    Write-Host ""

    try {
        $crawleeResult = & npx tsx "$BASE\scripts\crawlee-deep-scraper.ts" 2>&1
        $crawleeResult | ForEach-Object { Write-Host "  $_" }
        Write-Host ""
        Write-Host "[Phase 0] Crawlee deep scraper complete!" -ForegroundColor Green
    } catch {
        Write-Host "[Phase 0] Crawlee failed: $_" -ForegroundColor Red
        Write-Host "  Continuing with standard pipeline..." -ForegroundColor Yellow
    }
    Write-Host ""
}

# ── PHASE 1: STANDARD SCRAPE (Vercel API) ──
Write-Host "[Phase 1] Running standard scrapers..." -ForegroundColor Cyan

# Yard sales
Write-Host "  Scraping yard sales..." -ForegroundColor White
try {
    $yardResult = Invoke-RestMethod -Uri "https://cityscraper.vercel.app/api/cron?source=yardsales" -Method GET -TimeoutSec 120
    Write-Host "  Yard sales: $($yardResult.details)" -ForegroundColor Green
} catch {
    Write-Host "  Yard sales failed: $_" -ForegroundColor Red
}

# Cheap homes
Write-Host "  Scraping cheap homes..." -ForegroundColor White
try {
    $homeResult = Invoke-RestMethod -Uri "https://cityscraper.vercel.app/api/cron?source=homes" -Method GET -TimeoutSec 120
    Write-Host "  Cheap homes: $($homeResult.details)" -ForegroundColor Green
} catch {
    Write-Host "  Cheap homes failed: $_" -ForegroundColor Red
}

Write-Host ""

# ── PHASE 2: PUSH TO DESTINATIONS ──
Write-Host "[Phase 2] Pushing to destination sites..." -ForegroundColor Cyan

# Push yard sales to YardShoppers
Write-Host "  Pushing to YardShoppers..." -ForegroundColor White
try {
    $pushYard = Invoke-RestMethod -Uri "https://cityscraper.vercel.app/api/push?target=yardshoppers" -Method GET -TimeoutSec 120
    Write-Host "  YardShoppers: $($pushYard.pushed) items pushed" -ForegroundColor Green
} catch {
    Write-Host "  YardShoppers push failed: $_" -ForegroundColor Red
}

# Push cheap homes to CheapHouseHub
Write-Host "  Pushing to CheapHouseHub..." -ForegroundColor White
try {
    $pushHome = Invoke-RestMethod -Uri "https://cityscraper.vercel.app/api/push?target=cheaphousehub" -Method GET -TimeoutSec 120
    Write-Host "  CheapHouseHub: $($pushHome.pushed) items pushed" -ForegroundColor Green
} catch {
    Write-Host "  CheapHouseHub push failed: $_" -ForegroundColor Red
}

Write-Host ""

# ── PHASE 3: CLEANUP ──
Write-Host "[Phase 3] Cleanup..." -ForegroundColor Cyan
Write-Host "  Marking pushed items..." -ForegroundColor White
try {
    $cleanup = Invoke-RestMethod -Uri "https://cityscraper.vercel.app/api/cleanup" -Method GET -TimeoutSec 60
    Write-Host "  Cleanup: $($cleanup.details)" -ForegroundColor Green
} catch {
    Write-Host "  Cleanup skipped or failed: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  PIPELINE COMPLETE" -ForegroundColor Green
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
