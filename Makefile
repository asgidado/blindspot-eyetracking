.PHONY: setup test lint build dev phantoms films report typecheck e2e api web clean

setup:            ## install JS + Python deps, generate phantoms, copy local model assets
	npm install --no-audit --no-fund
	uv sync
	$(MAKE) phantoms
	uv run python -m mock.api.assets

test:             ## unit tests (TS + Python) and the boundary test
	npx vitest run
	uv run pytest

typecheck:
	npx tsc -p tsconfig.json --noEmit
	npx tsc -p mock/web/tsconfig.json --noEmit

lint:
	npx oxlint packages shared mock/web/src tests
	uv run ruff check .
	uv run ruff format --check .

build:            ## production build of the mock web app
	npm run build

dev:              ## mock API (:8000) + mock web (:5173)
	@trap 'kill 0' INT TERM; \
	uv run uvicorn mock.api.main:app --reload --port 8000 & \
	npm run dev -w mock/web; wait

api:
	uv run uvicorn mock.api.main:app --reload --port 8000

web:
	npm run dev -w mock/web

phantoms:         ## regenerate the committed synthetic phantom cases
	uv run python -m mock.phantoms.generate

films:            ## OPTIONAL: fetch 20 real ChestX-Det films into data/films/ (asks you to accept the dataset terms)
	uv sync --extra films
	uv run python -m mock.films.fetch

report:           ## reports/AGREEMENT.md from exported study sessions (make demo-sessions first if you have none)
	uv run python -m gaze_analysis.report sessions/*.json

e2e:
	npx playwright test

clean:
	rm -rf node_modules .venv dist mock/web/dist

demo-sessions:    ## write 4 SYNTHETIC scripted study sessions into sessions/ (for make report / recorded replay demos)
	uv run python -m mock.api.scripted_sessions 4
