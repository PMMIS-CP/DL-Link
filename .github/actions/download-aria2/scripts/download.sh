#!/usr/bin/env bash
# Wrapper script for direct download execution (used when calling action scripts externally)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

source "$SCRIPT_DIR/scripts/utils/random-name.sh"
source "$SCRIPT_DIR/scripts/download/retry-download.sh"
source "$SCRIPT_DIR/scripts/download/validate-file.sh"

URLS="$1"
DEST_DIR="${2:-tmp_downloads}"
BACKUP_DIR="$3"
MAX_RETRIES="${4:-3}"

mkdir -p "$DEST_DIR"

for URL in $URLS; do
    FILENAME=$(basename "$URL" | sed 's/%20/ /g' | sed 's/%2F/-/g' | sed 's/[?#].*//')
    FILENAME=$(echo "$FILENAME" | sed 's/[<>:"|?*]/_/g')
    
    echo "Downloading $URL -> $FILENAME"
    download_with_retry "$URL" "$FILENAME" "$DEST_DIR" "$MAX_RETRIES" || {
        echo "Failed to download: $FILENAME"
    }
done