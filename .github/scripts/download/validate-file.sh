#!/usr/bin/env bash
# File validation utility

validate_file() {
    local FILE="$1"
    
    # Check if file exists and has content
    if [ ! -f "$FILE" ]; then
        return 1
    fi
    
    if [ ! -s "$FILE" ]; then
        return 1
    fi
    
    local FILE_SIZE
    FILE_SIZE=$(stat -c%s "$FILE" 2>/dev/null || echo "0")
    if [ "$FILE_SIZE" -le 0 ]; then
        return 1
    fi
    
    echo "$FILE_SIZE"
    return 0
}

validate_files_in_dir() {
    local DIR="$1"
    local VALID_FILES=""
    
    for f in "$DIR"/*; do
        if [ -f "$f" ]; then
            local SIZE
            SIZE=$(validate_file "$f" 2>/dev/null)
            if [ -n "$SIZE" ]; then
                VALID_FILES="$VALID_FILES $f"
            else
                echo "Skipping empty or invalid file: $f" >&2
            fi
        fi
    done
    
    echo "$VALID_FILES"
}