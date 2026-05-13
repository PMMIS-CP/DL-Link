#!/usr/bin/env bash
# Split a large file into multiple zip parts

set -euo pipefail

SOURCE_FILE="$1"
OUTPUT_DIR="$2"
FOLDER_NAME="$3"
SPLIT_THRESHOLD_MB="$4"
PASSWORD="${5:-}"
WORK_DIR="${6:-/tmp}"

mkdir -p "$OUTPUT_DIR/$FOLDER_NAME"

BASENAME=$(basename "$SOURCE_FILE")
EXT="${BASENAME##*.}"
TEMP_NAME="split_$$"

# Copy to work directory
cp "$SOURCE_FILE" "$WORK_DIR/${TEMP_NAME}.${EXT}"

cd "$WORK_DIR"

if [ -n "$PASSWORD" ]; then
    zip -0 -s "${SPLIT_THRESHOLD_MB}m" -P "$PASSWORD" "${TEMP_NAME}.zip" "${TEMP_NAME}.${EXT}"
else
    zip -0 -s "${SPLIT_THRESHOLD_MB}m" "${TEMP_NAME}.zip" "${TEMP_NAME}.${EXT}"
fi

# Move parts to output
for part in ${TEMP_NAME}.z[0-9]* ${TEMP_NAME}.zip; do
    if [ -f "$part" ] && [ -s "$part" ]; then
        PART_EXT="${part##*.}"
        mv "$part" "$OUTPUT_DIR/${FOLDER_NAME}/${FOLDER_NAME}.${PART_EXT}"
        echo "  Created: ${FOLDER_NAME}.${PART_EXT}"
    fi
done

rm -f "${TEMP_NAME}.${EXT}"
cd - > /dev/null