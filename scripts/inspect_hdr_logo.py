#!/usr/bin/env python3
"""Backward-compatible entry point; use inspect_hdr_image.py for new workflows."""

from inspect_hdr_image import main


if __name__ == "__main__":
    raise SystemExit(main())
