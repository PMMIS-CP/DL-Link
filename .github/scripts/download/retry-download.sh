#!/usr/bin/env bash
# Download with retry logic using aria2c first, then curl as fallback

# Source the file validator
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/validate-file.sh"

download_with_retry() {
    local URL="$1"
    local FILENAME="$2"
    local DEST_DIR="$3"
    local MAX_RETRIES="${4:-3}"
    local RETRY_DELAY="${5:-5}"
    local ERROR_FILE_CALLBACK="$6"
    local SUCCESS=false
    local ERROR_LOG=""
    
    # Clean up any previous partial download
    rm -f "$DEST_DIR/$FILENAME" "$DEST_DIR/$FILENAME.aria2"
    
    for ((attempt=1; attempt<=MAX_RETRIES; attempt++)); do
        echo "Attempt $attempt of $MAX_RETRIES for $FILENAME"
        
        # Clean before each attempt
        rm -f "$DEST_DIR/$FILENAME" "$DEST_DIR/$FILENAME.aria2"
        
        # Try aria2c first
        ERROR_LOG=$(aria2c \
            --split=2 \
            --max-connection-per-server=2 \
            --min-split-size=20M \
            --max-tries=3 \
            --retry-wait=5 \
            --timeout=60 \
            --connect-timeout=30 \
            --follow-torrent=false \
            --check-certificate=false \
            --allow-overwrite=true \
            --auto-file-renaming=false \
            --dir="$DEST_DIR" \
            --out="$FILENAME" \
            "$URL" 2>&1)
        
        # Check if aria2c download was successful
        local FILE_SIZE
        FILE_SIZE=$(validate_file "$DEST_DIR/$FILENAME" 2>/dev/null)
        if [ -n "$FILE_SIZE" ]; then
            SUCCESS=true
            echo "aria2c download successful: $FILENAME (${FILE_SIZE} bytes)"
            break
        fi
        
        # aria2c failed, clean up and try curl
        rm -f "$DEST_DIR/$FILENAME" "$DEST_DIR/$FILENAME.aria2"
        echo "aria2c failed or file empty, trying curl fallback..."
        
        ERROR_LOG=$(curl -L -f -# \
            --retry 3 \
            --retry-delay 5 \
            --connect-timeout 30 \
            --max-time 3600 \
            -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
            -o "$DEST_DIR/$FILENAME" \
            "$URL" 2>&1)
        
        # Check curl result
        FILE_SIZE=$(validate_file "$DEST_DIR/$FILENAME" 2>/dev/null)
        if [ -n "$FILE_SIZE" ]; then
            SUCCESS=true
            echo "curl download successful: $FILENAME (${FILE_SIZE} bytes)"
            break
        fi
        
        # Both failed, clean up
        rm -f "$DEST_DIR/$FILENAME"
        echo "Attempt $attempt failed. Waiting ${RETRY_DELAY}s before retry..."
        sleep "$RETRY_DELAY"
        RETRY_DELAY=$((RETRY_DELAY * 2))
    done
    
    if [ "$SUCCESS" = true ]; then
        local FINAL_SIZE
        FINAL_SIZE=$(validate_file "$DEST_DIR/$FILENAME" 2>/dev/null)
        if [ -n "$FINAL_SIZE" ]; then
            echo "Successfully downloaded: $FILENAME ($FINAL_SIZE bytes)"
            return 0
        fi
    fi
    
    # Download failed
    rm -f "$DEST_DIR/$FILENAME" "$DEST_DIR/$FILENAME.aria2"
    return 1
}