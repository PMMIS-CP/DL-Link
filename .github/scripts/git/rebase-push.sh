#!/usr/bin/env bash
# Git rebase and push with retry

set -euo pipefail

rebase_and_push() {
    local BRANCH="$1"
    local MAX_RETRIES="${2:-5}"
    local TIMEOUT="${3:-180}"
    
    local RETRY=0
    while [ $RETRY -lt "$MAX_RETRIES" ]; do
        RETRY=$((RETRY + 1))
        git fetch origin "$BRANCH" --quiet 2>/dev/null || true
        git rebase origin/"$BRANCH" 2>/dev/null || {
            git rebase --abort 2>/dev/null || true
            git reset --hard origin/"$BRANCH" 2>/dev/null || true
            return 1
        }
        
        if timeout "$TIMEOUT" git push origin HEAD:"$BRANCH" 2>&1; then
            echo "Push successful!"
            return 0
        fi
        echo "Push failed, retry $RETRY/$MAX_RETRIES..."
        sleep $((2 + RANDOM % 5))
    done
    
    return 1
}