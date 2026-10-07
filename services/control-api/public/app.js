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

const INTAKE_STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'completed'];

const INTAKE_STATUS_LABELS = {
  draft: 'черновик',
  pending_review: 'на проверке',
  approved: 'одобрена',
  rejected: 'отклонена',
  completed: 'приём завершён',
};

const INTAKE_SOURCES = ['manual', 'import', 'api'];

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

/** A status badge. `labels` picks the table the tooltip comes from when a status name is shared. */
function badge(value, kind, labels) {
  const names = labels || Object.assign({}, ACCOUNT_STATUS_LABELS, CONTENT_STATUS_LABELS);
  return h('span', {
    class: kind ? `badge ${kind}` : `badge s-${safeClass(value)}`,
    title: names[value] || null,
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
          columns.map((column) =>
            h('th', { class: column.className, text: column.title, title: column.hint }),
          ),
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

/** Whether the service answered that the operator has to confirm the action first. */
function asksForConfirmation(error) {
  if (!(error instanceof ApiError)) {
    return false;
  }
  if (error.code === 'manual_confirmation_required') {
    return true;
  }
  // Submitting an intake request without the ownership flag is a validation error on that field.
  return (
    error.code === 'validation_error' &&
    error.details.some(
      (detail) =>
        detail && Array.isArray(detail.path) && detail.path.includes('ownershipConfirmed'),
    )
  );
}

/**
 * Sends the request without a confirmation first. When the service asks for one, the operator is
 * asked `question` and, if they agree, the request is sent again with `confirmation` added. If they
 * decline, the service's own answer is thrown so that it is shown like any other error.
 */
async function postWithConfirmation(path, body, confirmation, question) {
  try {
    return await api('POST', path, body);
  } catch (error) {
    if (!asksForConfirmation(error)) {
      throw error;
    }
    const text =
      error.code === 'manual_confirmation_required' ? `${error.message}\n\n${question}` : question;
    if (!window.confirm(text)) {
      throw error;
    }
    return api('POST', path, Object.assign({}, body, confirmation));
  }
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
        const result = await postWithConfirmation(
          `${path}/transition`,
          confirmBox.checked ? { to, confirm: true } : { to },
          { confirm: true },
          'Подтвердить и повторить?',
        );
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
          await postWithConfirmation(
            `${path}/published`,
            body,
            { confirm: true },
            'Подтвердить, что публикация состоялась вне этой панели, и повторить?',
          );
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
// Tab: Приём
// ---------------------------------------------------------------------------

async function renderIntake() {
  const personas = await api('GET', '/personas');
  const message = notices();
  const tableArea = h('div');
  const detailArea = h('div');
  const filter = { status: '' };

  const dash = (value) => (value === null || value === undefined || value === '' ? '—' : value);
  const personaOptions = (selected) => [
    option('', '— не указана —', !selected),
    personas.map((persona) =>
      option(persona.id, `${persona.niche} · ${persona.id.slice(0, 8)}`, persona.id === selected),
    ),
  ];
  const intakeBadge = (status) => badge(status, undefined, INTAKE_STATUS_LABELS);

  async function loadTable() {
    tableArea.replaceChildren(loading());
    try {
      const suffix = filter.status === '' ? '' : `?status=${enc(filter.status)}`;
      const requests = await api('GET', `/intake/requests${suffix}`);
      tableArea.replaceChildren(
        table(
          [
            { title: 'id', className: 'mono', render: (r) => r.id },
            { title: 'Платформа', hint: 'platform', render: (r) => r.platform },
            {
              title: 'Внешний id',
              hint: 'externalAccountId',
              className: 'mono',
              render: (r) => dash(r.externalAccountId),
            },
            {
              title: 'Имя пользователя',
              hint: 'externalUsername',
              render: (r) => dash(r.externalUsername),
            },
            { title: 'Источник', hint: 'source', render: (r) => r.source },
            { title: 'Статус', hint: 'status', render: (r) => intakeBadge(r.status) },
            { title: 'Создана', hint: 'createdAt', render: (r) => timestamp(r.createdAt) },
            {
              title: 'Созданный аккаунт',
              hint: 'completedAccountId',
              className: 'mono',
              render: (r) => dash(r.completedAccountId),
            },
            {
              title: '',
              render: (r) =>
                h('button', {
                  class: 'secondary small',
                  type: 'button',
                  text: 'Подробнее',
                  onclick: () => showRequest(r.id),
                }),
            },
          ],
          requests,
          filter.status === ''
            ? 'Заявок пока нет. Создайте первую с помощью формы выше.'
            : 'Заявок с таким статусом нет.',
        ),
      );
    } catch (error) {
      tableArea.replaceChildren(errorBox(error));
    }
  }

  async function showRequest(requestId, flash) {
    detailArea.replaceChildren(loading());
    try {
      const request = await api('GET', `/intake/requests/${enc(requestId)}`);
      detailArea.replaceChildren(requestPanel(request, flash));
    } catch (error) {
      detailArea.replaceChildren(errorBox(error));
    }
  }

  function requestPanel(request, flash) {
    const path = `/intake/requests/${enc(request.id)}`;
    const local = notices();
    if (flash) {
      local.ok(flash);
    }
    const reload = (text) => Promise.all([loadTable(), showRequest(request.id, text)]);

    // Runs one operation; afterwards the list and this card are loaded again with a note about it.
    function operation(form, send) {
      forForm(form, async () => {
        message.clear();
        try {
          await reload(await send());
        } catch (error) {
          local.error(error);
        }
      });
      return form;
    }
    const actions = (...buttons) => h('div', { class: 'form-actions' }, buttons);
    const submitButton = (text, secondary) =>
      h('button', { type: 'submit', class: secondary ? 'secondary' : null, text });

    const forms = [];

    if (request.status === 'draft') {
      forms.push(
        panel(
          'Отправить на проверку',
          operation(
            h('form', { class: 'form' }, actions(submitButton('Отправить на проверку'))),
            async () => {
              await postWithConfirmation(
                `${path}/submit`,
                {},
                { ownershipConfirmed: true },
                'Подтвердить, что владение аккаунтом подтверждено, и отправить заявку на проверку?',
              );
              return 'Заявка отправлена на проверку.';
            },
          ),
        ),
      );
    }

    if (request.status === 'pending_review') {
      const note = h('input', { type: 'text', name: 'reviewerNote' });
      forms.push(
        panel(
          'Одобрить',
          operation(
            h(
              'form',
              { class: 'form' },
              field('Заметка проверяющего', note, 'необязательно'),
              actions(submitButton('Одобрить')),
            ),
            async () => {
              const text = optionalText(note);
              await postWithConfirmation(
                `${path}/approve`,
                text === undefined ? {} : { reviewerNote: text },
                { confirmOwnership: true },
                'Подтвердить, что проверяющий убедился во владении аккаунтом, и одобрить заявку?',
              );
              return 'Заявка одобрена.';
            },
          ),
        ),
      );
    }

    if (request.status === 'pending_review' || request.status === 'approved') {
      const reason = h('textarea', { name: 'reason', required: true });
      forms.push(
        panel(
          'Отклонить',
          operation(
            h(
              'form',
              { class: 'form' },
              field('Причина отклонения', reason, 'обязательна'),
              actions(submitButton('Отклонить', true)),
            ),
            async () => {
              const text = reason.value.trim();
              if (text === '') {
                throw new Error('Укажите причину отклонения.');
              }
              await api('POST', `${path}/reject`, { reason: text });
              return 'Заявка отклонена.';
            },
          ),
        ),
      );
    }

    if (request.status === 'rejected') {
      forms.push(
        panel(
          'Вернуть в черновик',
          operation(
            h('form', { class: 'form' }, actions(submitButton('Вернуть в черновик'))),
            async () => {
              await api('POST', `${path}/reopen`, {});
              return 'Заявка возвращена в черновик.';
            },
          ),
        ),
      );
    }

    if (request.status === 'approved') {
      const personaSelect = h(
        'select',
        { name: 'personaId' },
        personaOptions(request.desiredPersonaId),
      );
      forms.push(
        panel(
          'Завершить приём',
          h('p', {
            class: 'muted',
            text: 'Завершение создаёт запись аккаунта в портфеле со статусом connected. На платформе ничего не регистрируется.',
          }),
          operation(
            h(
              'form',
              { class: 'form' },
              field('Персона для аккаунта', personaSelect, 'необязательно'),
              actions(submitButton('Завершить приём')),
            ),
            async () => {
              if (!window.confirm('Вы уверены? Будет создан аккаунт в портфеле.')) {
                return null;
              }
              const result = await api(
                'POST',
                `${path}/complete`,
                personaSelect.value === '' ? {} : { personaId: personaSelect.value },
              );
              return `Приём завершён. Создан аккаунт ${result.account.id}.`;
            },
          ),
        ),
      );
    }

    return h(
      'section',
      { class: 'panel' },
      h(
        'div',
        { class: 'panel-head' },
        h('h3', { text: 'Заявка на приём аккаунта' }),
        h('button', {
          class: 'secondary small',
          type: 'button',
          text: 'Закрыть',
          onclick: () => detailArea.replaceChildren(),
        }),
      ),
      keyValues([
        ['id', request.id],
        ['Платформа (platform)', request.platform],
        ['Внешний id аккаунта (externalAccountId)', request.externalAccountId],
        ['Имя пользователя (externalUsername)', request.externalUsername],
        ['Источник (source)', request.source],
        ['Желаемая персона (desiredPersonaId)', request.desiredPersonaId],
        ['Владение подтверждено (ownershipConfirmed)', request.ownershipConfirmed ? 'да' : 'нет'],
        ['Заметки (notes)', request.notes],
        ['Статус (status)', intakeBadge(request.status)],
        ['Создана (createdAt)', timestamp(request.createdAt)],
        ['Обновлена (updatedAt)', timestamp(request.updatedAt)],
        ['Отправлена на проверку (submittedAt)', timestamp(request.submittedAt)],
        ['Проверена (reviewedAt)', timestamp(request.reviewedAt)],
        ['Приём завершён (completedAt)', timestamp(request.completedAt)],
        ['Причина отклонения (rejectionReason)', request.rejectionReason],
        ['Созданный аккаунт (completedAccountId)', request.completedAccountId],
        ['Метаданные (metadata)', json(request.metadata)],
      ]),
      local.area,
      forms.length === 0
        ? h('p', { class: 'empty', text: 'Для этой заявки операций нет: приём завершён.' })
        : h('div', { class: 'stack' }, forms),
    );
  }

  // Creation form
  const inputs = {
    platform: h(
      'select',
      { name: 'platform' },
      PLATFORMS.map((platform) => option(platform)),
    ),
    externalAccountId: h('input', { type: 'text', name: 'externalAccountId' }),
    externalUsername: h('input', { type: 'text', name: 'externalUsername' }),
    source: h(
      'select',
      { name: 'source' },
      INTAKE_SOURCES.map((source) => option(source, source, source === 'manual')),
    ),
    desiredPersonaId: h('select', { name: 'desiredPersonaId' }, personaOptions(null)),
    notes: h('textarea', { name: 'notes' }),
  };
  const form = h(
    'form',
    { class: 'form' },
    field('Платформа', inputs.platform, 'platform'),
    field('Внешний id аккаунта', inputs.externalAccountId, 'externalAccountId · необязательно'),
    field('Имя пользователя', inputs.externalUsername, 'externalUsername · необязательно'),
    field('Источник заявки', inputs.source, 'source · по умолчанию manual'),
    field('Желаемая персона', inputs.desiredPersonaId, 'desiredPersonaId · необязательно'),
    field('Заметки', inputs.notes, 'notes · необязательно'),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', text: 'Создать заявку' })),
  );
  forForm(form, async () => {
    const body = { platform: inputs.platform.value, source: inputs.source.value };
    for (const name of ['externalAccountId', 'externalUsername', 'notes']) {
      const value = optionalText(inputs[name]);
      if (value !== undefined) {
        body[name] = value;
      }
    }
    if (inputs.desiredPersonaId.value !== '') {
      body.desiredPersonaId = inputs.desiredPersonaId.value;
    }
    try {
      const created = await api('POST', '/intake/requests', body);
      form.reset();
      await Promise.all([loadTable(), showRequest(created.id)]);
      message.ok(`Заявка создана: ${created.id}`);
    } catch (error) {
      message.error(error);
    }
  });

  const filterSelect = h(
    'select',
    { name: 'status' },
    option('', 'Все'),
    INTAKE_STATUSES.map((status) => option(status, `${status} — ${INTAKE_STATUS_LABELS[status]}`)),
  );
  filterSelect.addEventListener('change', () => {
    filter.status = filterSelect.value;
    loadTable();
  });

  const root = h(
    'div',
    { class: 'stack' },
    h('h2', { text: 'Приём аккаунтов' }),
    h('p', {
      class: 'muted',
      text: 'Заявка фиксирует, что существующий аккаунт вносится в портфель вручную: после проверки и подтверждения владения создаётся запись аккаунта. Ничего не регистрируется на платформе.',
    }),
    panel('Новая заявка', form),
    message.area,
    panel('Заявки', h('div', { class: 'row' }, field('Статус', filterSelect)), tableArea),
    detailArea,
  );
  await loadTable();
  return root;
}

// ---------------------------------------------------------------------------
// Charts: plain SVG and HTML, no libraries. Colors live in the stylesheet (the classes `series-N`,
// `heat-N` and the status classes), because the page's policy does not allow inline styles.
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds an SVG element; like `h`, text only ever becomes a text node. */
function s(tag, attributes, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (key === 'text') {
      node.textContent = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child !== undefined && child !== null && child !== false) {
      node.append(child);
    }
  }
  return node;
}

/** Whole-number axis values 0, step, 2·step, … that reach `max`, in about four steps. */
function niceTicks(max) {
  const target = Math.max(1, max);
  const raw = target / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(
    1,
    [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw),
  );
  const ticks = [];
  for (let value = 0; value < target + step; value += step) {
    ticks.push(value);
  }
  return ticks;
}

/** `2026-07-10` becomes `10.07`; the full date stays in the tooltip. */
function shortDay(date) {
  const [, month, day] = String(date).split('-');
  return month && day ? `${day}.${month}` : String(date);
}

/** A column with a rounded top and a square foot, as a path (`r` is capped by the size). */
function columnPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height);
  if (r <= 0) {
    return `M${x},${y}h${width}v${height}h${-width}Z`;
  }
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

function legend(items) {
  return h(
    'ul',
    { class: 'legend' },
    items.map((item) =>
      h('li', {}, h('span', { class: `swatch ${item.className}` }), h('span', { text: item.name })),
    ),
  );
}

/**
 * Columns per day. A column is `{ label, sublabel, values, tooltip }`; with several `series` the
 * values are stacked in series order and the series colors are `series-1`, `series-2`, …
 */
function columnChart({ columns, series, caption }) {
  const width = 640;
  const height = 250;
  const hasSublabels = columns.length <= 12 && columns.some((column) => column.sublabel);
  const margin = { top: 20, right: 12, bottom: hasSublabels ? 46 : 30, left: 40 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const totals = columns.map((column) => column.values.reduce((sum, value) => sum + value, 0));
  const ticks = niceTicks(Math.max(0, ...totals));
  const ceiling = ticks[ticks.length - 1];
  const y = (value) => margin.top + plotHeight - (value / ceiling) * plotHeight;
  const band = plotWidth / columns.length;
  const barWidth = Math.min(24, band * 0.6);
  const labelEvery = Math.ceil(columns.length / Math.max(1, Math.floor(plotWidth / 54)));

  const svg = s('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': caption,
  });
  ticks.forEach((tick, index) => {
    svg.append(
      s('line', {
        class: index === 0 ? 'chart-baseline' : 'chart-grid',
        x1: margin.left,
        x2: width - margin.right,
        y1: y(tick),
        y2: y(tick),
      }),
      s('text', {
        class: 'chart-axis',
        x: margin.left - 8,
        y: y(tick) + 4,
        'text-anchor': 'end',
        text: String(tick),
      }),
    );
  });

  columns.forEach((column, index) => {
    const slot = margin.left + band * index;
    const center = slot + band / 2;
    const group = s(
      'g',
      {},
      s('title', { text: column.tooltip }),
      s('rect', { class: 'chart-hit', x: slot, y: margin.top, width: band, height: plotHeight }),
    );
    const lastFilled = column.values.reduce((last, value, i) => (value > 0 ? i : last), -1);
    let cumulative = 0;
    column.values.forEach((value, i) => {
      if (value <= 0) {
        return;
      }
      const top = y(cumulative + value);
      // The gap between stacked segments is part of the segment below the boundary.
      const gap = cumulative > 0 ? 2 : 0;
      group.append(
        s('path', {
          class: `series-${i + 1}`,
          d: columnPath(
            center - barWidth / 2,
            top,
            barWidth,
            Math.max(1, y(cumulative) - top - gap),
            i === lastFilled ? 4 : 0,
          ),
        }),
      );
      cumulative += value;
    });
    if (columns.length <= 14 && totals[index] > 0) {
      group.append(
        s('text', {
          class: 'chart-value',
          x: center,
          y: y(totals[index]) - 5,
          'text-anchor': 'middle',
          text: String(totals[index]),
        }),
      );
    }
    if (index % labelEvery === 0) {
      group.append(
        s('text', {
          class: 'chart-axis',
          x: center,
          y: height - margin.bottom + 16,
          'text-anchor': 'middle',
          text: column.label,
        }),
      );
      if (hasSublabels && column.sublabel) {
        group.append(
          s('text', {
            class: 'chart-axis',
            x: center,
            y: height - margin.bottom + 31,
            'text-anchor': 'middle',
            text: column.sublabel,
          }),
        );
      }
    }
    svg.append(group);
  });

  return h(
    'div',
    {},
    series.length > 1
      ? legend(series.map((item, i) => ({ name: item.name, className: `series-${i + 1}` })))
      : null,
    svg,
  );
}

function chartCard(title, note, content, wide) {
  return h(
    'section',
    { class: wide ? 'panel chart-card wide' : 'panel chart-card' },
    h('h3', { text: title }),
    note ? h('p', { class: 'muted chart-note', text: note }) : null,
    content,
  );
}

/** One row per account status, empty ones included, colored like the status badges. */
function statusBars(summary) {
  const rows = Object.keys(ACCOUNT_STATUS_LABELS).map((status) => ({
    status,
    count: (summary.byStatus && summary.byStatus[status]) || 0,
  }));
  const largest = Math.max(0, ...rows.map((row) => row.count));
  return h(
    'div',
    { class: 'hbars' },
    summary.total === 0 ? h('p', { class: 'empty', text: 'Аккаунтов в портфеле пока нет.' }) : null,
    rows.map((row) => {
      const fill = h('span', { class: `hbar-fill s-${safeClass(row.status)}` });
      fill.style.width = `${largest === 0 ? 0 : (row.count / largest) * 100}%`;
      return h(
        'div',
        { class: 'hbar-row', title: `${row.status}: ${row.count}` },
        h(
          'span',
          { class: 'hbar-name' },
          badge(row.status),
          h('span', { class: 'muted', text: ACCOUNT_STATUS_LABELS[row.status] }),
        ),
        h('span', { class: 'hbar-track' }, fill),
        h('span', { class: 'hbar-value', text: String(row.count) }),
      );
    }),
  );
}

const HEAT_BUCKETS = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];

function heatBucket(rate) {
  return Math.max(
    0,
    Math.min(HEAT_BUCKETS.length - 1, Math.floor(Number(rate) * HEAT_BUCKETS.length)),
  );
}

/** Cohorts as rows, ages in days as columns, and each cell shaded by the survival rate. */
function survivalHeatmap(points) {
  const days = [...new Set(points.map((point) => point.day))].sort((a, b) => a - b);
  const cohorts = [...new Set(points.map((point) => point.cohortDate))].sort();
  const byKey = new Map(points.map((point) => [`${point.cohortDate}|${point.day}`, point]));
  return h(
    'div',
    {},
    h(
      'ul',
      { class: 'legend' },
      HEAT_BUCKETS.map((label, index) =>
        h('li', {}, h('span', { class: `swatch heat-${index}` }), h('span', { text: label })),
      ),
    ),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'heatmap' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { text: 'Когорта' }),
            h('th', { class: 'num', text: 'Аккаунтов' }),
            days.map((day) => h('th', { class: 'num', text: `день ${day}` })),
          ),
        ),
        h(
          'tbody',
          {},
          cohorts.map((cohortDate) => {
            const total = points.find((point) => point.cohortDate === cohortDate).total;
            return h(
              'tr',
              {},
              h('td', { text: cohortDate }),
              h('td', { class: 'num', text: String(total) }),
              days.map((day) => {
                const point = byKey.get(`${cohortDate}|${day}`);
                return point
                  ? h('td', {
                      class: `num heat-${heatBucket(point.survivalRate)}`,
                      title: `${cohortDate}, день ${day}: ${point.alive} из ${point.total}`,
                      text: percent(point.survivalRate),
                    })
                  : h('td', {
                      class: 'num heat-none',
                      title: 'Когорта ещё не достигла этого возраста',
                      text: '—',
                    });
              }),
            );
          }),
        ),
      ),
    ),
  );
}

