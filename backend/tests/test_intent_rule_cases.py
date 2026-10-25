"""Regression cases for the scam rules. Developer-written, not real-world evaluation data (see the file's _note)."""

import json
from pathlib import Path

import pytest

from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from tests.helpers import transcript_of

DATA = json.loads((Path(__file__).parent / "data" / "intent_cases.json").read_text())
analyzer = RuleBasedScamIntentAnalyzer()


@pytest.mark.parametrize("case", DATA["cases"], ids=lambda c: c["id"])
def test_rule_regression_case(case):
    result = analyzer.analyze(transcript_of(case["text"]))
    assert result.risk in case["expect_risk"], (result.risk, [i.excerpt for i in result.indicators])
    assert set(case["expect_categories"]) <= set(result.categories)
    if not case["expect_categories"]:
        assert result.categories == []
    for item in result.indicators:
        assert item.excerpt in case["text"]
