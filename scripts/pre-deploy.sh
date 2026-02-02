#!/bin/bash
# Pre-deploy check script for Waifu100
# Run this before committing or deploying to catch issues early

set -e  # Exit on first error

echo "🔍 Waifu100 Pre-Deploy Check"
echo "=============================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step counter
STEP=0
TOTAL=5

check_step() {
    STEP=$((STEP + 1))
    echo ""
    echo -e "${YELLOW}[$STEP/$TOTAL] $1${NC}"
    echo "----------------------------"
}

success() {
    echo -e "${GREEN}✓ $1${NC}"
}

fail() {
    echo -e "${RED}✗ $1${NC}"
    exit 1
}

# Step 1: Check dependencies
check_step "Checking dependencies..."
if command -v bun &> /dev/null; then
    success "Bun installed ($(bun --version))"
else
    fail "Bun not installed"
fi

if [ -f "package.json" ]; then
    success "package.json found"
else
    fail "package.json not found - are you in the project root?"
fi

# Step 2: Install dependencies (if node_modules missing)
check_step "Installing dependencies..."
if [ -d "node_modules" ]; then
    success "node_modules exists"
else
    echo "Installing..."
    bun install
    success "Dependencies installed"
fi

# Step 3: TypeScript check
check_step "Running TypeScript check..."
if npx tsc --noEmit; then
    success "No TypeScript errors"
else
    fail "TypeScript errors found"
fi

# Step 4: Lint check (if eslint is configured)
check_step "Running ESLint..."
if [ -f ".eslintrc.json" ] || [ -f "eslint.config.mjs" ] || [ -f ".eslintrc.js" ]; then
    if bun run lint 2>/dev/null; then
        success "No lint errors"
    else
        echo -e "${YELLOW}⚠ Lint issues found (not blocking)${NC}"
    fi
else
    echo "ESLint not configured, skipping..."
    success "Skipped (no eslint config)"
fi

# Step 5: Production build
check_step "Running production build..."
if bun run build; then
    success "Build successful"
else
    fail "Build failed"
fi

# Summary
echo ""
echo "=============================="
echo -e "${GREEN}✅ All checks passed!${NC}"
echo ""
echo "Ready to deploy. Next steps:"
echo "  1. git add ."
echo "  2. git commit -m 'your message'"
echo "  3. git push (Vercel auto-deploys)"
echo ""
