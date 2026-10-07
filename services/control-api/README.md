# @persona/control-api

A local control service for managing the account portfolio.

- It is a local control loop: it keeps the books of accounts, personas, content and events, and lets
  an operator move accounts through their lifecycle, look at policies and daily plans, and read an
  analytics snapshot.
- It performs no actions on any platform. It has no actors, uses no proxies, and makes no network
  calls to Instagram, TikTok, X or Telegram.
- It does not publish content. For content, `published` only **records and confirms** that a
  publication happened elsewhere, and has to be confirmed explicitly with `confirm: true`.
- It keeps all data in memory, not in a database. Everything is lost when the process stops.
- It reuses the domain logic of `@persona/core`, `@persona/persona-engine`, `@persona/behavior`,
  `@persona/publisher`, `@persona/analytics`, `@persona/account-intake` and `@persona/simulator`.
- Accounts can be brought in through a manual intake: a request is submitted with a confirmation of
  ownership, approved by a reviewer and then completed, which adds the account record. Nothing is
  registered on a platform.
- It can run an activity simulator (`@persona/simulator`) that generates lifecycle events for the
  accounts that exist, in memory, according to their daily plans. The simulation is local and has
  nothing to do with real platforms.

## Run

```bash
pnpm --filter @persona/control-api dev
```

The server listens on `127.0.0.1:3000`; override with the `HOST` and `PORT` environment variables.
It needs no internet access. For a production-style run, `pnpm build` and then
`pnpm --filter @persona/control-api start`.

Activity policies are read from `config/policies.yaml`. If that file is missing the service starts
with no policies (every account then has the empty policy); a file that exists but is invalid stops
the start.

## Веб-дашборд

Сервис отдаёт локальный веб-дашборд — страницу для работы с портфелем аккаунтов вручную. Это
статические файлы (`public/index.html`, `styles.css`, `app.js`) на чистом JavaScript: без сборки,
фреймворков и внешних ресурсов. Дашборд обращается к тому же REST API, что описан ниже, и ничего
не делает на внешних платформах.

Как запустить:

```bash
pnpm --filter @persona/control-api dev
```

Затем открыть <http://127.0.0.1:3000/dashboard/>. Адреса `/` и `/dashboard` перенаправляют на
`/dashboard/`. Тот же дашборд доступен и после `pnpm build` через
`pnpm --filter @persona/control-api start` (каталог `public` входит в пакет сервиса).

Вкладки:

| Вкладка   | Что есть                                                                                                                                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Обзор     | Число аккаунтов, персон, контента и событий; аккаунты по статусам; краткий аналитический снимок; панель «Симуляция активности» (см. ниже)                                                                                                                                              |
| Аккаунты  | Таблица и форма создания; карточка аккаунта: смена статуса, назначение персоны, политика, план на день, проверка разрешения действия                                                                                                                                                   |
| Приём     | Список заявок на приём аккаунтов с фильтром по статусу, форма новой заявки, карточка заявки и операции по её статусу (см. ниже)                                                                                                                                                        |
| Персоны   | Таблица, форма создания (темы через запятую, окно активности) и карточка                                                                                                                                                                                                               |
| Контент   | Таблица с фильтрами, форма создания черновика, карточка (в ней `publishedAt`, `externalId` и причина ошибки; публикации, выполненные симулятором, помечены «симуляция»), переходы между статусами, запись публикации (`published`) и ошибки (`failed`), план контента аккаунта на дату |
| Аналитика | Снимок `/analytics/snapshot`: графики (см. ниже), в том числе публикации контента, и под ними те же данные в таблицах                                                                                                                                                                  |

**Приём аккаунтов.** Заявка фиксирует, что существующий аккаунт вносится в портфель вручную; на платформе
ничего не регистрируется. На вкладке доступны операции в зависимости от статуса заявки:

| Статус           | Операции                                                     |
| ---------------- | ------------------------------------------------------------ |
| `draft`          | «Отправить на проверку»                                      |
| `pending_review` | «Одобрить» (с необязательной заметкой), «Отклонить»          |
| `approved`       | «Завершить приём» (создаёт аккаунт `connected`), «Отклонить» |
| `rejected`       | «Вернуть в черновик»                                         |
| `completed`      | операций нет; в карточке виден `completedAccountId`          |

