#!/usr/bin/env bash
# Create a single zip file from a source file

set -euo pipefail

SOURCE_FILE="$1"
OUTPUT_DIR="$2"
FOLDER_NAME="$3"
PASSWORD="${4:-}"

mkdir -p "$OUTPUT_DIR/$FOLDER_NAME"

if [ -n "$PASSWORD" ]; then
    zip -j -P "$PASSWORD" "$OUTPUT_DIR/$FOLDER_NAME/${FOLDER_NAME}.zip" "$SOURCE_FILE"
else
    zip -j "$OUTPUT_DIR/$FOLDER_NAME/${FOLDER_NAME}.zip" "$SOURCE_FILE"
fi

if [ ! -s "$OUTPUT_DIR/$FOLDER_NAME/${FOLDER_NAME}.zip" ]; then
    echo "ERROR: Failed to create zip" >&2
    rm -f "$OUTPUT_DIR/$FOLDER_NAME/${FOLDER_NAME}.zip"
    exit 1
fi

echo "Created: $OUTPUT_DIR/$FOLDER_NAME/${FOLDER_NAME}.zip"