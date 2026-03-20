# 📄 Regulamin aplikacji PlanLekcji

**Wersja 1.0 · obowiązuje od 1 marca 2025 r.**

---

## §1. Postanowienia ogólne

Niniejszy Regulamin określa zasady korzystania z aplikacji internetowej **PlanLekcji — Układanie planów lekcji** (dalej: „Aplikacja"), udostępnianej pod adresem **https://krzjur-oss.github.io/Plan-lekcji/**.

Właścicielem i twórcą Aplikacji jest **Krzysztof Jureczek** (dalej: „Autor"). Korzystanie z Aplikacji jest równoznaczne z akceptacją niniejszego Regulaminu.

---

## §2. Przeznaczenie Aplikacji

Aplikacja przeznaczona jest wyłącznie do **niekomercyjnego użytku w placówkach oświatowych** (szkoły podstawowe, licea, technika, szkoły branżowe, przedszkola oraz inne placówki kształcenia). Umożliwia planowanie tygodniowego planu lekcji — przypisywanie nauczycieli, klas, sal i przedmiotów do poszczególnych godzin lekcyjnych.

---

## §3. Warunki korzystania

- Aplikacja jest bezpłatna i dostępna dla każdego użytkownika posiadającego dostęp do przeglądarki internetowej.
- Użytkownik zobowiązuje się korzystać z Aplikacji zgodnie z jej przeznaczeniem oraz obowiązującym prawem.
- Zabronione jest używanie Aplikacji w celach komercyjnych bez pisemnej zgody Autora.
- Zabronione jest podejmowanie działań mogących zakłócić działanie Aplikacji lub narazić innych użytkowników na szkodę.
- Użytkownik ponosi pełną odpowiedzialność za dane wprowadzone do Aplikacji.

---

## §4. Prawa autorskie i licencja

Wszelkie prawa do Aplikacji — w tym kod źródłowy, interfejs graficzny, projekt wizualny oraz dokumentacja — należą wyłącznie do Autora i są chronione przepisami prawa autorskiego (ustawa z dnia 4 lutego 1994 r. o prawie autorskim i prawach pokrewnych).

| | |
|---|---|
| ❌ **Zabronione** | Kopiowanie, modyfikowanie, dekompilowanie, rozpowszechnianie lub sprzedaż Aplikacji bądź jej części bez pisemnej zgody Autora |
| ✅ **Dozwolone** | Korzystanie z Aplikacji zgodnie z jej przeznaczeniem, zapisywanie i eksportowanie własnych danych, udostępnianie linku do Aplikacji innym osobom |

W sprawach licencjonowania komercyjnego prosimy o kontakt z Autorem poprzez repozytorium GitHub.

---

## §5. Dane i prywatność

Aplikacja **nie zbiera, nie przesyła ani nie przechowuje** żadnych danych użytkownika na zewnętrznych serwerach. Wszelkie dane przechowywane są wyłącznie lokalnie w pamięci przeglądarki użytkownika (`localStorage`) na jego urządzeniu.

### Zasady przetwarzania danych

- Dane **nie opuszczają** urządzenia użytkownika.
- Aplikacja **nie używa** plików cookie, narzędzi analitycznych, sieci reklamowych ani usług zewnętrznych (z wyjątkiem Google Fonts do ładowania czcionek Syne i DM Mono).
- Autor **nie ma dostępu** do żadnych danych wprowadzonych przez użytkownika.
- Użytkownik może w każdej chwili usunąć swoje dane, czyszcząc dane witryny w ustawieniach przeglądarki lub korzystając z funkcji „Resetuj całą aplikację" w Ustawieniach aplikacji.

### Klucze localStorage używane przez Aplikację

| Klucz | Zawartość | Kiedy zapisywany |
|-------|-----------|-----------------|
| `pl_state` | Konfiguracja szkoły (klasy, nauczyciele, sale, przedmioty, godziny) | Po każdej zmianie konfiguracji |
| `pl_sched` | Ułożony plan lekcji (przypisania lekcji do godzin) | Po każdej zmianie planu |
| `pl_wiz` | Autozapis kreatora konfiguracji | W trakcie korzystania z kreatora |
| `pl_theme` | Wybrany motyw kolorystyczny (ciemny/jasny) | Po zmianie motywu |
| `pl_consent` | Potwierdzenie zapoznania się z informacją o danych | Po kliknięciu „Rozumiem" |

### Dane osobowe nauczycieli

Plan lekcji zawiera imiona i nazwiska nauczycieli — stanowią one dane osobowe w rozumieniu RODO (Rozporządzenie Parlamentu Europejskiego i Rady (UE) 2016/679). Ponieważ dane są przetwarzane **wyłącznie lokalnie na urządzeniu użytkownika** i nie są przekazywane żadnej osobie trzeciej ani do żadnego serwera, zastosowanie ma wyłączenie z art. 2 ust. 2 lit. c RODO (przetwarzanie przez osobę fizyczną w ramach czynności o czysto osobistym lub domowym charakterze).

Użytkownik, który przetwarza dane nauczycieli w imieniu szkoły jako instytucji, jest zobowiązany do przestrzegania wewnętrznych procedur ochrony danych osobowych obowiązujących w danej placówce.

---

## §6. Odpowiedzialność

Aplikacja udostępniana jest w stanie „takim, jakim jest" (*as is*), bez jakichkolwiek gwarancji — w szczególności gwarancji przydatności do określonego celu, poprawności wygenerowanych planów ani nieprzerwanego działania.

- Autor nie ponosi odpowiedzialności za **utratę danych** wynikającą z wyczyszczenia danych przeglądarki, awarii urządzenia, aktualizacji systemu operacyjnego lub innych przyczyn niezależnych od Autora.
- Autor nie ponosi odpowiedzialności za **błędy w ułożonym planie lekcji** — w tym konflikty, naruszenie przepisów oświatowych lub inne nieprawidłowości wynikające z niepoprawnie wprowadzonych danych lub ograniczeń algorytmu generatora.
- Autor nie ponosi odpowiedzialności za szkody wynikające z **nieprawidłowego korzystania** z Aplikacji.

**Zalecenie:** Regularnie twórz kopie zapasowe danych za pomocą funkcji **Eksportuj JSON** dostępnej w topbarze aplikacji.

---

## §7. Dostępność i aktualizacje

- Autor dokłada starań, aby Aplikacja działała poprawnie i była dostępna przez całą dobę, jednak nie gwarantuje ciągłości działania.
- Autor zastrzega sobie prawo do **modyfikowania, aktualizowania lub zaprzestania** udostępniania Aplikacji w dowolnym momencie bez wcześniejszego powiadamiania.
- Aktualizacje Aplikacji są wdrażane automatycznie poprzez mechanizm Service Worker — użytkownik może być poproszony o odświeżenie strony w celu załadowania nowej wersji.

---

## §8. Zmiany Regulaminu

Autor zastrzega sobie prawo do zmiany niniejszego Regulaminu. O istotnych zmianach użytkownicy będą informowani poprzez komunikat wyświetlany w Aplikacji lub aktualizację niniejszego pliku. Dalsze korzystanie z Aplikacji po opublikowaniu zmian oznacza akceptację nowej wersji Regulaminu.

---

## §9. Postanowienia końcowe

W sprawach nieuregulowanych niniejszym Regulaminem zastosowanie mają przepisy prawa polskiego, w szczególności:
- Kodeksu cywilnego (ustawa z dnia 23 kwietnia 1964 r.),
- Ustawy o prawie autorskim i prawach pokrewnych (ustawa z dnia 4 lutego 1994 r.),
- Rozporządzenia RODO (UE) 2016/679.

Wszelkie pytania dotyczące Aplikacji lub niniejszego Regulaminu można kierować do Autora za pośrednictwem repozytorium GitHub projektu:

🔗 **https://github.com/krzjur-oss/Plan-lekcji**

---

*© 2025 Krzysztof Jureczek · Wszelkie prawa zastrzeżone*
