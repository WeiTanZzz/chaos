# ClickHouse cheatsheet

Run ClickHouse as a container. Assumes Docker is installed (see `../../docker`).

## Run

```sh
docker run -d --name clickhouse \
  --ulimit nofile=262144:262144 \
  -p 8123:8123 -p 9000:9000 \
  -e CLICKHOUSE_USER=admin \
  -e CLICKHOUSE_PASSWORD=changeme \
  -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
  -v ch-data:/var/lib/clickhouse \
  clickhouse/clickhouse-server
```

- `--ulimit nofile` — ClickHouse needs a high file-descriptor limit.
- `-v ch-data:...` — named volume keeps data on the VM disk (fast); survives restarts.
- Ports: `8123` HTTP, `9000` native TCP.

## Connect

```sh
# native client inside the container
docker exec -it clickhouse clickhouse-client --user admin --password changeme

# over HTTP from the host
curl -u admin:changeme 'http://localhost:8123/' --data 'SELECT version()'
```

## Docker Compose (alternative)

`compose.yaml`:

```yaml
services:
  clickhouse:
    image: clickhouse/clickhouse-server
    ports:
      - "8123:8123"
      - "9000:9000"
    environment:
      CLICKHOUSE_USER: admin
      CLICKHOUSE_PASSWORD: changeme
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1"
    ulimits:
      nofile: 262144
    volumes:
      - ch-data:/var/lib/clickhouse

volumes:
  ch-data:
```

```sh
docker compose up -d
docker compose logs -f clickhouse
docker compose down          # add -v to also delete the data volume
```

## Manage

```sh
docker logs -f clickhouse
docker stop clickhouse && docker start clickhouse
docker rm -f clickhouse      # remove container (named volume ch-data is kept)
docker volume rm ch-data     # delete the data
```
