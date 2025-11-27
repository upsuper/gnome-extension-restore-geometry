NAME=restore-geometry
DOMAIN=upsuper.org

.PHONY: all pack install clean

all: dist/extension.js

node_modules/.modules.yaml: pnpm-lock.yaml
	pnpm install

dist/extension.js: node_modules/.modules.yaml src/*.ts
	pnpm build

$(NAME).zip: dist/extension.js
	@cp -r schemas dist/
	@cp metadata.json dist/
	@(cd dist && zip ../$(NAME).zip -9r .)

pack: $(NAME).zip

install: $(NAME).zip
	gnome-extensions install --force $(NAME).zip

clean:
	@rm -rf dist node_modules $(NAME).zip