/** The section above the tables of the analytics tab. The tables below stay as the exact figures. */
function visualization(snapshot) {
  const restriction = snapshot.restrictionFrequency;
  const failures = snapshot.actionFailureMetrics;
  return h(
    'section',
    { class: 'stack' },
    h('h3', { class: 'section-title', text: 'Визуализация' }),
    h(
      'div',
      { class: 'charts' },
      chartCard(
        'Аккаунты по статусам',
        'Число аккаунтов в каждом статусе; цвета те же, что у бейджей статусов.',
        statusBars(snapshot.statusSummary),
      ),
      chartCard(
        'Частота ограничений',
        'События ограничений по дням (даты UTC); точные значения и число затронутых аккаунтов — в подсказке и в таблице ниже.',
        restriction.length === 0
          ? h('p', { class: 'empty', text: 'Ограничений за период не зафиксировано.' })
          : columnChart({
              caption: 'Число событий ограничений по дням',
              series: [{ name: 'События ограничений' }],
              columns: restriction.map((row) => ({
                label: shortDay(row.date),
                values: [row.restrictionEvents],
                tooltip: `${row.date}: событий ${row.restrictionEvents}, затронуто аккаунтов ${row.accountsAffected}`,
              })),
            }),
      ),
      chartCard(
        'Ошибки действий',
        'Выполненные действия и действия с ошибкой по дням (даты UTC); под датой — доля ошибок.',
        failures.length === 0
          ? h('p', { class: 'empty', text: 'Действий за период не зафиксировано.' })
          : columnChart({
              caption: 'Выполненные действия и ошибки по дням',
              series: [{ name: 'Выполнено' }, { name: 'С ошибкой' }],
              columns: failures.map((row) => ({
                label: shortDay(row.date),
                sublabel: percent(row.failureRate),
                values: [row.performed, row.failed],
                tooltip: `${row.date}: выполнено ${row.performed}, с ошибкой ${row.failed}, доля ошибок ${percent(row.failureRate)}`,
              })),
            }),
      ),
      chartCard(
        'Выживаемость когорт',
        'Доля аккаунтов когорты, которые сейчас не выведены из портфеля, по возрасту когорты.',
        snapshot.cohortSurvival.length === 0
          ? h('p', { class: 'empty', text: 'Когорт, достигших нужного возраста, пока нет.' })
          : survivalHeatmap(snapshot.cohortSurvival),
        true,
      ),
    ),
  );
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
      visualization(snapshot),
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
  intake: renderIntake,
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
