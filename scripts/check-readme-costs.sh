#!/usr/bin/env bash
set -euo pipefail

# Validates that the README.md "Unit costs catalog" table matches src/db/seed.ts.
# Checks: every seed cost name + value appears in README, and vice-versa.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED="$ROOT/src/db/seed.ts"
README="$ROOT/README.md"

errors=0

# --- Extract costs from seed.ts ---
# Produces lines like: apollo-search-credit 0.0000000000
# Extract name lines and cost lines separately, then pair them
seed_names_arr=$(grep 'name:' "$SEED" | sed -n 's/.*name: "\([^"]*\)".*/\1/p')
seed_vals_arr=$(grep 'costPerUnitInUsdCents:' "$SEED" | sed -n 's/.*costPerUnitInUsdCents: "\([^"]*\)".*/\1/p')
seed_costs=$(paste <(echo "$seed_names_arr") <(echo "$seed_vals_arr") | awk '{print $1, $2}' | sort)

if [ -z "$seed_costs" ]; then
  echo "ERROR: Could not extract any costs from $SEED"
  exit 1
fi

# --- Extract costs from README table ---
# Table rows look like: | `name` | 0.0005 | ... | Provider | plan | billing |
readme_costs=$(sed -n '/^| Name /,/^$/p' "$README" \
  | grep '^ *|.*`' \
  | sed 's/^ *| *`\([^`]*\)` *| *\([0-9.]*\).*/\1 \2/' \
  | sort)

if [ -z "$readme_costs" ]; then
  echo "ERROR: Could not extract any costs from README table"
  exit 1
fi

# --- Normalize seed values (strip trailing zeros for comparison) ---
normalize() {
  echo "$1" | awk '{
    name = $1
    val = $2 + 0  # force numeric to drop trailing zeros
    printf "%s %.10f\n", name, val
  }' | sort
}

seed_normalized=$(normalize "$seed_costs")
readme_normalized=$(normalize "$readme_costs")

# --- Compare names ---
seed_names=$(echo "$seed_costs" | awk '{print $1}' | sort)
readme_names=$(echo "$readme_costs" | awk '{print $1}' | sort)

missing_from_readme=$(comm -23 <(echo "$seed_names") <(echo "$readme_names"))
extra_in_readme=$(comm -13 <(echo "$seed_names") <(echo "$readme_names"))

if [ -n "$missing_from_readme" ]; then
  echo "ERROR: Costs in seed.ts but MISSING from README:"
  echo "$missing_from_readme" | sed 's/^/  - /'
  errors=$((errors + 1))
fi

if [ -n "$extra_in_readme" ]; then
  echo "ERROR: Costs in README but NOT in seed.ts:"
  echo "$extra_in_readme" | sed 's/^/  - /'
  errors=$((errors + 1))
fi

# --- Compare values ---
while IFS= read -r line; do
  name=$(echo "$line" | awk '{print $1}')
  seed_val=$(echo "$seed_normalized" | grep "^$name " | awk '{print $2}')
  readme_val=$(echo "$readme_normalized" | grep "^$name " | awk '{print $2}')
  if [ -n "$seed_val" ] && [ -n "$readme_val" ] && [ "$seed_val" != "$readme_val" ]; then
    echo "ERROR: Value mismatch for '$name': seed=$seed_val readme=$readme_val"
    errors=$((errors + 1))
  fi
done <<< "$seed_costs"

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "README.md is out of sync with src/db/seed.ts. Please update the Unit costs catalog table."
  exit 1
fi

echo "README costs table is in sync with seed.ts ($( echo "$seed_names" | wc -l | tr -d ' ') costs verified)"
