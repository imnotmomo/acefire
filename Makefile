SHELL := /bin/bash
PYTHON ?= backend/.venv/bin/python

.PHONY: help setup setup-backend setup-frontend test test-backend test-frontend build dev-backend dev-frontend

help:
	@printf '%s\n' \
	  'make setup          Install locked backend and frontend dependencies' \
	  'make test           Run the same backend/frontend checks as CI' \
	  'make build          Build the production frontend' \
	  'make dev-backend    Start the local API on port 8017' \
	  'make dev-frontend   Start Vite on port 5173'

setup: setup-backend setup-frontend

setup-backend:
	python3 -m venv backend/.venv
	"$(PYTHON)" -m pip install -r backend/requirements.lock

setup-frontend:
	npm --prefix frontend ci

test: test-backend test-frontend

test-backend:
	PYTHON="$(PYTHON)" bash scripts/ci/backend.sh

test-frontend:
	bash scripts/ci/frontend.sh

build:
	npm --prefix frontend run build

dev-backend:
	"$(PYTHON)" backend/run_local.py

dev-frontend:
	npm --prefix frontend run dev
