.PHONY: build build-cross build-linux dist test clean

BINARY   = jrti-oracle-query
ENTRY    = .
GOFLAGS  = -trimpath -ldflags="-s -w"
IC_DIR   = instantclient_19_30
DIST_DIR = dist

# Native Windows build (requires GCC from MinGW-w64 in PATH)
build:
	CGO_ENABLED=1 go build $(GOFLAGS) -o $(BINARY).exe $(ENTRY)

# Portable distribution: jrti-oracle-query.exe + Oracle DLLs in dist/
# Just copy dist/ to any Windows machine — no Oracle install needed
dist: build
	mkdir -p $(DIST_DIR)
	cp $(BINARY).exe $(DIST_DIR)/
	cp $(IC_DIR)/*.dll $(DIST_DIR)/
	@echo "Portable package ready in $(DIST_DIR)/"

# Cross-compile from Linux/Mac to Windows using MinGW
build-cross:
	GOOS=windows GOARCH=amd64 CGO_ENABLED=1 \
	CC=x86_64-w64-mingw32-gcc \
	go build $(GOFLAGS) -o $(BINARY).exe $(ENTRY)

# Linux binary (for testing on Mac/Linux)
build-linux:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=1 \
	go build $(GOFLAGS) -o $(BINARY) $(ENTRY)

# Run all tests
test:
	go test ./...

# Remove generated binaries and dist/
clean:
	rm -f $(BINARY) $(BINARY).exe
	rm -rf $(DIST_DIR)
