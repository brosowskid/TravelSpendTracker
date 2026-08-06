# 🌍 TallyAway

Deine persönliche Reise-Ausgaben-App: Ausgaben in Sekunden erfassen — offline,
mit automatischer Währungsumrechnung, Budget-Übersicht und CSV-Export für Excel.
Läuft als Web-App auf iPhone **und** Android, ohne App Store, ohne Abo.

**Die App ist live:** <https://brosowskid.github.io/TravelSpendTracker/>

## Aufs Handy bringen

1. Die Adresse oben auf dem Handy im Browser öffnen.
2. **iPhone (Safari):** Teilen-Symbol → „Zum Home-Bildschirm"
   **Android (Chrome):** Menü ⋮ → „App installieren"
3. Fertig — die App startet ab jetzt wie eine normale App, auch offline.

Updates lädt die App im Hintergrund und meldet sich dann selbst mit
„Neue Version verfügbar — Neu laden".

## Was sie kann

- ⚡ Ausgabe erfassen in 3–4 Taps: Betrag → Währung → Kategorie → fertig;
  Erstattungen (z. B. Kaution zurück) als negative Beträge
- 💱 160+ Währungen mit Suche, Kurse automatisch (offline: letzter Kurs);
  Kurs pro Ausgabe nachträglich korrigierbar
- 📊 Budget-Ring mit Warnungen (75 % / 90 % / überschritten), Tagesdurchschnitt,
  Ausgaben-Verlauf über die ganze Reise, Kategorien-Auswertung, vorab gebuchte
  Kosten (Flüge etc.) getrennt vom Vor-Ort-Verbrauch
- 📈 Statistik über alle Reisen: Jahresfilter, Vergleich pro Reise,
  besuchte Länder, teuerste Reise
- 🔍 Ausgabenliste mit Suche, Kategorie- und Länder-Filter; Löschen mit
  „Rückgängig"; Ausgaben zwischen Reisen verschiebbar
- 🌍 Beliebig viele Reisen, auch mit mehreren Reisezielen — jedes Ziel bringt
  seine Währung als Chip mit, Auswertung „Nach Land" inklusive
- ⚙️ Einstellungen pro Reise (Budget, Datum, Reisende, Ziele) unter Reisen → ✎;
  global (Design, Heimatwährung, Export, Backup) übers ⚙️-Symbol
- 👥 Reisende pro Reise: wer hat bezahlt, wer schuldet wem wie viel
- 🌗 Hell / Dunkel / Automatisch
- 📤 CSV-Export („Excel DE" mit Semikolon & Dezimalkomma), Zusammenfassungs-
  Export pro Reise, JSON-Backup & -Wiederherstellung

## Wichtig zu wissen

Die Daten liegen **nur auf deinem Gerät** (kein Konto, kein Server). Die App
erinnert dich von selbst ans Sichern; ein Backup geht jederzeit über
⚙️ → Backup. Beim Wiederherstellen kannst du wählen, ob die Reisen aus dem
Backup **hinzugefügt** werden oder alles **ersetzen** — so lassen sich auch
Daten von einem zweiten Handy zusammenführen.

## Lokal ausprobieren & testen

```bash
python -m http.server 8080     # Windows; auf macOS/Linux: python3
# dann im Browser: http://localhost:8080

npm install playwright         # einmalig, nur für die Tests
node smoke.test.mjs            # Ende-zu-Ende-Test mit Screenshots
node upgrade.test.mjs          # Kurs-Upgrade-Regel
node countries.test.mjs        # Länderliste & Kurs-Abdeckung
node features.test.mjs         # Erstattungen, Verschieben, Undo, Import u. a.
```
