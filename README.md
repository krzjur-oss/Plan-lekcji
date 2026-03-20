# 📅 PlanLekcji — Układanie planów lekcji

Aplikacja PWA do układania i zarządzania planem lekcji szkolnych. Działa w całości w przeglądarce — **bez serwera, bez instalacji, bez zbierania danych**. Można ją zainstalować na komputerze lub tablecie jak aplikację natywną.

🔗 **Aplikacja:** https://krzjur-oss.github.io/Plan-lekcji/

---

## ✨ Funkcje

### 🚀 Strona powitalna

Przy pierwszym uruchomieniu wyświetla się strona powitalna z opcjami:

| Opcja | Opis |
|-------|------|
| ✨ Nowy plan | Kreator konfiguracji szkoły — 7 kroków |
| 📋 Kontynuuj | Wróć do istniejącego planu |
| 🔄 Wróć do kreatora | Kontynuuj przerwaną konfigurację (autozapis) |
| 📂 Importuj | Wczytaj plan z pliku `.json` |
| 🎓 Demo | Przykładowy plan szkoły — dane nie są zapisywane |

---

### 📚 Widoki planu

| Widok | Opis |
|-------|------|
| 📚 Klasy | Plan wybranej klasy — cały tydzień lub wybrany dzień |
| 👩‍🏫 Nauczyciele | Plan wybranego nauczyciela z widokiem wszystkich klas |
| 🏫 Sale | Obłożenie wybranej sali w ciągu tygodnia |
| 🔲 Macierz | Przegląd całej szkoły (Klasy × Godziny lub Nauczyciele × Godziny) |
| 🚨 Dyżury | Zarządzanie dyżurami nauczycieli na przerwach |
| 📊 Statystyki | Realizacja etatu, obciążenie nauczycieli, rozkład przedmiotów |
| ⚡ Generator | Automatyczne układanie planu z konfigurowalną listą warunków |
| ⚙️ Ustawienia | Konfiguracja szkoły, klas, nauczycieli, sal i godzin |

---

### ⚡ Generator planu

Automatyczny solver układający plan na podstawie zdefiniowanych warunków:

- **Dostępność nauczycieli** — blokady, okienka, godziny preferowane
- **Bloki lekcji** — podwójne lub potrójne godziny z rzędu
- **Pozycja przedmiotów** — WF na końcu dnia, religia na początku lub końcu (skrajne)
- **Podział na grupy** — równoległe lekcje dla grup klasy
- **Przedmioty opcjonalne** — religia/etyka z automatycznym podziałem grupy, możliwość łączenia małych grup między klasami
- **Analiza sal** — sprawdza czy liczba sal wystarczy na szczyt obłożenia
- **Max dziennie** — ograniczenie liczby wystąpień przedmiotu w ciągu dnia
- **Max dni z rzędu** — ograniczenie kolejnych dni z tym samym przedmiotem

Solver działa jako **Web Worker** (wątek w tle) — interfejs nie zamiera podczas generowania. Algorytm: Greedy + Simulated Annealing.

---

### 🏫 Konfiguracja szkoły

**Klasy:**
- Grupy (podgrupy klasy)
- Liczba uczniów
- Wychowawca, sale gospodarz
- Przedmioty opcjonalne (religia, etyka, mniejszości) z liczbą uczniów i łączeniem grup między klasami

**Nauczyciele:**
- Pensum i nadgodziny stałe
- Wymiar etatu (pełny, pół, inny ułamek)
- Przydział godzin do klas i przedmiotów
- Nauczanie indywidualne

**Przedmioty:**
- Kolor, skrót
- Czas realizacji (cały rok / semestr 1 / semestr 2)
- Przypisanie do konkretnych klas

**Sale:**
- Typ (pełna klasa, grupowa, indywidualna, specjalistyczna)
- Pojemność
- Przypisanie do budynku i piętra
- Opiekunowie, preferowane przedmioty (np. sala komputerowa → Informatyka)
- Ograniczenia wiekowe (sala dla klas 1–3)

---

### 🖨️ Drukowanie

Przycisk 🖨️ w topbarze otwiera panel drukowania:

