.PHONY: lint install uninstall

lint:
	shellcheck opchain install.sh uninstall.sh

install:
	./install.sh

uninstall:
	./uninstall.sh
