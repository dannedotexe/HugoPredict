# HugoPredict

Ein Prediction Market im Stil von Polymarket – nur für **Hugo SMP**. Spieler zahlen Ingame-Geld an einen Mineflayer-Bot, das Geld landet als Guthaben auf der Website und kann auf Clan Fights, die nächste Meta, Server-Events oder Real-Life-Ereignisse gesetzt werden. Gewinne lassen sich jederzeit wieder ingame auszahlen.

## Wie es funktioniert

1. **Account erstellen** auf der Website.
2. **Minecraft verknüpfen:** In der Wallet einen Code erzeugen und ingame `/msg <Bot> verify <CODE>` schreiben.
3. **Einzahlen:** Ingame `/pay <Bot> <Betrag>`. Der Bot erkennt die Zahlung und schreibt sie gut.
4. **Wetten:** Anteile eines Outcomes kaufen. Der Preis (z.B. 63¢) ist die Wahrscheinlichkeit, die die Community dem Outcome gibt. Gewinnt das Outcome, zahlt jeder Anteil 1 $.
5. **Auszahlen:** In der Wallet anfordern – der Bot führt `/pay <Spieler> <Betrag>` aus.

Preise werden mit einem **LMSR Market Maker** berechnet (wie in vielen Prediction Markets). Man kann also jederzeit kaufen und verkaufen, auch ohne Gegenpartei. Das Haus stellt die Liquidität; der maximale Verlust pro Markt ist `b · ln(Anzahl Outcomes)` (bei `b = 100` und Ja/Nein ca. 69 $). Eine kleine Gebühr (`FEE_PERCENT`) gleicht das aus.

## Setup

Voraussetzung: **Node.js 22.13+** (nutzt das eingebaute `node:sqlite`).

```bash
npm install
cp .env.example .env     # Werte anpassen
npm run seed             # optional: Demo-Märkte
npm start                # http://localhost:3000
```

Wer in `ADMIN_USERS` steht, sieht nach dem Registrieren den **Admin**-Tab: Märkte erstellen, schließen, auflösen (zahlt Gewinner automatisch aus), stornieren (erstattet Einsätze) und Guthaben manuell anpassen.

## Bot einrichten

In `.env`:

```
BOT_ENABLED=true
MC_HOST=<Hugo SMP Adresse>
MC_USERNAME=<Bot-Account>
MC_AUTH=microsoft
```

Beim ersten Start fragt Mineflayer nach einem Microsoft-Login (Code im Terminal).

**Zahlungsnachrichten:** Jeder Server formuliert „Du hast Geld erhalten“ anders. Standardmäßig erkennt der Bot u.a. die EssentialsX-Meldungen. Passt das nicht:

1. `LOG_CHAT=true` setzen, Bot starten und ihm ingame 1 $ schicken.
2. Die Zeile im Log suchen, z.B. `[chat:system] Du hast $1 von Steve erhalten.`
3. Ein Muster in `DEPOSIT_PATTERNS` eintragen, z.B.
   `^Du hast \$(?<amount>[\d.,]+) von (?<player>\w+) erhalten\.$`

Muster sollten mit `^` beginnen. Nachrichten aus dem normalen Spieler-Chat werden ignoriert, damit niemand Zahlungen faken kann.

Auszahlungen gehen über `PAY_COMMAND` (Standard `/pay {player} {amount}`), eine pro 4 Sekunden.

## Projektstruktur

```
src/server.js    Express-API + statische Website
src/services.js  Accounts, Wallet, Märkte, Trades, Auflösung
src/lmsr.js      Preisformel (auch im Browser genutzt)
src/bot.js       Mineflayer-Bot: Einzahlungen, Verknüpfen, Auszahlungen
src/db.js        SQLite-Schema
public/          Frontend (Vanilla JS, kein Build-Schritt)
test/            npm test
```

## Hinweise

- Fan-Projekt, nicht offiziell mit Hugo SMP verbunden. Kläre vorher mit den Server-Admins, ob ein Wett-Bot erlaubt ist.
- Gewettet wird nur mit Ingame-Geld. Kein Echtgeld, kein Handel von Ingame-Geld gegen Echtgeld.
- Der Bot braucht genug Ingame-Geld, um Auszahlungen und den Markt-Subsidy zu decken. Schlägt ein `/pay` ingame fehl, merkt der Bot das nicht automatisch – behalte die Auszahlungen im Admin-Tab im Blick.