Подтверждения работают так же, как для аккаунтов и контента: сначала запрос уходит без подтверждения,
и если сервис требует его (`409 manual_confirmation_required` при одобрении, ошибка проверки поля
`ownershipConfirmed` при отправке), дашборд показывает диалог и повторяет запрос с флагом
`confirmOwnership: true` или `ownershipConfirmed: true`. Для «Отклонить» обязательна причина, для
«Завершить приём» запрашивается простое подтверждение, а перед завершением можно выбрать персону.

**Графики аналитики** (чистые SVG и HTML, без библиотек; точные значения остаются в таблицах ниже и в
подсказках при наведении):

- распределение аккаунтов по статусам — все статусы видны, даже с нулём, цвета как у бейджей;
- частота ограничений по дням;
- ошибки действий по дням: выполненные и с ошибкой в одном столбце, под датой — доля ошибок;
- публикации контента — сколько публикаций завершилось статусом `published` и `failed`;
- выживаемость когорт — тепловая карта «когорта × возраст в днях».

При отсутствии данных вместо графика показывается пустое состояние.

Ошибки API (`400`, `404`, `409`) показываются с `error.message` и `error.details`. Если сервис
отвечает `409 manual_confirmation_required`, дашборд спрашивает подтверждение и повторяет запрос с
`confirm: true`; подтверждение публикации всегда требует явного согласия оператора.

**Только для локальной разработки.** У дашборда нет авторизации, поэтому сервис нельзя открывать
наружу: по умолчанию он слушает только `127.0.0.1`, и `HOST` не стоит менять на публичный адрес.
Страница отдаётся с `Content-Security-Policy: default-src 'self'`, данные API выводятся только как
текст, а не как разметка.

Для списка контента в дашборд добавлен маршрут `GET /content` (`?accountId=`, `?status=`).
Маршрут `GET /api` возвращает описание сервиса и список маршрутов — раньше это был `GET /`.

**Симуляция активности.** На вкладке «Обзор» есть секция «Симуляция активности»: индикатор состояния
(запущен — зелёный, остановлен — серый, при ошибке внутри тика — красный), симулированное время,
число тиков, скорость, интервал тика, число созданных событий, число публикаций контента, поля «Скорость» (по умолчанию 60) и
«Интервал тика, мс» (по умолчанию 1000) и кнопки «Запустить» и «Остановить». Ошибки сервиса
показываются с `error.message` и `error.details`. Подробности — в разделе «Симулятор активности».

**Обновление данных.** Пока симулятор запущен, дашборд каждые 5 секунд перезагружает данные открытой
вкладки «Обзор», «Аккаунты» или «Аналитика» (и ещё раз сразу после остановки). Обновляются только
данные — таблицы, карточки, графики; формы не затрагиваются, поэтому введённые значения не
сбрасываются (в карточке открытого аккаунта данные не обновляются сами: нажмите «Подробнее» ещё
раз). На всех вкладках с данными есть кнопка «Обновить»; на вкладке «Аналитика» это «Обновить
снимок». Пока симулятор остановлен, данные обновляются только вручную.

## Симулятор активности

Симулятор создаёт события жизненного цикла для аккаунтов портфеля, не обращаясь ни к каким
платформам: он берёт дневные планы у движка персон и последовательности действий у движка поведения
и записывает, что произошло бы, в хранилище событий в памяти. Он не создаёт аккаунты и персоны.
Подробности и список событий — в [`packages/simulator`](../../packages/simulator/README.md).

Симулятор создан вместе с сервисом, но **не запущен**: его запускают вручную.

