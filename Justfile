set shell := ["bash", "-euo", "pipefail", "-c"]

default: help

help:
    @just --list

test:
    bun test

test-unit:
    bun run test:unit

test-integration:
    bun run test:integration

lint:
    bun run lint

format:
    bun run format

typecheck:
    bun run typecheck

build:
    bun run build

install-local:
    bun run install-local

prepare:
    bun run prepare

check: test-unit test-integration lint typecheck

ci: test-unit test-integration lint typecheck build

docs:
    @printf 'Read order:\n'
    @printf '  1. README.md\n'
    @printf '  2. SECURITY.md\n'
    @printf '  3. ROADMAP.md\n'
    @printf '  4. MIGRATION.md\n'
    @printf '  5. PACKAGING.md\n'
    @printf '  6. EXECUTION_CHECKLIST.md\n'

readme:
    @cat README.md

security:
    @cat SECURITY.md

roadmap:
    @cat ROADMAP.md

checklist:
    @cat EXECUTION_CHECKLIST.md

next:
    @awk '/^## Immediate next action/{flag=1} flag{print}' EXECUTION_CHECKLIST.md

open-items:
    @rg '^- \[ \]' EXECUTION_CHECKLIST.md || true

docs-check:
    @rg -n 'TODO|TBD|XXX' README.md SECURITY.md ROADMAP.md MIGRATION.md PACKAGING.md EXECUTION_CHECKLIST.md || true
