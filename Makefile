up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

build:
	docker compose build

test-backend:
	cargo test --workspace

test-frontend:
	cd frontend && pnpm test

fmt:
	cargo fmt --all

node-token:
	@echo "Создайте ноду через POST /api/v1/nodes и сохраните id/token в .env (AWG_NODE_ID, AWG_NODE_TOKEN)."