| Метод  | Путь                | Что делает                                                                                                                                                                            |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/simulator/status` | Состояние: `running`, `simulatedTime`, `tickCount`, `speed`, `tickIntervalMs`, `eventsGenerated`, `lastError`, `publicationsAttempted`, `publicationsSucceeded`, `publicationsFailed` |
| `POST` | `/simulator/start`  | Запускает симулятор и возвращает его состояние                                                                                                                                        |
| `POST` | `/simulator/stop`   | Останавливает симулятор и возвращает его состояние                                                                                                                                    |

Тело `POST /simulator/start` (все поля необязательны):

| Поле             | По умолчанию | Допустимые значения                                            |
| ---------------- | ------------ | -------------------------------------------------------------- |
| `speed`          | `60`         | число больше 0, не больше 10000 (1 секунда = `speed` секунд)   |
| `tickIntervalMs` | `1000`       | целое число от 10 до 60000                                     |
| `maxTicks`       | нет          | целое положительное число; после стольких тиков остановка сама |

- Повторный `POST /simulator/start` во время работы — `409 simulator_already_running`.
- **`POST /simulator/stop` при не запущенном симуляторе — `409 simulator_not_running`** (а не
  молчаливый успех). Это относится и к запуску, который завершился сам по `maxTicks`. Тело
  `POST /simulator/stop` пустое.
- Некорректные параметры — `400 validation_error` с указанием поля в `details`; симулятор при этом
  не запускается.
- События симулятора доступны в `GET /events` (в `payload` есть `source: 'simulator'`) и попадают в
  `GET /analytics/snapshot`. Симулятор останавливается при остановке сервиса.
- Симулированное время начинается с момента запуска, и симулируются только сессии, которые
  начинаются после него. Если окно активности персон ещё не наступило, увеличьте `speed`, например
  до 3600 (секунда за час).
- Аккаунт получает события, только если у него есть персона и статус не `dead`; статусы
  `connected` и `onboarding` симулятор сам не меняет.
- **Публикация контента.** Симулятор создаётся с контент-пайплайном сервиса и в первой же сессии
  дня «публикует» контент аккаунта в статусе `scheduled` с `plannedDate` этого дня: с вероятностью
  0,9 контент получает статус `published` (`publishedAt` — симулированное время, `externalId` вида
  `sim-post-<id>`), иначе `failed` с причиной `simulated_publication_error`. Это только запись в
  памяти сервиса и смена статуса — ничего не отправляется ни на какую платформу. Событие
  публикации — `action_performed` (или `action_failed`) с `action: 'post'` и `contentId` в
  `GET /events`; контент меняется в `GET /content` и `GET /content/:id`. Подробности — в README
  `@persona/simulator`.
- Состояние (`GET /simulator/status`) содержит счётчики публикаций с последнего запуска:
  `publicationsAttempted`, `publicationsSucceeded`, `publicationsFailed`.
- `GET /analytics/snapshot` содержит `publicationMetrics` — `total`, `published` и `failed` по
  событиям публикаций (с учётом `startDate` и `endDate`).

Управлять симулятором можно и из дашборда: вкладка «Обзор», секция «Симуляция активности».

```bash
curl -X POST http://127.0.0.1:3000/simulator/start -H 'content-type: application/json' \
  -d '{"speed": 3600}'
