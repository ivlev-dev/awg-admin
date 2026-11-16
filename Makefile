up:
	docker compose up -d --build

up-worker:
	docker compose --profile worker up -d --build

down:
	docker compose down

clean:
	docker compose down -v --remove-orphans

ps:
	docker compose ps

logs:
	docker compose logs -f

dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

build:
	docker compose --profile worker build

health:
	curl -fsS http://127.0.0.1:8080/api/v1/health

test-backend:
	cargo test --workspace

test-frontend:
	cd frontend && pnpm test

fmt:
	cargo fmt --all

node-token:
	@echo "Создайте ноду через POST /api/v1/nodes и сохраните id/token в .env (AWG_NODE_ID, AWG_NODE_TOKEN)."