- Aktualny widok
- Plan wybranej klasy / wszystkich klas po kolei
- Plan wybranego nauczyciela / wszystkich nauczycieli po kolei
- Macierz szkoły
- Statystyki

Wydruk zawiera nagłówek z nazwą szkoły, rokiem szkolnym i nazwą klasy/nauczyciela.

---

### 💾 Eksport i import danych

- **Eksportuj JSON** — pełna kopia zapasowa planu i konfiguracji
- **Importuj JSON** — wczytaj plan z pliku `.json`
- Tryb demo — przeglądaj przykładowy plan bez zapisywania zmian

---

### 🧙 Kreator konfiguracji (7 kroków)

| Krok | Zawartość |
|------|-----------|
| 1 — Szkoła | Nazwa szkoły, rok szkolny |
| 2 — Budynki | Budynki, piętra, segmenty (opcjonalne) |
| 3 — Klasy | Lista klas z grupami, import masowy |
| 4 — Przedmioty | Nazwy, skróty, kolory, import masowy |
| 5 — Nauczyciele | Imię, nazwisko, skrót, pensum, import masowy |
| 6 — Sale | Nazwa, typ, pojemność, budynek |
| 7 — Godziny | Harmonogram godzin lekcyjnych lub generator automatyczny |

Kreator **autozapisuje** postęp — można bezpiecznie zamknąć przeglądarkę i wrócić do konfiguracji.

---

### 🔒 Prywatność i dane

Aplikacja **nie zbiera, nie wysyła ani nie przechowuje** żadnych danych zewnętrznie. Wszystkie dane wyłącznie w `localStorage` przeglądarki.

| Klucz | Zawartość |
|-------|-----------|
| `pl_state` | Konfiguracja szkoły (klasy, nauczyciele, sale, przedmioty) |
| `pl_sched` | Ułożony plan lekcji |
| `pl_wiz` | Autozapis kreatora |
| `pl_theme` | Wybrany motyw (ciemny/jasny) |
| `pl_consent` | Potwierdzenie informacji o danych |

---

## 📲 PWA — instalacja jako aplikacja

### Chrome / Edge (Windows, Android)
Kliknij ikonę ⊕ w pasku adresu przeglądarki lub baner instalacji.

### Safari (iOS / macOS)
Udostępnij → **Dodaj do ekranu głównego**

### Po instalacji
- Pełny tryb offline — Service Worker cache'uje wszystkie pliki
- Działa jak aplikacja natywna — bez paska przeglądarki

---

## 📖 Jak zacząć

1. Otwórz aplikację → pojawi się strona powitalna
2. Wybierz **✨ Nowy plan** i przejdź przez kreator (7 kroków)
3. W Ustawieniach → Nauczyciele przypisz każdemu nauczycielowi klasy i godziny
4. Układaj plan ręcznie (przeciągaj lekcje) lub użyj Generatora
5. Regularnie eksportuj kopię zapasową: przycisk 💾 → **Eksportuj JSON**

---

## 🗂 Struktura repozytorium

```
Plan-lekcji/
├── index.html      # Cała aplikacja (HTML + CSS + JS, ~290 KB)
├── manifest.json   # PWA manifest
├── sw.js           # Service Worker (cache offline)
├── icon-*.png      # Ikony PWA (72–512 px)
├── LICENSE         # Licencja i prawa autorskie
├── REGULAMIN.md    # Regulamin korzystania z aplikacji
└── README.md       # Dokumentacja (ten plik)
```

---

## 🛠 Technologie

- **Frontend:** czysty HTML + CSS + JavaScript — zero zewnętrznych bibliotek
- **Dane:** `localStorage` przeglądarki
- **Offline:** Service Worker (Cache API)
- **Standard:** PWA (Web App Manifest)
- **Solver:** Web Worker + Greedy Algorithm + Simulated Annealing
- **Czcionki:** Syne (800) + DM Mono — Google Fonts

---

## ⚖️ Licencja i prawa autorskie

© 2025 Krzysztof Jureczek. Wszelkie prawa zastrzeżone.

Szczegółowe warunki użytkowania w pliku [`LICENSE`](LICENSE). Aplikacja przeznaczona wyłącznie do niekomercyjnego użytku w placówkach oświatowych.
