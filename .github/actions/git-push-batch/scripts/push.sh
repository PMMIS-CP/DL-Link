#!/usr/bin/env bash
# Incremental batch push script

set -euo pipefail

BRANCH="${INPUT_BRANCH:-${GITHUB_REF_NAME}}"
BACKUP_DIR="$INPUT_BACKUP_DIR"
BATCH_SIZE="${INPUT_BATCH_SIZE:-3}"
MAX_RETRIES="${INPUT_MAX_PUSH_RETRIES:-5}"

urlencode() {
    python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"
}

regenerate_downloads_readme() {
    local DOWNLOADS_README="downloads/README.md"
    {
        echo "# Downloaded list :"
        echo ""
    } > "$DOWNLOADS_README"
    
    for folder in downloads/*/; do
        [ -d "$folder" ] || continue
        local FOLDER_NAME
        FOLDER_NAME=$(basename "$folder")
        [ -f "$folder/README.md" ] || continue
        local FOLDER_ENCODED
        FOLDER_ENCODED=$(urlencode "$FOLDER_NAME")
        printf -- "- [%s](./%s)\n" "$FOLDER_NAME" "$FOLDER_ENCODED" >> "$DOWNLOADS_README"
    done
}

push_batch() {
    local FILES=("$@")
    local TOTAL_FILES=${#FILES[@]}
    local BATCH_COUNT=0
    local BATCH_FILES=()
    local TOTAL_PUSHED=0
    
    for FILE in "${FILES[@]}"; do
        BATCH_FILES+=("$FILE")
        BATCH_COUNT=$((BATCH_COUNT + 1))
        
        if [ $BATCH_COUNT -ge "$BATCH_SIZE" ]; then
            TOTAL_PUSHED=$((TOTAL_PUSHED + BATCH_COUNT))
            echo ""
            echo ">>> Pushing batch ($TOTAL_PUSHED/$TOTAL_FILES files)..."
            
            git fetch origin "$BRANCH" --quiet 2>/dev/null || true
            git reset --hard origin/"$BRANCH" 2>/dev/null || true
            mkdir -p downloads
            cp -r "$BACKUP_DIR"/* downloads/ 2>/dev/null || true
            
            for BF in "${BATCH_FILES[@]}"; do
                git add "$BF" 2>/dev/null || true
            done
            
            if ! git diff --cached --quiet 2>/dev/null; then
                git commit -m "Add batch of $BATCH_COUNT files [skip ci]" --quiet 2>/dev/null || true
                
                local PUSH_RETRY=0
                local PUSH_SUCCESS=false
                while [ $PUSH_RETRY -lt "$MAX_RETRIES" ]; do
                    PUSH_RETRY=$((PUSH_RETRY + 1))
                    if timeout 180 git push origin HEAD:"$BRANCH" 2>&1; then
                        PUSH_SUCCESS=true
                        echo "    Batch pushed successfully!"
                        break
                    else
                        echo "    Batch push failed, attempt $PUSH_RETRY/$MAX_RETRIES..."
                        git fetch origin "$BRANCH" --quiet 2>/dev/null || true
                        git reset --hard origin/"$BRANCH" 2>/dev/null || true
                        mkdir -p downloads
                        cp -r "$BACKUP_DIR"/* downloads/ 2>/dev/null || true
                        for BF in "${BATCH_FILES[@]}"; do
                            git add "$BF" 2>/dev/null || true
                        done
                        git commit -m "Add batch of $BATCH_COUNT files [skip ci]" --quiet 2>/dev/null || true
                        sleep $((3 + RANDOM % 7))
                    fi
                done
                
                if [ "$PUSH_SUCCESS" = false ]; then
                    echo "    WARNING: Batch push failed after $MAX_RETRIES attempts"
                fi
            fi
            
            BATCH_FILES=()
            BATCH_COUNT=0
            sleep 2
        fi
    done
    
    # Push remaining files
    if [ ${#BATCH_FILES[@]} -gt 0 ]; then
        TOTAL_PUSHED=$((TOTAL_PUSHED + ${#BATCH_FILES[@]}))
        echo ""
        echo ">>> Pushing final batch ($TOTAL_PUSHED/$TOTAL_FILES files)..."
        
        git fetch origin "$BRANCH" --quiet 2>/dev/null || true
        git reset --hard origin/"$BRANCH" 2>/dev/null || true
        mkdir -p downloads
        cp -r "$BACKUP_DIR"/* downloads/ 2>/dev/null || true
        
        for BF in "${BATCH_FILES[@]}"; do
            git add "$BF" 2>/dev/null || true
        done
        
        if ! git diff --cached --quiet 2>/dev/null; then
            git commit -m "Add final batch [skip ci]" --quiet 2>/dev/null || true
            local PUSH_RETRY=0
            while [ $PUSH_RETRY -lt "$MAX_RETRIES" ]; do
                PUSH_RETRY=$((PUSH_RETRY + 1))
                if timeout 180 git push origin HEAD:"$BRANCH" 2>&1; then
                    echo "    Final batch pushed successfully!"
                    break
                fi
                sleep $((3 + RANDOM % 7))
                git fetch origin "$BRANCH" --quiet 2>/dev/null || true
                git reset --hard origin/"$BRANCH" 2>/dev/null || true
                mkdir -p downloads
                cp -r "$BACKUP_DIR"/* downloads/ 2>/dev/null || true
                for BF in "${BATCH_FILES[@]}"; do
                    git add "$BF" 2>/dev/null || true
                done
                git commit -m "Add final batch [skip ci]" --quiet 2>/dev/null || true
            done
        fi
    fi
}

# ============================================
# MAIN INCREMENTAL PUSH LOGIC
# ============================================

echo ""
echo "=========================================="
echo "Starting incremental push process..."
echo "=========================================="

echo "Syncing with remote repository..."
git fetch origin "$BRANCH"
git reset --hard origin/"$BRANCH"

mkdir -p downloads
cp -r "$BACKUP_DIR"/* downloads/ 2>/dev/null || true

echo "Analyzing files to push..."
ALL_FILES=()

while IFS= read -r -d '' FILE; do
    ALL_FILES+=("$FILE")
done < <(find downloads -name "README.md" -print0 2>/dev/null)

while IFS= read -r -d '' FILE; do
    ALL_FILES+=("$FILE")
done < <(find downloads -type f \( -name "*.z[0-9]*" -o -name "*.zip" -o -name "*.mp4" -o -name "*.mp3" -o -name "*.m4a" -o -name "*.exe" -o -name "*.iso" -o -name "*.tar*" -o -name "*.rar" -o -name "*.7z" \) -print0 2>/dev/null | sort -z)

TOTAL_FILES=${#ALL_FILES[@]}
echo "Found $TOTAL_FILES files to push"

TOTAL_SIZE=0
for F in "${ALL_FILES[@]}"; do
    if [ -f "$F" ]; then
        FSIZE=$(stat -c%s "$F" 2>/dev/null || echo 0)
        TOTAL_SIZE=$((TOTAL_SIZE + FSIZE))
    fi
done
TOTAL_SIZE_MB=$((TOTAL_SIZE / 1024 / 1024))
echo "Total size: ${TOTAL_SIZE_MB}MB"

if [ $TOTAL_SIZE_MB -lt 100 ] && [ $TOTAL_FILES -le 10 ]; then
    echo "Small upload - pushing all at once..."
    git add -A downloads/
    git add README.md
    if ! git diff --cached --quiet; then
        git commit -m "Downloaded files [skip ci]"
        RETRY=0
        while [ $RETRY -lt 10 ]; do
            RETRY=$((RETRY + 1))
            if timeout 300 git push origin HEAD:"$BRANCH"; then
                echo "Push successful!"
                break
            fi
            sleep $((3 + RANDOM % 7))
            git fetch origin "$BRANCH"
            git reset --hard origin/"$BRANCH"
            mkdir -p downloads
            cp -r "$BACKUP_DIR"/* downloads/ 2>/dev/null || true
            git add -A downloads/
            git add README.md
            git commit -m "Downloaded files [skip ci]" || true
        done
    fi
else
    echo "Large upload - using incremental batch push..."
    push_batch "${ALL_FILES[@]}"
    
    echo "Pushing README files..."
    git fetch origin "$BRANCH" --quiet 2>/dev/null || true
    git reset --hard origin/"$BRANCH" 2>/dev/null || true
    mkdir -p downloads
    cp -r "$BACKUP_DIR"/* downloads/ 2>/dev/null || true
    regenerate_downloads_readme
    git add downloads/README.md
    git add README.md
    if ! git diff --cached --quiet 2>/dev/null; then
        git commit -m "Update download list [skip ci]" --quiet 2>/dev/null || true
        timeout 60 git push origin HEAD:"$BRANCH" 2>&1 || true
    fi
fi

echo ""
echo "=========================================="
echo "All files pushed successfully!"
echo "=========================================="