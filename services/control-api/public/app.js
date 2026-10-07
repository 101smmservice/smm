/* global window, document, fetch, URLSearchParams */
'use strict';

// Local development dashboard for the account portfolio. It talks to the REST API of the same
// service, has no authentication and loads nothing from outside its own origin.
// Data from the API is only ever put into the page as text, never as markup.

// ---------------------------------------------------------------------------
// Reference data (the server validates everything again)
// ---------------------------------------------------------------------------

const PLATFORMS = ['instagram', 'tiktok', 'x', 'telegram'];

const ACCOUNT_STATUS_LABELS = {
  connected: 'подключён',
  onboarding: 'первичная настройка',
  warming: 'наращивание активности',
  active: 'активен',
  limited: 'ограничен',
  review: 'ручной разбор',
  dead: 'выведен из портфеля',
};

const ACCOUNT_TRANSITIONS = {
  connected: ['onboarding'],
  onboarding: ['warming', 'review'],
  warming: ['active', 'limited'],
  active: ['limited'],
  limited: ['review'],
  review: ['warming', 'dead'],
  dead: [],
};

const CONTENT_FORMATS = ['post', 'video', 'story', 'article'];

const CONTENT_STATUS_LABELS = {
  draft: 'черновик',
  brief_ready: 'бриф готов',
  planned: 'запланирован',
  ready: 'готов',
  scheduled: 'в расписании',
  published: 'опубликован',
  failed: 'ошибка публикации',
  rejected: 'отклонён',
  archived: 'в архиве',
};

const CONTENT_TRANSITIONS = {
  draft: ['brief_ready', 'rejected', 'archived'],
  brief_ready: ['planned', 'draft', 'rejected', 'archived'],
  planned: ['ready', 'brief_ready', 'rejected', 'archived'],
  ready: ['scheduled', 'planned', 'rejected', 'archived'],
  scheduled: ['published', 'failed', 'ready'],
  failed: ['planned', 'rejected', 'archived'],
  published: ['archived'],
  rejected: ['draft'],
  archived: [],
};

const ACTION_LABELS = {
  view: 'просмотр',
  like: 'отметка «нравится»',
  follow: 'подписка',
  post: 'публикация',
  comment: 'комментарий',
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** Builds an element. `text` and children become text nodes, so nothing is ever parsed as HTML. */
function h(tag, attributes, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (key === 'class') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key.startsWith('on')) {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) {
      continue;
    }
    node.append(child instanceof window.Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function option(value, label, selected) {
  return h('option', { value, selected: Boolean(selected) }, label === undefined ? value : label);
}

function field(label, control, hint) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    control,
    hint ? h('span', { class: 'field-hint', text: hint }) : null,
  );
}

function checkboxField(label, control) {
  return h(
    'label',
    { class: 'field inline' },
    control,
    h('span', { class: 'field-label', text: label }),
  );
}

function loading() {
  return h('p', { class: 'muted', text: 'Загрузка…' });
}

function panel(title, ...children) {
  return h('section', { class: 'panel' }, title ? h('h3', { text: title }) : null, children);
}

function safeClass(value) {
  return String(value).replace(/[^a-z_]/g, '');
}

function badge(value, kind) {
  const labels = Object.assign({}, ACCOUNT_STATUS_LABELS, CONTENT_STATUS_LABELS);
  return h('span', {
    class: kind ? `badge ${kind}` : `badge s-${safeClass(value)}`,
    title: labels[value] || null,
    text: String(value),
  });
}

function timestamp(value) {
  return value
    ? String(value)
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, 'Z')
    : '—';
}

function percent(value) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function bar(fraction, bad) {
  const fill = h('span', { class: bad ? 'bar-fill bad' : 'bar-fill' });
  fill.style.width = `${Math.max(0, Math.min(1, Number(fraction))) * 100}%`;
  return h('span', { class: 'bar' }, fill);
}

function json(value) {
  return h('pre', { text: JSON.stringify(value, null, 2) });
}

function keyValues(entries) {
  return h(
    'dl',
    { class: 'kv' },
    entries.map(([name, value]) => [
      h('dt', { text: name }),
      h('dd', {}, value === null || value === undefined || value === '' ? '—' : value),
    ]),
  );
}

/** A table with one row per item; `columns` are `{ title, render(item), className }`. */
function table(columns, rows, emptyText) {
  if (rows.length === 0) {
    return h('p', { class: 'empty', text: emptyText });
  }
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          columns.map((column) => h('th', { class: column.className, text: column.title })),
        ),
      ),
      h(
        'tbody',
        {},
        rows.map((row) =>
          h(
            'tr',
            {},
            columns.map((column) => h('td', { class: column.className }, column.render(row))),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// API access and error display
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(status, body) {
    const info = body && body.error ? body.error : {};
    super(info.message || `Ошибка запроса (код ${status})`);
    this.status = status;
    this.code = info.code || 'unknown_error';
    this.details = Array.isArray(info.details) ? info.details : [];
  }
}

async function api(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, {
      error: {
        code: 'network_error',
        message: 'Не удалось связаться с сервером. Проверьте, что он запущен.',
        details: [],
      },
    });
  }

  const text = await response.text();
  let data = null;
  if (text !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, data);
  }
  return data;
}

const ERROR_TITLES = {
  0: 'Нет связи с сервером',
  400: 'Некорректные данные',
  404: 'Не найдено',
  409: 'Действие невозможно',
};

