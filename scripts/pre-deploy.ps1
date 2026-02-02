# Pre-deploy check script for Waifu100 (Windows PowerShell)
# Run this before committing or deploying to catch issues early

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "🔍 Waifu100 Pre-Deploy Check" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

$step = 0
$total = 5

function Check-Step {
    param($message)
    $script:step++
    Write-Host ""
    Write-Host "[$step/$total] $message" -ForegroundColor Yellow
    Write-Host "----------------------------"
}

function Success {
    param($message)
    Write-Host "✓ $message" -ForegroundColor Green
}

function Fail {
    param($message)
    Write-Host "✗ $message" -ForegroundColor Red
    exit 1
}

# Step 1: Check dependencies
Check-Step "Checking dependencies..."
try {
    $bunVersion = bun --version
    Success "Bun installed ($bunVersion)"
} catch {
    Fail "Bun not installed"
}

if (Test-Path "package.json") {
    Success "package.json found"
} else {
    Fail "package.json not found - are you in the project root?"
}

# Step 2: Install dependencies
Check-Step "Checking node_modules..."
if (Test-Path "node_modules") {
    Success "node_modules exists"
} else {
    Write-Host "Installing dependencies..."
    bun install
    Success "Dependencies installed"
}

# Step 3: TypeScript check
Check-Step "Running TypeScript check..."
try {
    npx tsc --noEmit
    if ($LASTEXITCODE -eq 0) {
        Success "No TypeScript errors"
    } else {
        Fail "TypeScript errors found"
    }
} catch {
    Fail "TypeScript check failed"
}

# Step 4: Lint check
Check-Step "Running ESLint..."
$hasEslint = (Test-Path ".eslintrc.json") -or (Test-Path "eslint.config.mjs") -or (Test-Path ".eslintrc.js")
if ($hasEslint) {
    try {
        bun run lint 2>$null
        if ($LASTEXITCODE -eq 0) {
            Success "No lint errors"
        } else {
            Write-Host "⚠ Lint issues found (not blocking)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "⚠ Lint check skipped" -ForegroundColor Yellow
    }
} else {
    Success "Skipped (no eslint config)"
}

# Step 5: Production build
Check-Step "Running production build..."
try {
    bun run build
    if ($LASTEXITCODE -eq 0) {
        Success "Build successful"
    } else {
        Fail "Build failed"
    }
} catch {
    Fail "Build failed with exception"
}

# Summary
Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "✅ All checks passed!" -ForegroundColor Green
Write-Host ""
Write-Host "Ready to deploy. Next steps:"
Write-Host "  1. git add ."
Write-Host "  2. git commit -m 'your message'"
Write-Host "  3. git push (Vercel auto-deploys)"
Write-Host ""
