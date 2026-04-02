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
- Poziomy nauczania — zakres lat i liczba klas na rok, automatyczne generowanie nazw (np. 1a, 1b, 2a…)
- Grupy (podgrupy klasy) z łączeniem międzyklasami
- Liczba uczniów
- Wychowawca, sale gospodarz

**Nauczyciele:**
- Pensum i nadgodziny stałe
- Wymiar etatu (pełny, pół, inny ułamek)
- Auto-skrót (pierwsza litera imienia + 4 litery nazwiska; dla dwuczłonowych: 2+2)
- Uprawnienia do przedmiotów
- Przydział godzin do klas i przedmiotów
- Typ: nauczyciel przedmiotu lub specjalista (bibliotekarz, logopeda, psycholog, pedagog itp.)
- Nauczanie indywidualne

**Przedmioty:**
- Kolor, skrót (auto-generowany: jedno słowo → 3 litery, wielosłowowe → pierwsze litery + pełne spójniki)
- Godziny w tygodniu (na klasę)
- Czas realizacji (cały rok / semestr 1 / semestr 2)
- Pozycja w planie (dowolnie / na początku / na końcu)
- Przedmiot opcjonalny (religia, etyka)
- Tylko dla grup (nie cała klasa)
- Dane stałe (nie zmieniają się między latami)

**Sale:**
- Typ (pełna klasa, grupowa, indywidualna, specjalistyczna)
- Pojemność
- Przypisanie do budynku i piętra
- Opiekunowie, preferowane przedmioty (np. sala komputerowa → Informatyka)

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
| 1 — Rok szkolny | Nowy rok lub kontynuacja z kopiowaniem danych z poprzedniego roku |
| 2 — Szkoła | Nazwa, adres, telefon, e-mail, dane stałe + przedmioty z godzinami, semestrami, pozycją w planie |
| 3 — Klasy | Poziomy nauczania (zakres lat, klasy na rok), automatyczne generowanie nazw, liczba uczniów |
| 4 — Nauczyciele | Imię, nazwisko, auto-skrót, pensum, uprawnienia do przedmiotów, przydziały godzin, typ (przedmiot/specjalista) |
| 5 — Budynki i sale | Budynki z piętrami/segmentami + sale z typem, pojemnością i przypisaniem do budynku |
| 6 — Godziny | Ręczne dodawanie lub generator automatyczny, różne długości przerw, lekcje od godziny 0 |
| 7 — Grupy | Grupy w klasach, grupy łączone międzyklasami, uczniowie NI/rewalidacja/logopeda |

Kreator **autozapisuje** postęp — można bezpiecznie zamknąć przeglądarkę i wrócić do konfiguracji.

---

### 🔒 Prywatność i dane

Aplikacja **nie zbiera, nie wysyła ani nie przechowuje** żadnych danych zewnętrznie. Wszystkie dane wyłącznie w `localStorage` przeglądarki.

| Klucz | Zawartość |
|-------|-----------|
| `pl_state` | Konfiguracja szkoły (klasy, nauczyciele, sale, przedmioty, godziny, budynki, NI) |
| `pl_sched` | Ułożony plan lekcji |
| `pl_wiz` | Autozapis kreatora |
| `pl_theme` | Wybrany motyw (ciemny/jasny) |
| `pl_consent` | Potwierdzenie informacji o danych |
| `pl_sched_generated` | Backup ostatnio wygenerowanego planu (ze statystykami) |

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
2. Wybierz **✨ Nowy plan** i przejdź przez kreator (7 kroków):
   - **Rok szkolny** — nowy rok lub kontynuacja z kopiowaniem danych
   - **Szkoła** — dane kontaktowe + przedmioty z godzinami
   - **Klasy** — poziomy nauczania, automatyczne generowanie
   - **Nauczyciele** — dane, uprawnienia, przydziały
   - **Budynki i sale** — lokalizacje i sale lekcyjne
   - **Godziny** — harmonogram zajęć
   - **Grupy** — grupy w klasach, łączone, NI
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
