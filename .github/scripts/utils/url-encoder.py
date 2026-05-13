#!/usr/bin/env python3
"""URL encoder utility - encodes a string for safe use in URLs."""
import sys
import urllib.parse

def urlencode(value: str, safe: str = '') -> str:
    """URL-encode a string value."""
    return urllib.parse.quote(value, safe=safe)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: url-encoder.py <string_to_encode> [safe_chars]", file=sys.stderr)
        sys.exit(1)
    
    value = sys.argv[1]
    safe = sys.argv[2] if len(sys.argv) > 2 else ''
    print(urlencode(value, safe))