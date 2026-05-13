#!/usr/bin/env python3
"""
Parse browser download JSON output and extract file info.
Usage: echo '<json>' | python3 parse-download-result.py <field>
Fields: file_names | file_count | has_files | success
"""

import sys
import json

def main():
    if len(sys.argv) < 2:
        print("Usage: parse-download-result.py <field>", file=sys.stderr)
        sys.exit(1)

    field = sys.argv[1]
    
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if field == "file_names":
        files = data.get('files', [])
        for f in files:
            print(f.get('name', ''))

    elif field == "file_count":
        print(data.get('count', 0))

    elif field == "has_files":
        print("true" if data.get('count', 0) > 0 else "false")

    elif field == "success":
        print("true" if data.get('success') else "false")

    elif field == "file_details":
        files = data.get('files', [])
        for f in files:
            print(f"{f.get('name', 'unknown')}|{f.get('size', 0)}|{f.get('sizeFormatted', '0 KB')}")

    else:
        print(f"Unknown field: {field}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()