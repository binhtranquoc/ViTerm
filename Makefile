VERSION ?= $(shell node -p "require('./src-tauri/tauri.conf.json').version")
APP_NAME ?= ViTerm.app
OUT_DIR ?= build-artifacts/$(VERSION)

# build thủ công truyền version
# make build-mac-arm64 VERSION=0.1.1

build-mac-arm64:
	pnpm tauri build --target aarch64-apple-darwin --bundles app
	mkdir -p "$(OUT_DIR)"
	rm -rf "$(OUT_DIR)/$(APP_NAME)"
	cp -R "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/$(APP_NAME)" "$(OUT_DIR)/"

build-mac-arm64-latest:
	pnpm tauri build --target aarch64-apple-darwin --bundles app
	mkdir -p build-artifacts
	rm -rf "build-artifacts/$(APP_NAME)"
	cp -R "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/$(APP_NAME)" "build-artifacts/"