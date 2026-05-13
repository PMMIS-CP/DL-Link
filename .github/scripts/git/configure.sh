#!/usr/bin/env bash
# Git configuration for large file handling

set -euo pipefail

configure_git() {
    local USER_NAME="${1:-github-actions}"
    local USER_EMAIL="${2:-github-actions@github.com}"
    local LARGE_FILES="${3:-true}"
    
    if [ "$LARGE_FILES" = "true" ]; then
        git config --global http.postBuffer 524288000
        git config --global http.maxRequestBuffer 100M
        git config --global core.compression 0
        git config --global pack.windowMemory 256m
        git config --global pack.packSizeLimit 100m
        git config --global pack.threads 1
        echo "Git configured for large file handling"
    fi
    
    git config user.name "$USER_NAME"
    git config user.email "$USER_EMAIL"
    echo "Git user: $USER_NAME <$USER_EMAIL>"
}