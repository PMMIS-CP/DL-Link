#!/usr/bin/env python3
"""
Parse navigator JSON output and extract URLs.
Usage: echo '<json>' | python3 parse-result.py <field>
Fields: direct_urls | extracted_links | header_urls | all_unique
"""

import sys
import json

def main():
    if len(sys.argv) < 2:
        print("Usage: parse-result.py <field>", file=sys.stderr)
        sys.exit(1)

    field = sys.argv[1]
    
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if field == "direct_urls":
        urls = data.get('directUrls', [])
        for u in urls:
            print(u)

    elif field == "extracted_links":
        links = data.get('extractedLinks', [])
        for l in links:
            print(l)

    elif field == "header_urls":
        urls = data.get('detectedFromHeaders', [])
        for u in urls:
            print(u)

    elif field == "all_unique":
        direct = set(data.get('directUrls', []))
        extracted = set(data.get('extractedLinks', []))
        headers = set(data.get('detectedFromHeaders', []))
        all_urls = direct | extracted | headers
        for u in sorted(all_urls):
            print(u)

    elif field == "has_direct":
        direct = data.get('directUrls', [])
        print("true" if direct else "false")

    elif field == "mode":
        print(data.get('mode', 'unknown'))

    elif field == "success":
        print("true" if data.get('success') else "false")

    elif field == "error":
        print(data.get('error', ''))

    else:
        print(f"Unknown field: {field}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()