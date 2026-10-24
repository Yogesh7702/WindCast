.PHONY: help install etl dev-api dev-ui build test docker-up docker-down refresh clean

PY ?= python3
VENV ?= .venv
DATA_DIR ?= $(CURDIR)/data/snapshot

help:            ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install:         ## create venv, install python + node deps
	$(PY) -m venv $(VENV)
	$(VENV)/bin/pip install -r backend/requirements-dev.txt
	cd frontend && npm install

etl:             ## re-pull FUELHH + WINDFOR from Elexon and rebuild the snapshot
	$(VENV)/bin/python -m backend.app.etl

dev-api:         ## run FastAPI with reload on :8000
	DATA_DIR=$(DATA_DIR) $(VENV)/bin/uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000

dev-ui:          ## run the Vite dev server on :5173 (proxies /api to :8000)
	cd frontend && npm run dev

build:           ## production build of the SPA
	cd frontend && npm run build

test:            ## run the backend test suite
	DATA_DIR=$(DATA_DIR) $(VENV)/bin/python -m pytest

docker-up:       ## docker compose build + start (UI on :8080, API on :8000)
	docker compose up --build -d
	docker compose ps

docker-down:     ## stop the stack
	docker compose down

refresh:         ## ask the running API to refresh its snapshot from Elexon
	curl -s -X POST http://localhost:8000/api/admin/refresh | head -c 800; echo

clean:           ## remove build artefacts
	rm -rf frontend/dist frontend/node_modules .pytest_cache
