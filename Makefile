NAME=restore-geometry
DOMAIN=upsuper.org

.PHONY: all pack install clean

all: dist/extension.js

node_modules/.modules.yaml: pnpm-lock.yaml
	pnpm install

dist/extension.js: node_modules/.modules.yaml src/*.ts
	pnpm build

$(NAME).zip: metadata.json schemas/*.gschema.xml dist/*.js
	rm -f $(NAME).zip
	zip $(NAME).zip -9j dist/*.js
	zip $(NAME).zip -9r metadata.json schemas/*.gschema.xml

pack: $(NAME).zip

install: $(NAME).zip
	gnome-extensions install --force $(NAME).zip

clean:
	rm -rf dist node_modules $(NAME).zip
