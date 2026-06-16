.PHONY: build build-linux test clean

BINARY     = jrti-oracle-query
ENTRY      = .
GOFLAGS    = -trimpath -ldflags="-s -w"

# Windows .exe (production target)
build:
	GOOS=windows GOARCH=amd64 CGO_ENABLED=1 \
	CC=x86_64-w64-mingw32-gcc \
	go build $(GOFLAGS) -o $(BINARY).exe $(ENTRY)

# Linux binary (for local testing on Mac/Linux)
build-linux:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=1 \
	go build $(GOFLAGS) -o $(BINARY) $(ENTRY)

# Run all tests (requires Oracle Instant Client for executor_test integration)
test:
	go test ./...

# Remove generated binaries
clean:
	rm -f $(BINARY) $(BINARY).exe
