# Сохранение дизайнерского интерфейса

Оригинальная база: `visual-baseline/{home,catalog}-{1440,768,390,320}.png`, reduced motion, до удаления float. Эти снимки не перезаписывались. `designer-source-baseline.json` фиксирует исходники; оригинальный `globals.css` извлечён из исходного коммита 8d513af для проверяемого сравнения.

`npm --prefix frontend run visual:source` проверяет 79 исходных изображений, шрифтов и файлов анимации. CSS сравнивается целиком после исключения только одобренных float-правил. Другие CSS-различия запрещены.

`npm --prefix frontend run test:e2e` запускает отдельный локальный fixture API и production frontend. Проверяются четыре viewport: 1440×900, 768×1024, 390×844, 320×780, отсутствие горизонтального переполнения, доступность заголовков и загрузка иллюстраций дуэта после прокрутки. Снимки пишутся в `.qa/visual-current/`; CI сохраняет их вместе с traces. Обычные cart/duo/commerce сценарии выполняются с исходными анимациями, а не с их удалением.

`visual:compare` рассчитывает pixel diff к неизменённой базе. Верхние 550px главной совпали побайтно на всех четырёх ширинах; каталог имеет ожидаемые различия текста результатов/статуса (до 2%). CI ограничивает разницу hero 0,1%, верх каталога 2,5%. Полная страница не объявляется pixel-identical: удалён float, изменены платёжные поля/методы и реальные auth/error states; число строк каталога определяется серверной пагинацией. Lazy-loaded изображения ниже экрана в оригинальных fullpage snapshots местами не загружены, поэтому отдельные duo screenshots проверяются после прокрутки.

Визуально проверены desktop/mobile страницы и отдельный дуэт. В процессе проверки восстановлена исходная начальная пара (Охотничий нож / Дамасская сталь + Hydra Gloves / Rattler): она не должна заменяться первым ножом серверного каталога. До взаимодействия пустой Steam login не вызывает красного/ошибочного сообщения, добавляющего высоту форме. Новые статусы используют существующие классы и места форм; композиция, цвета, размеры шрифтов, изображения и анимации сохранены.

## Same-platform baseline in CI

The original macOS PNGs remain unchanged. Linux CI now runs visual:baseline:
it archives immutable designer commit8d513af5575df4f6b45ebab4c75c2304d1427c88,
builds that original app separately, then captures it using the same OS and
Chromium as the current screenshots. This removes macOS/Linux text rasterization
differences without relaxing thresholds or using the new app as its own baseline.
The generated artifact includes revision/platform/browser provenance.json.
Run visual:baseline before visual:compare on Linux. The hero0.1% and catalog2.5%
thresholds still apply.
