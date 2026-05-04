# Handled Web

Docker-versie van de SwiftUI-app `Handled`, bedoeld voor privegebruik op een eigen server.

## Wat zit erin

- Taken met herhaalinterval: dagen, weken, maanden, jaren
- Categorieen met kleur en icoonlabel
- Statussen: nog niet gestart, op schema, bijna weer nodig, te laat
- `Net gedaan` actie met nieuwe volgende datum om 09:00 lokale tijd
- Logboek per taak met gemiddelde tijd tussen acties en gemiddeld te laat
- Login met aparte overzichten per gebruiker
- Taken delen met andere gebruikers via e-mailadres
- JSON-opslag in `/data/handled.json`

## Bestanden

```text
.
├── Dockerfile
├── docker-compose.yml
├── package.json
├── server.js
├── public/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── handled.png
└── README.md
```

## Lokaal draaien

```sh
npm start
```

De app draait standaard op `http://localhost:3000`.

Je kunt de poort aanpassen met:

```sh
PORT=8080 npm start
```

## Docker Compose

```sh
docker compose up -d --build
```

Daarna is de app bereikbaar op:

```text
http://<server-ip>:8005
```

Logs bekijken:

```sh
docker compose logs -f
```

Stoppen:

```sh
docker compose down
```

## Proxmox

1. Maak of gebruik een Linux VM/LXC met Docker en Docker Compose.
2. Clone deze GitHub repo naar de server, bijvoorbeeld naar `/opt/handled`.
3. Start de container:

```sh
cd /opt/handled
docker compose up -d --build
```

De data staat in het Docker volume `handled-data`. Voor een bind mount kun je in `docker-compose.yml` dit gebruiken:

```yaml
volumes:
  - ./data:/data
```

Dan staat je databasebestand op de host in `/opt/handled/data/handled.json`.

## GitHub uploaden

Vanaf deze map:

```sh
git init
git add .
git commit -m "Initial Docker web version of Handled"
git branch -M main
git remote add origin git@github.com:<jouw-gebruiker>/<jouw-repo>.git
git push -u origin main
```

Gebruik bij voorkeur een private repo als je deze app alleen prive gebruikt.

## Accounts

Registratie staat standaard aan:

```yaml
ALLOW_REGISTRATION=true
```

Zet dit na het aanmaken van je gewenste accounts eventueel op `false` in `docker-compose.yml`.
Oude taken uit een eerdere single-user versie worden automatisch gekoppeld aan de eerste gebruiker die registreert.

## Backup

Backup minimaal dit bestand of het Docker volume:

```text
/data/handled.json
```

Bij een bind mount is dat:

```text
/opt/handled/data/handled.json
```

## Niet committen

Deze bestanden/mappen horen niet in GitHub:

```text
data/
node_modules/
.env
```
