.PHONY: run

run:
	@if [ -n "$$(docker compose --profile full ps -q 2>/dev/null)" ]; then \
		echo "Stopping running containers..."; \
		docker compose --profile full down; \
	fi
	docker compose --profile full up --build