function describeDetail(detail) {
  if (detail && typeof detail === 'object' && Array.isArray(detail.path) && detail.message) {
    return `${detail.path.join('.')}: ${detail.message}`;
  }
  if (detail && typeof detail === 'object' && detail.code && detail.message) {
    return `${detail.code}: ${detail.message}`;
  }
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

function errorBox(error) {
  if (!(error instanceof ApiError)) {
    return h(
      'div',
      { class: 'notice notice-error' },
      h('div', { class: 'notice-title', text: 'Ошибка' }),
      String(error && error.message ? error.message : error),
    );
  }
  return h(
    'div',
    { class: 'notice notice-error', role: 'alert' },
    h('div', {
      class: 'notice-title',
      text: ERROR_TITLES[error.status] || `Ошибка ${error.status}`,
    }),
    h('div', { text: error.message }),
    h('div', { class: 'notice-code', text: `${error.status || '—'} · ${error.code}` }),
    error.details.length > 0
      ? h(
          'ul',
          {},
          error.details.map((detail) => h('li', { text: describeDetail(detail) })),
        )
      : null,
  );
}

function okBox(message) {
  return h('div', { class: 'notice notice-ok', role: 'status', text: message });
}

/** An area that shows the result of the last action. */
function notices() {
  const area = h('div');
  return {
    area,
    error: (error) => area.replaceChildren(errorBox(error)),
    ok: (message) => area.replaceChildren(okBox(message)),
    clear: () => area.replaceChildren(),
  };
}

/** Runs `task` with the form's buttons disabled so that an action cannot be sent twice. */
async function busy(form, task) {
  const buttons = [...form.querySelectorAll('button')];
  for (const button of buttons) {
    button.disabled = true;
  }
  try {
    await task();
  } finally {
    for (const button of buttons) {
      button.disabled = false;
    }
  }
}

function forForm(form, handler) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    busy(form, handler);
  });
}

function enc(value) {
  return encodeURIComponent(value);
}

function optionalText(input) {
  const value = input.value.trim();
  return value === '' ? undefined : value;
}

