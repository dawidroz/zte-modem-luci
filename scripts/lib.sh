#!/usr/bin/env bash
#
# Wspolne dla deploy.sh i build-pkg.sh.
#
# Istnieje po to, zeby reguly trybow plikow byly w JEDNYM miejscu. Rozjazd
# miedzy wdrozeniem przez ssh a pakietem byl by cichy i grozny: /etc/config
# trzyma haslo do modemu, wiec 0644 zamiast 0600 wystawia je kazdemu na
# routerze, a backend rpcd bez bitu wykonywalnosci po prostu sie nie rejestruje
# (objaw: brak obiektu ubus, wyglada na blad instalacji).

# Tryb wynika ze sciezki DOCELOWEJ, nie z uprawnien w repozytorium.
mode_for() {
	case "$1" in
		/usr/libexec/rpcd/*) echo 0755 ;;
		/etc/config/*)       echo 0600 ;;
		*)                   echo 0644 ;;
	esac
}