curl http://127.0.0.1:3000/simulator/status
curl -X POST http://127.0.0.1:3000/simulator/stop
```

## Test

```bash
pnpm --filter @persona/control-api test
```

The tests drive the app with `app.inject(...)`, so no server is started. The clock and the random
number generator are injected, which keeps them deterministic.

## Routes

`GET /api` returns this list. `GET /` redirects to the web dashboard.

| Method  | Path                                     | Purpose                                                     |
| ------- | ---------------------------------------- | ----------------------------------------------------------- |
| `GET`   | `/health`                                | Liveness check                                              |
| `GET`   | `/api`                                   | Service description and this list of routes                 |
| `GET`   | `/`, `/dashboard`                        | Redirect to the web dashboard                               |
| `GET`   | `/dashboard/*`                           | Web dashboard (static files, development only)              |
| `POST`  | `/accounts`                              | Create an account (status `connected`)                      |
| `GET`   | `/accounts`                              | List accounts, optional `?status=`                          |
| `GET`   | `/accounts/:accountId`                   | Get an account                                              |
| `POST`  | `/accounts/:accountId/transition`        | Move an account to another status                           |
| `POST`  | `/accounts/:accountId/persona`           | Assign a persona                                            |
| `GET`   | `/accounts/:accountId/policy`            | Activity policy of the account                              |
| `GET`   | `/accounts/:accountId/plan`              | Daily plan, `?date=YYYY-MM-DD`                              |
| `GET`   | `/accounts/:accountId/action-permission` | Whether `?action=` is allowed by the daily budget           |
| `GET`   | `/accounts/:accountId/content-plan`      | Content plan, `?date=YYYY-MM-DD`                            |
| `POST`  | `/personas`                              | Create a persona                                            |
| `GET`   | `/personas`                              | List personas                                               |
| `GET`   | `/personas/:personaId`                   | Get a persona                                               |
| `PATCH` | `/personas/:personaId`                   | Update some fields of a persona                             |
| `GET`   | `/content`                               | List content, optional `?accountId=`, `?status=`            |
| `POST`  | `/content`                               | Create a content draft                                      |
| `GET`   | `/content/:contentId`                    | Get a content item                                          |
| `POST`  | `/content/:contentId/transition`         | Move a content item to another status                       |
| `POST`  | `/content/:contentId/published`          | Confirm a publication (needs `confirm: true`)               |
| `POST`  | `/content/:contentId/failed`             | Record that a publication failed                            |
| `POST`  | `/events`                                | Record a lifecycle event                                    |
| `GET`   | `/events`                                | List events (`accountId`, `type`, `startDate`, `endDate`)   |
| `GET`   | `/analytics/snapshot`                    | Analytics snapshot (`startDate`, `endDate`, `survivalDays`) |
| `GET`   | `/simulator/status`                      | State of the activity simulator                             |
| `POST`  | `/simulator/start`                       | Start the simulator (`speed`, `tickIntervalMs`, `maxTicks`) |
| `POST`  | `/simulator/stop`                        | Stop the simulator                                          |

## Behavior worth knowing

- **Manual confirmation.** `review -> warming` for accounts and `scheduled -> published` for content
  need `confirm: true`; otherwise the answer is `409 manual_confirmation_required`.
- **Intake.** Submitting needs `ownershipConfirmed: true` (otherwise `400`). Approving without
  `confirmOwnership: true` is a `409 manual_confirmation_required`. Completing creates the account in
  the `connected` status, records a `state_changed` event (`source: 'account-intake'`) and answers
  `409 duplicate_intake` when a request for the same platform and external account is already
  completed.
- **Status changes of accounts** are checked by the state machine of `@persona/core` and recorded as
  a `state_changed` event with `source: 'control-api'`.
- **Plans are cached per account and date** by the persona engine for the life of the process, so a
  plan that was already asked for does not change when the persona is edited afterwards.
- Bodies and queries are validated strictly: unknown fields are rejected, dates are real
  `YYYY-MM-DD` dates and timestamps are ISO 8601 with a UTC offset.
- A reversed date range (`startDate` after `endDate`) is a `400`. In `/analytics/snapshot` a range
  with only one end is open on the other side, and it narrows only the daily event metrics.

## Errors

Every error has one shape and never contains a stack trace:

```json
{ "error": { "code": "validation_error", "message": "Invalid body", "details": [] } }
```

| Code                           | Status  | Meaning                                                                                                |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------ |
| `validation_error`             | 400     | Body, query or path is invalid, or refers to something that is not there                               |
| `not_found`                    | 404     | The addressed entity or route does not exist                                                           |
| `invalid_transition`           | 409     | The status change is not allowed                                                                       |
| `manual_confirmation_required` | 409     | The change has to be confirmed with `confirm: true`                                                    |
| `duplicate_intake`             | 409     | A completed intake request already exists for the same account                                         |
| `simulator_already_running`    | 409     | The activity simulator is already running                                                              |
| `simulator_not_running`        | 409     | The activity simulator is not running, so it cannot be stopped                                         |
| `domain_error`                 | 409/400 | A domain rule refuses the change, e.g. a content item that is not ready (`details` lists the problems) |
| `internal_error`               | 500     | Unexpected failure; the cause is only written to the log                                               |
