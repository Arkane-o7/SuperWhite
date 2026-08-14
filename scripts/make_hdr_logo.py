#!/usr/bin/env python3
"""Backward-compatible entry point; use make_hdr_image.py for new workflows."""

from make_hdr_image import main


if __name__ == "__main__":
    raise SystemExit(main())
