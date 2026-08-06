# E2E Test Infra: AI Trader VWAP Mean Reversion Upgrade

## Test Philosophy
- Requirement-driven, opaque-box testing verifying all criteria from `ORIGINAL_REQUEST.md`.
- Systematic 4-tier methodology (Feature Coverage, Boundary/Corner Cases, Cross-Feature Combinations, Real-World Workload Scenarios).

## Feature Inventory & Test Matrix
| # | Feature | Requirement | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Cross-Feature) | Tier 4 (Scenario) |
|---|---------|-------------|:-----------------:|:-----------------:|:---------------------:|:-----------------:|
| 1 | R1 Macro Regime Filter | ADX >= 25 or Hurst > 0.55 disables signals | 5 | 5 | ✓ | ✓ |
| 2 | R2 Time-of-Day Filter | Signals before 10:15 AM ET ignored | 5 | 5 | ✓ | ✓ |
| 3 | R3 Band Squeeze Check | Target price - Entry price > 1.5 * ATR required | 5 | 5 | ✓ | ✓ |
| 4 | R4 Scale-Out Engine | 50% TP at 1 SD, Breakeven SL, 50% TP at VWAP | 5 | 5 | ✓ | ✓ |
| 5 | R4 Fractional Rounding | Exact step size accounting without dust | 5 | 5 | ✓ | ✓ |

## Test Architecture
- **Master Test Runner**: `node test-all.js` (runs all unit test modules).
- **Synthetic E2E Runner**: `node test-vwap-e2e.js` (simulates streaming market bar feed across full day sessions, testing R1, R2, R3, R4 state machine transitions).

## Coverage Goals
- Tier 1: >= 5 test cases per feature (Total 25+)
- Tier 2: >= 5 boundary test cases per feature (Total 25+)
- Tier 3: Cross-feature interaction test cases (Total 10+)
- Tier 4: Real-world application scenarios (Total 5+)
- Total suite minimum: 65+ automated verification checks.
