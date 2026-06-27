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

demo:
    ./scripts/demo.sh

demo-keep:
    ./scripts/demo.sh --keep

prepare:
    bun run prepare

check: test-unit test-integration lint typecheck

ci: test-unit test-integration lint typecheck build

docs:
    @printf 'Read order:\n'
    @printf '  1. README.md\n'
    @printf '  2. SECURITY.md\n'
    @printf '  3. MIGRATION.md\n'
    @printf '  4. PACKAGING.md\n'

readme:
    @cat README.md

security:
    @cat SECURITY.md

docs-check:
    @rg -n 'TODO|TBD|XXX' README.md SECURITY.md MIGRATION.md PACKAGING.md || true