function commaList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** `datetime-local` values have no offset; they are read as local time and sent as UTC. */
function localDateTimeToIso(value) {
  return value === '' ? undefined : new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Tab: Обзор
// ---------------------------------------------------------------------------

async function renderOverview() {
  const [accounts, personas, content, events, snapshot] = await Promise.all([
    api('GET', '/accounts'),
    api('GET', '/personas'),
    api('GET', '/content'),
    api('GET', '/events'),
    api('GET', '/analytics/snapshot'),
  ]);

  const card = (label, value) =>
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-value', text: String(value) }),
      h('div', { class: 'card-label', text: label }),
    );

  const byStatus = Object.keys(ACCOUNT_STATUS_LABELS).map((status) => ({
    status,
    count: accounts.filter((account) => account.status === status).length,
  }));
  const summary = snapshot.statusSummary;
  const isEmpty = accounts.length + personas.length + content.length + events.length === 0;

  return h(
    'div',
    { class: 'stack' },
    h('h2', { text: 'Обзор портфеля' }),
    isEmpty
      ? h('p', {
          class: 'empty',
          text: 'Пока нет данных. Создайте персону и аккаунт на соответствующих вкладках.',
        })
      : null,
    h(
      'div',
      { class: 'cards' },
      card('Аккаунтов', accounts.length),
      card('Персон', personas.length),
      card('Контентных элементов', content.length),
      card('Событий', events.length),
    ),
    panel(
      'Аккаунты по статусам',
      table(
        [
          { title: 'Статус', render: (row) => badge(row.status) },
          { title: 'Описание', render: (row) => ACCOUNT_STATUS_LABELS[row.status] },
          { title: 'Количество', className: 'num', render: (row) => String(row.count) },
        ],
        byStatus,
        '',
      ),
    ),
    panel(
      'Краткий аналитический снимок',
      keyValues([
        ['Сформирован', timestamp(snapshot.generatedAt)],
        ['Доля активных', percent(summary.activeRate)],
        ['Доля ограниченных', percent(summary.limitedRate)],
        ['Доля на ручном разборе', percent(summary.reviewRate)],
        ['Доля выведенных', percent(summary.deadRate)],
        ['Типов переходов статуса', String(snapshot.transitionMatrix.length)],
        ['Дней с ограничениями', String(snapshot.restrictionFrequency.length)],
        ['Дней с действиями', String(snapshot.actionFailureMetrics.length)],
        ['Точек выживаемости когорт', String(snapshot.cohortSurvival.length)],
      ]),
      h('p', { class: 'muted' }, 'Подробнее — на вкладке «Аналитика».'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tab: Аккаунты
// ---------------------------------------------------------------------------

async function renderAccounts() {
  const personas = await api('GET', '/personas');
  const message = notices();
  const tableArea = h('div');
  const detailArea = h('div');
  let statusFilter = '';

  const personaSelect = (selectedId) =>
    h(
      'select',
      { name: 'personaId' },
      option('', '— без персоны —'),
      personas.map((persona) =>
        option(
          persona.id,
          `${persona.niche} · ${persona.id.slice(0, 8)}`,
          persona.id === selectedId,
        ),
      ),
    );

  async function loadTable() {
    tableArea.replaceChildren(loading());
    try {
      const accounts = await api(
        'GET',
        statusFilter === '' ? '/accounts' : `/accounts?status=${enc(statusFilter)}`,
      );
      tableArea.replaceChildren(
        table(
          [
            { title: 'id', className: 'mono', render: (a) => a.id },
            { title: 'Платформа', render: (a) => a.platform },
            { title: 'Статус', render: (a) => badge(a.status) },
            { title: 'Персона', className: 'mono', render: (a) => a.personaId },
            { title: 'Создан', render: (a) => timestamp(a.createdAt) },
            { title: 'Статус изменён', render: (a) => timestamp(a.statusChangedAt) },
            {
              title: '',
              render: (a) =>
                h('button', {
                  class: 'secondary small',
                  type: 'button',
                  text: 'Подробнее',
                  onclick: () => showAccount(a.id),
                }),
            },
          ],
          accounts,
          'Аккаунтов нет. Создайте первый с помощью формы выше.',
        ),
      );
    } catch (error) {
      tableArea.replaceChildren(errorBox(error));
    }
  }

  async function showAccount(accountId) {
    detailArea.replaceChildren(loading());
    try {
      const path = `/accounts/${enc(accountId)}`;
      const [account, policy] = await Promise.all([api('GET', path), api('GET', `${path}/policy`)]);
      detailArea.replaceChildren(accountPanel(account, policy));
    } catch (error) {
      detailArea.replaceChildren(errorBox(error));
    }
  }

  function accountPanel(account, policy) {
    const path = `/accounts/${enc(account.id)}`;
    const local = notices();
    const refresh = async () => {
      await Promise.all([loadTable(), showAccount(account.id)]);
    };

    // Status transition
    const allowed = ACCOUNT_TRANSITIONS[account.status] || [];
    const others = Object.keys(ACCOUNT_STATUS_LABELS).filter(
      (status) => status !== account.status && !allowed.includes(status),
    );
    const target = h(
      'select',
      { name: 'to' },
      allowed.map((status) => option(status, `${status} — ${ACCOUNT_STATUS_LABELS[status]}`)),
      others.length > 0
        ? h(
            'optgroup',
            { label: 'Не разрешены правилами (проверка ответа сервера)' },
            others.map((status) => option(status, `${status} — ${ACCOUNT_STATUS_LABELS[status]}`)),
          )
        : null,
    );
    const confirmBox = h('input', { type: 'checkbox', name: 'confirm' });
    const transitionForm = h(
      'form',
      { class: 'form' },
      field('Новый статус', target),
      checkboxField('Подтверждаю результат ручного разбора (confirm)', confirmBox),
      h(
        'div',
        { class: 'form-actions' },
        h('button', { type: 'submit', text: 'Выполнить переход' }),
      ),
    );
    forForm(transitionForm, async () => {
      const to = target.value;
      try {
        let result;
        try {
          result = await api(
            'POST',
            `${path}/transition`,
            confirmBox.checked ? { to, confirm: true } : { to },
          );
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'manual_confirmation_required') {
            throw error;
          }
          if (!window.confirm(`${error.message}\n\nПодтвердить и повторить?`)) {
            local.error(error);
            return;
          }
          result = await api('POST', `${path}/transition`, { to, confirm: true });
        }
        await refresh();
        message.ok(`Статус аккаунта ${result.id.slice(0, 8)} изменён: ${result.status}`);
      } catch (error) {
        local.error(error);
      }
    });

    // Persona assignment
    const assignSelect = personaSelect(account.personaId);
    const assignForm = h(
      'form',
      { class: 'form' },
      field('Персона', assignSelect),
      h(
        'div',
        { class: 'form-actions' },
        h('button', { type: 'submit', text: 'Назначить персону' }),
      ),
    );
    forForm(assignForm, async () => {
      if (assignSelect.value === '') {
        local.error(new Error('Выберите персону.'));
        return;
      }
      try {
        await api('POST', `${path}/persona`, { personaId: assignSelect.value });
        await refresh();
        message.ok('Персона назначена.');
      } catch (error) {
        local.error(error);
      }
    });

    // Daily plan
    const planArea = h('div');
    const dateInput = h('input', {
      type: 'text',
      name: 'date',
      value: today(),
      placeholder: 'ГГГГ-ММ-ДД',
      pattern: '\\d{4}-\\d{2}-\\d{2}',
    });
    const planForm = h(
      'form',
      { class: 'form' },
      field('Дата', dateInput, 'формат ГГГГ-ММ-ДД'),
      h('div', { class: 'form-actions' }, h('button', { type: 'submit', text: 'Получить план' })),
    );
    forForm(planForm, async () => {
      planArea.replaceChildren(loading());
      try {
        const plan = await api('GET', `${path}/plan?date=${enc(dateInput.value.trim())}`);
        planArea.replaceChildren(planView(plan));
      } catch (error) {
        planArea.replaceChildren(errorBox(error));
      }
    });

    // Action permission
    const permissionArea = h('div');
    const actionSelect = h(
      'select',
      { name: 'action' },
      Object.keys(ACTION_LABELS).map((action) =>
        option(action, `${action} — ${ACTION_LABELS[action]}`),
      ),
    );
    const permissionForm = h(
      'form',
      { class: 'form' },
      field('Действие', actionSelect),
      h('div', { class: 'form-actions' }, h('button', { type: 'submit', text: 'Проверить' })),
    );
    forForm(permissionForm, async () => {
      permissionArea.replaceChildren(loading());
      try {
        const decision = await api(
          'GET',
          `${path}/action-permission?action=${enc(actionSelect.value)}`,
        );
        permissionArea.replaceChildren(
          keyValues([
            ['Разрешено', badge(decision.allowed ? 'да' : 'нет', decision.allowed ? 'ok' : 'no')],
            ['Причина', decision.reason],
            [
              'Остаток бюджета',
              decision.remainingBudget === undefined ? '—' : String(decision.remainingBudget),
            ],
          ]),
        );
      } catch (error) {
        permissionArea.replaceChildren(errorBox(error));
      }
    });

    return h(
      'div',
      { class: 'stack' },
      h(
        'section',
        { class: 'panel' },
        h(
          'div',
          { class: 'panel-head' },
          h('h3', { text: 'Аккаунт' }),
          h('button', {
            class: 'secondary small',
            type: 'button',
            text: 'Закрыть',
            onclick: () => detailArea.replaceChildren(),
          }),
        ),
        keyValues([
          ['id', account.id],
          ['Платформа', account.platform],
          ['Статус', badge(account.status)],
          ['Персона', account.personaId],
          ['Создан', timestamp(account.createdAt)],
          ['Подключён', timestamp(account.connectedAt)],
          ['Статус изменён', timestamp(account.statusChangedAt)],
          ['Метаданные', Object.keys(account.metadata).length === 0 ? '—' : json(account.metadata)],
        ]),
      ),
      local.area,
      panel('Переход статуса', transitionForm),
      panel('Назначение персоны', assignForm),
      panel('Политика активности', policyView(policy)),
      panel('Планирование активности — дневной план', planForm, planArea),
      panel('Проверка разрешения действия', permissionForm, permissionArea),
    );
  }

  function policyView(policy) {
    return h(
      'div',
      { class: 'stack' },
      keyValues([
        ['Этап', policy.stage],
        ['Макс. длительность сессии, мин', String(policy.maxSessionMinutes)],
        ['Сессий в день', policy.sessionsPerDay.join(' – ')],
        ['Интервал между действиями, мин', policy.minIntervalMinutes.join(' – ')],
        ['Вероятность пропускного дня', percent(policy.skipDayProbability)],
      ]),
      table(
        [
          { title: 'Действие', render: (row) => `${row[0]} — ${ACTION_LABELS[row[0]] || ''}` },
          { title: 'Макс. в день', className: 'num', render: (row) => String(row[1].maxPerDay) },
          {
            title: 'Вероятность при встрече',
            className: 'num',
            render: (row) => percent(row[1].probabilityPerEncounter),
          },
        ],
        Object.entries(policy.actions),
        '',
      ),
    );
  }

  function planView(plan) {
    return h(
      'div',
      { class: 'stack' },
      keyValues([
        ['Дата', plan.date],
        ['Пропускной день', badge(plan.isSkipDay ? 'да' : 'нет', plan.isSkipDay ? 'warn' : 'ok')],
      ]),
      h('h3', { text: 'Сессии' }),
      table(
        [
          { title: '№', className: 'num', render: (_session, index) => String(index) },
          { title: 'Начало (UTC)', render: (session) => timestamp(session.startAt) },
          {
            title: 'Макс. длительность, мин',
            className: 'num',
            render: (session) => String(session.maxDurationMinutes),
          },
        ],
        plan.sessions,
        'Сессий на этот день нет.',
      ),
      h('h3', { text: 'Бюджеты действий' }),
      table(
        [
          { title: 'Действие', render: (row) => `${row[0]} — ${ACTION_LABELS[row[0]] || ''}` },
          { title: 'Бюджет на день', className: 'num', render: (row) => String(row[1]) },
        ],
        Object.entries(plan.actionBudgets),
        '',
      ),
    );
  }

  // Creation form
  const platformSelect = h(
    'select',
    { name: 'platform' },
    PLATFORMS.map((platform) => option(platform)),
  );
  const connectedInput = h('input', { type: 'datetime-local', name: 'connectedAt' });
  const createPersonaSelect = personaSelect(null);
  const createForm = h(
    'form',
    { class: 'form' },
    field('Платформа', platformSelect),
    field('Подключён (необязательно)', connectedInput, 'если не указано — текущий момент'),
    field('Персона (необязательно)', createPersonaSelect),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', text: 'Создать аккаунт' })),
  );
  forForm(createForm, async () => {
    const body = { platform: platformSelect.value };
    const connectedAt = localDateTimeToIso(connectedInput.value);
    if (connectedAt !== undefined) {
      body.connectedAt = connectedAt;
    }
    if (createPersonaSelect.value !== '') {
      body.personaId = createPersonaSelect.value;
    }
    try {
      const account = await api('POST', '/accounts', body);
      createForm.reset();
      await loadTable();
      message.ok(`Аккаунт создан: ${account.id}`);
    } catch (error) {
      message.error(error);
    }
  });

  // Filter
  const filterSelect = h(
    'select',
    { name: 'status' },
    option('', 'все статусы'),
    Object.keys(ACCOUNT_STATUS_LABELS).map((status) =>
      option(status, `${status} — ${ACCOUNT_STATUS_LABELS[status]}`),
    ),
  );
  filterSelect.addEventListener('change', () => {
    statusFilter = filterSelect.value;
    loadTable();
  });

  const root = h(
    'div',
    { class: 'stack' },
    h('h2', { text: 'Аккаунты портфеля' }),
    panel('Новый аккаунт', createForm),
    message.area,
    h(
      'section',
      { class: 'panel' },
      h(
        'div',
        { class: 'panel-head' },
        h('h3', { text: 'Список аккаунтов' }),
        field('Статус', filterSelect),
      ),
      tableArea,
    ),
    detailArea,
  );
  await loadTable();
  return root;
}

// ---------------------------------------------------------------------------
// Tab: Персоны
// ---------------------------------------------------------------------------

async function renderPersonas() {
  const message = notices();
  const tableArea = h('div');
  const detailArea = h('div');

  const windowText = (window_) =>
    `${String(window_.startHour).padStart(2, '0')}:00–${String(window_.endHour).padStart(2, '0')}:00 UTC, выходные: ${window_.weekendActive ? 'да' : 'нет'}`;

  async function loadTable() {
    tableArea.replaceChildren(loading());
    try {
      const personas = await api('GET', '/personas');
      tableArea.replaceChildren(
        table(
          [
            { title: 'id', className: 'mono', render: (p) => p.id },
            { title: 'Ниша', render: (p) => p.niche },
            { title: 'Тон', render: (p) => p.tone },
            { title: 'Локаль', render: (p) => p.locale },
            { title: 'Часовой пояс', render: (p) => p.timezone },
            { title: 'Темы', render: (p) => p.topics.join(', ') },
            { title: 'Окно активности', render: (p) => windowText(p.activityWindow) },
            {
              title: '',
              render: (p) =>
                h('button', {
                  class: 'secondary small',
                  type: 'button',
                  text: 'Подробнее',
                  onclick: () => showPersona(p.id),
                }),
            },
          ],
          personas,
          'Персон нет. Создайте первую с помощью формы выше.',
        ),
      );
    } catch (error) {
      tableArea.replaceChildren(errorBox(error));
    }
  }

  async function showPersona(personaId) {
    detailArea.replaceChildren(loading());
    try {
      const persona = await api('GET', `/personas/${enc(personaId)}`);
      detailArea.replaceChildren(
        h(
          'section',
          { class: 'panel' },
          h(
            'div',
            { class: 'panel-head' },
            h('h3', { text: 'Персона (редакционный профиль)' }),
            h('button', {
              class: 'secondary small',
              type: 'button',
              text: 'Закрыть',
              onclick: () => detailArea.replaceChildren(),
            }),
          ),
          keyValues([
            ['id', persona.id],
            ['Ниша', persona.niche],
            ['Тон', persona.tone],
            ['Аудитория', persona.audience],
            ['Локаль', persona.locale],
            ['Часовой пояс', persona.timezone],
            [
              'Темы',
              h(
                'ul',
                {},
                persona.topics.map((topic) => h('li', { text: topic })),
              ),
            ],
            ['Окно активности', windowText(persona.activityWindow)],
          ]),
        ),
      );
    } catch (error) {
      detailArea.replaceChildren(errorBox(error));
    }
  }

  const inputs = {
    timezone: h('input', { type: 'text', name: 'timezone', value: 'UTC', required: true }),
    locale: h('input', { type: 'text', name: 'locale', value: 'ru-RU', required: true }),
    niche: h('input', { type: 'text', name: 'niche', required: true }),
    tone: h('input', { type: 'text', name: 'tone', required: true }),
    audience: h('input', { type: 'text', name: 'audience', required: true }),
    topics: h('input', { type: 'text', name: 'topics', required: true }),
    startHour: h('input', {
      type: 'number',
      name: 'startHour',
      value: '9',
      min: '0',
      max: '23',
      step: '1',
    }),
    endHour: h('input', {
      type: 'number',
      name: 'endHour',
      value: '21',
      min: '0',
      max: '23',
      step: '1',
    }),
    weekendActive: h('input', { type: 'checkbox', name: 'weekendActive', checked: true }),
  };
  const form = h(
    'form',
    { class: 'form' },
    field('Часовой пояс', inputs.timezone),
    field('Локаль', inputs.locale),
    field('Ниша', inputs.niche),
    field('Тон', inputs.tone),
    field('Аудитория', inputs.audience),
    field('Темы', inputs.topics, 'через запятую'),
    field('Окно активности: час начала (UTC)', inputs.startHour, '0–23'),
    field('Окно активности: час окончания (UTC)', inputs.endHour, '0–23, больше часа начала'),
    checkboxField('Активна в выходные', inputs.weekendActive),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', text: 'Создать персону' })),
  );
  forForm(form, async () => {
    try {
      const persona = await api('POST', '/personas', {
        timezone: inputs.timezone.value,
        locale: inputs.locale.value,
        niche: inputs.niche.value,
        tone: inputs.tone.value,
        audience: inputs.audience.value,
        topics: commaList(inputs.topics.value),
        activityWindow: {
          startHour: Number(inputs.startHour.value),
          endHour: Number(inputs.endHour.value),
          weekendActive: inputs.weekendActive.checked,
        },
      });
      form.reset();
      await loadTable();
      message.ok(`Персона создана: ${persona.id}`);
    } catch (error) {
      message.error(error);
    }
  });

  const root = h(
    'div',
    { class: 'stack' },
    h('h2', { text: 'Персоны' }),
    h('p', {
      class: 'muted',
      text: 'Персона — редакционный профиль: тематика, тон и окно активности, по которым строится планирование.',
    }),
    panel('Новая персона', form),
    message.area,
    panel('Список персон', tableArea),
    detailArea,
  );
  await loadTable();
  return root;
}

// ---------------------------------------------------------------------------
// Tab: Контент
// ---------------------------------------------------------------------------

async function renderContent() {
  const accounts = await api('GET', '/accounts');
  const message = notices();
  const tableArea = h('div');
  const detailArea = h('div');
  const filters = { accountId: '', status: '' };

  async function loadTable() {
    tableArea.replaceChildren(loading());
    try {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(filters)) {
        if (value !== '') {
          query.set(name, value);
        }
      }
      const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
      const items = await api('GET', `/content${suffix}`);
      tableArea.replaceChildren(
        table(
          [
            { title: 'id', className: 'mono', render: (c) => c.id },
            { title: 'Аккаунт', className: 'mono', render: (c) => c.accountId },
            { title: 'Формат', render: (c) => c.format },
            { title: 'Статус', render: (c) => badge(c.status) },
            { title: 'Дата плана', render: (c) => c.plannedDate },
            { title: 'В расписании на', render: (c) => timestamp(c.scheduledAt) },
            { title: 'Опубликован', render: (c) => timestamp(c.publishedAt) },
            {
              title: '',
              render: (c) =>
                h('button', {
                  class: 'secondary small',
                  type: 'button',
                  text: 'Подробнее',
                  onclick: () => showItem(c.id),
                }),
            },
          ],
          items,
          'Контентных элементов нет.',
        ),
      );
    } catch (error) {
      tableArea.replaceChildren(errorBox(error));
    }
  }

  async function showItem(contentId) {
    detailArea.replaceChildren(loading());
    try {
      detailArea.replaceChildren(itemPanel(await api('GET', `/content/${enc(contentId)}`)));
    } catch (error) {
      detailArea.replaceChildren(errorBox(error));
    }
  }

  function itemPanel(item) {
    const local = notices();
    const refresh = async () => {
      await Promise.all([loadTable(), showItem(item.id)]);
    };

    // Status transition. Moving to `published` records a publication that happened elsewhere, so it
    // always has to be confirmed.
    const allowed = CONTENT_TRANSITIONS[item.status] || [];
    const target = h(
      'select',
      { name: 'to' },
      allowed.map((status) => option(status, `${status} — ${CONTENT_STATUS_LABELS[status]}`)),
    );
    const plannedDate = h('input', {
      type: 'text',
      name: 'plannedDate',
      placeholder: 'ГГГГ-ММ-ДД',
      value: item.plannedDate || today(),
    });
    const scheduledAt = h('input', { type: 'datetime-local', name: 'scheduledAt' });
    const externalId = h('input', { type: 'text', name: 'externalId' });
    const failureReason = h('input', { type: 'text', name: 'failureReason' });
    const confirmPublished = h('input', { type: 'checkbox', name: 'confirm' });

    const plannedField = field('Дата плана', plannedDate, 'для «planned»');
    const scheduledField = field(
      'Время в расписании',
      scheduledAt,
      'для «scheduled»; локальное время',
    );
    const externalField = field('Внешний идентификатор', externalId, 'необязательно');
    const failureField = field('Причина ошибки', failureReason, 'обязательно для «failed»');
    const confirmField = checkboxField(
      'Подтверждаю, что публикация состоялась вне этой панели',
      confirmPublished,
    );
    const syncFields = () => {
      plannedField.hidden = target.value !== 'planned';
      scheduledField.hidden = target.value !== 'scheduled';
      externalField.hidden = target.value !== 'published';
      confirmField.hidden = target.value !== 'published';
      failureField.hidden = target.value !== 'failed';
    };
    target.addEventListener('change', syncFields);
    syncFields();

    const transitionForm = h(
      'form',
      { class: 'form' },
      field('Новый статус', target),
      plannedField,
      scheduledField,
      externalField,
      failureField,
      confirmField,
      h(
        'div',
        { class: 'form-actions' },
        h('button', { type: 'submit', text: 'Выполнить переход' }),
      ),
    );
    if (allowed.length === 0) {
      transitionForm.replaceChildren(
        h('p', { class: 'empty', text: 'Из этого статуса переходов нет.' }),
      );
    }
    forForm(transitionForm, async () => {
      const to = target.value;
      const path = `/content/${enc(item.id)}`;
      try {
        if (to === 'published') {
          const body = {};
          if (confirmPublished.checked) {
            body.confirm = true;
          }
          if (externalId.value.trim() !== '') {
            body.externalId = externalId.value.trim();
          }
          try {
            await api('POST', `${path}/published`, body);
          } catch (error) {
            if (!(error instanceof ApiError) || error.code !== 'manual_confirmation_required') {
              throw error;
            }
            if (
              !window.confirm(
                `${error.message}\n\nПодтвердить, что публикация состоялась вне этой панели, и повторить?`,
              )
            ) {
              local.error(error);
              return;
            }
            await api('POST', `${path}/published`, Object.assign({}, body, { confirm: true }));
          }
        } else if (to === 'failed') {
          await api('POST', `${path}/failed`, { reason: failureReason.value });
        } else {
          const body = { to };
          if (to === 'planned') {
            body.plannedDate = plannedDate.value.trim();
          }
          if (to === 'scheduled') {
            const iso = localDateTimeToIso(scheduledAt.value);
            if (iso !== undefined) {
              body.scheduledAt = iso;
            }
          }
          await api('POST', `${path}/transition`, body);
        }
        await refresh();
        message.ok(`Статус контента изменён: ${to}`);
      } catch (error) {
        local.error(error);
      }
    });

    // Content plan of the account
    const planArea = h('div');
    const dateInput = h('input', {
      type: 'text',
      name: 'date',
      value: item.plannedDate || today(),
      placeholder: 'ГГГГ-ММ-ДД',
    });
    const planForm = h(
      'form',
      { class: 'form' },
      field('Дата', dateInput, 'формат ГГГГ-ММ-ДД'),
      h(
        'div',
        { class: 'form-actions' },
        h('button', { type: 'submit', text: 'Показать план контента аккаунта' }),
      ),
    );
    forForm(planForm, async () => {
      planArea.replaceChildren(loading());
      try {
        const plan = await api(
          'GET',
          `/accounts/${enc(item.accountId)}/content-plan?date=${enc(dateInput.value.trim())}`,
        );
        planArea.replaceChildren(
          h(
            'div',
            { class: 'stack' },
            keyValues([
              ['Дата', plan.date],
              ['План готов', badge(plan.isReady ? 'да' : 'нет', plan.isReady ? 'ok' : 'warn')],
              ['Элементов', String(plan.itemIds.length)],
            ]),
            table(
              [
                { title: 'Статус', render: (row) => badge(row[0]) },
                { title: 'Количество', className: 'num', render: (row) => String(row[1]) },
              ],
              Object.entries(plan.counts).filter((row) => row[1] > 0),
              'На эту дату нет контента.',
            ),
          ),
        );
      } catch (error) {
        planArea.replaceChildren(errorBox(error));
      }
    });

    return h(
      'div',
      { class: 'stack' },
      h(
        'section',
        { class: 'panel' },
        h(
          'div',
          { class: 'panel-head' },
          h('h3', { text: 'Контентный элемент' }),
          h('button', {
            class: 'secondary small',
            type: 'button',
            text: 'Закрыть',
            onclick: () => detailArea.replaceChildren(),
          }),
        ),
        keyValues([
          ['id', item.id],
          ['Аккаунт', item.accountId],
          ['Персона', item.personaId],
          ['Формат', item.format],
          ['Статус', badge(item.status)],
          ['Заголовок', item.title],
          ['Бриф', item.brief],
          ['Подпись', item.caption],
          ['Темы', item.topics.join(', ')],
          ['Материалы', item.mediaRefs.join(', ')],
          ['Призыв к действию', item.cta],
          ['Создан', timestamp(item.createdAt)],
          ['Обновлён', timestamp(item.updatedAt)],
          ['Дата плана', item.plannedDate],
          ['В расписании на', timestamp(item.scheduledAt)],
          ['Опубликован', timestamp(item.publishedAt)],
          ['Внешний идентификатор', item.externalId],
          ['Причина ошибки', item.failureReason],
          ['Метаданные', Object.keys(item.metadata).length === 0 ? '—' : json(item.metadata)],
        ]),
      ),
      local.area,
      panel('Переход статуса', transitionForm),
      panel('План контента аккаунта', planForm, planArea),
    );
  }

  // Creation form
  const accountSelect = h(
    'select',
    { name: 'accountId', required: true },
    accounts.map((account) =>
      option(account.id, `${account.platform} · ${account.id.slice(0, 8)} · ${account.status}`),
    ),
  );
  const formatSelect = h(
    'select',
    { name: 'format' },
    CONTENT_FORMATS.map((format) => option(format)),
  );
  const titleInput = h('input', { type: 'text', name: 'title' });
  const briefInput = h('textarea', { name: 'brief' });
  const captionInput = h('textarea', { name: 'caption' });
  const topicsInput = h('input', { type: 'text', name: 'topics' });
  const createForm = h(
    'form',
    { class: 'form' },
    field('Аккаунт', accountSelect),
    field('Формат', formatSelect),
    field('Заголовок', titleInput),
    field('Бриф', briefInput),
    field('Подпись', captionInput),
    field('Темы', topicsInput, 'через запятую'),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', text: 'Создать черновик' })),
  );
  if (accounts.length === 0) {
    createForm.replaceChildren(
      h('p', { class: 'empty', text: 'Сначала создайте аккаунт на вкладке «Аккаунты».' }),
    );
  }
  forForm(createForm, async () => {
    const body = { accountId: accountSelect.value, format: formatSelect.value };
    for (const [name, input] of [
      ['title', titleInput],
      ['brief', briefInput],
      ['caption', captionInput],
    ]) {
      const value = optionalText(input);
      if (value !== undefined) {
        body[name] = value;
      }
    }
    const topics = commaList(topicsInput.value);
    if (topics.length > 0) {
      body.topics = topics;
    }
    try {
      const item = await api('POST', '/content', body);
      createForm.reset();
      await loadTable();
      message.ok(`Черновик создан: ${item.id}`);
    } catch (error) {
      message.error(error);
    }
  });

  // Filters
  const filterAccount = h(
    'select',
    { name: 'accountId' },
    option('', 'все аккаунты'),
    accounts.map((account) =>
      option(account.id, `${account.platform} · ${account.id.slice(0, 8)}`),
    ),
  );
  const filterStatus = h(
    'select',
    { name: 'status' },
    option('', 'все статусы'),
    Object.keys(CONTENT_STATUS_LABELS).map((status) =>
      option(status, `${status} — ${CONTENT_STATUS_LABELS[status]}`),
    ),
  );
  const applyFilters = () => {
    filters.accountId = filterAccount.value;
    filters.status = filterStatus.value;
    loadTable();
  };
  filterAccount.addEventListener('change', applyFilters);
  filterStatus.addEventListener('change', applyFilters);

  const root = h(
    'div',
    { class: 'stack' },
    h('h2', { text: 'Контент' }),
    h('p', {
      class: 'muted',
      text: 'Панель только ведёт учёт: статус «published» подтверждает публикацию, состоявшуюся вне этой системы.',
    }),
    panel('Новый черновик', createForm),
    message.area,
    h(
      'section',
      { class: 'panel' },
      h(
        'div',
        { class: 'panel-head' },
        h('h3', { text: 'Контентные элементы' }),
        h('div', { class: 'row' }, field('Аккаунт', filterAccount), field('Статус', filterStatus)),
      ),
      tableArea,
    ),
    detailArea,
  );
  await loadTable();
  return root;
}

// ---------------------------------------------------------------------------
// Tab: Аналитика
// ---------------------------------------------------------------------------

async function renderAnalytics() {
  const message = notices();
  const resultArea = h('div');

  const startInput = h('input', { type: 'text', name: 'startDate', placeholder: 'ГГГГ-ММ-ДД' });
  const endInput = h('input', { type: 'text', name: 'endDate', placeholder: 'ГГГГ-ММ-ДД' });
  const daysInput = h('input', { type: 'text', name: 'survivalDays', placeholder: '1,3,7,14,30' });
  const form = h(
    'form',
    { class: 'form' },
    field('Начало периода', startInput, 'для частоты ограничений и ошибок действий'),
    field('Конец периода', endInput, 'включительно'),
    field('Дни выживаемости', daysInput, 'целые положительные числа через запятую'),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', text: 'Обновить снимок' })),
  );

  async function load() {
    resultArea.replaceChildren(loading());
    const query = new URLSearchParams();
    for (const input of [startInput, endInput, daysInput]) {
      if (input.value.trim() !== '') {
        query.set(input.name, input.value.trim());
      }
    }
    try {
      const snapshot = await api(
        'GET',
        `/analytics/snapshot${query.toString() === '' ? '' : `?${query.toString()}`}`,
      );
      message.clear();
      resultArea.replaceChildren(snapshotView(snapshot));
    } catch (error) {
      resultArea.replaceChildren();
      message.error(error);
    }
  }
  forForm(form, load);

  function snapshotView(snapshot) {
    const summary = snapshot.statusSummary;
    return h(
      'div',
      { class: 'stack' },
      panel(
        'Сводка по статусам',
        keyValues([
          ['Сформирован', timestamp(snapshot.generatedAt)],
          ['Всего аккаунтов', String(summary.total)],
        ]),
        table(
          [
            { title: 'Статус', render: (row) => badge(row[0]) },
            { title: 'Количество', className: 'num', render: (row) => String(row[1]) },
            {
              title: 'Доля',
              render: (row) => [
                bar(summary.total === 0 ? 0 : row[1] / summary.total),
                percent(summary.total === 0 ? 0 : row[1] / summary.total),
              ],
            },
          ],
          Object.entries(summary.byStatus),
          '',
        ),
      ),
      panel(
        'Матрица переходов статуса',
        table(
          [
            { title: 'Из', render: (cell) => badge(cell.from) },
            { title: 'В', render: (cell) => badge(cell.to) },
            { title: 'Количество', className: 'num', render: (cell) => String(cell.count) },
          ],
          snapshot.transitionMatrix,
          'Переходов статуса пока не было.',
        ),
      ),
      panel(
        'Частота ограничений',
        table(
          [
            { title: 'Дата', render: (row) => row.date },
            { title: 'Событий', className: 'num', render: (row) => String(row.restrictionEvents) },
            {
              title: 'Затронуто аккаунтов',
              className: 'num',
              render: (row) => String(row.accountsAffected),
            },
          ],
          snapshot.restrictionFrequency,
          'Ограничений за период не зафиксировано.',
        ),
      ),
      panel(
        'Ошибки действий',
        table(
          [
            { title: 'Дата', render: (row) => row.date },
            { title: 'Выполнено', className: 'num', render: (row) => String(row.performed) },
            { title: 'С ошибкой', className: 'num', render: (row) => String(row.failed) },
            {
              title: 'Доля ошибок',
              render: (row) => [bar(row.failureRate, true), percent(row.failureRate)],
            },
          ],
          snapshot.actionFailureMetrics,
          'Действий за период не зафиксировано.',
        ),
      ),
      panel(
        'Выживаемость когорт',
        h('p', {
          class: 'muted',
          text: 'Доля аккаунтов когорты, которые сейчас не выведены из портфеля (статус не «dead»).',
        }),
        table(
          [
            { title: 'Когорта', render: (point) => point.cohortDate },
            { title: 'День', className: 'num', render: (point) => String(point.day) },
            { title: 'Аккаунтов', className: 'num', render: (point) => String(point.total) },
            {
              title: 'Активны в портфеле',
              className: 'num',
              render: (point) => String(point.alive),
            },
            {
              title: 'Выживаемость',
              render: (point) => [bar(point.survivalRate), percent(point.survivalRate)],
            },
          ],
          snapshot.cohortSurvival,
          'Когорт, достигших нужного возраста, пока нет.',
        ),
      ),
    );
  }

  const root = h(
    'div',
    { class: 'stack' },
    h('h2', { text: 'Аналитика' }),
    panel('Параметры снимка', form),
    message.area,
    resultArea,
  );
  await load();
  return root;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const ROUTES = {
  overview: renderOverview,
  accounts: renderAccounts,
  personas: renderPersonas,
  content: renderContent,
  analytics: renderAnalytics,
};

function currentRoute() {
  const match = /^#\/([a-z]+)/.exec(window.location.hash);
  return match && Object.hasOwn(ROUTES, match[1]) ? match[1] : 'overview';
}

let navigationCounter = 0;

async function navigate() {
  const route = currentRoute();
  for (const link of document.querySelectorAll('#nav a')) {
    link.classList.toggle('active', link.dataset.route === route);
  }

  // A slow response for a tab the user has already left must not overwrite the current one.
  navigationCounter += 1;
  const mine = navigationCounter;
  const view = document.getElementById('view');
  view.replaceChildren(loading());
  try {
    const content = await ROUTES[route]();
    if (mine === navigationCounter) {
      view.replaceChildren(content);
    }
  } catch (error) {
    if (mine === navigationCounter) {
      view.replaceChildren(errorBox(error));
    }
  }
}

window.addEventListener('hashchange', navigate);
navigate();
