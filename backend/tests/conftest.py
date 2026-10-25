"""Test-wide settings. These run before the app is imported."""

import os

# The suite makes far more requests than one visitor ever would. The limiter has its own tests in test_deployment.py.
os.environ.setdefault("VOXSHIELD_RATE_LIMIT_PER_MINUTE", "0")
os.environ.setdefault("VOXSHIELD_PRELOAD_MODELS", "false")
