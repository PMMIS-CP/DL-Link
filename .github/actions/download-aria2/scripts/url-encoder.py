#!/usr/bin/env python3
"""URL encoder for download actions."""
import sys
import urllib.parse

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(1)
    print(urllib.parse.quote(sys.argv[1], safe=''))