# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS builder

WORKDIR /build

# Cache dependency downloads separately from source changes
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 → pure-Go build (no system libs needed in final image)
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o uets-server .

FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=builder /build/uets-server ./uets-server

# viewer.html is embedded in the binary; no extra COPY needed.
# /app/data is the persistent SQLite volume.
VOLUME /app/data

EXPOSE 5000

CMD ["./uets-server"]
