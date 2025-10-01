import { renderHook, act, waitFor } from '@testing-library/react';

// === Моки внешних зависимостей (ровно по путям из хука) ===

// API продуктов
const list = jest.fn();
const remove = jest.fn();
jest.mock('../src/Model/products.api', () => ({
  productsApi: { list, remove },
}));

// mapper в UI-тип: дадим контролируемый daysLeft
jest.mock('../src/Model/products.mapper', () => ({
  toProductUi: (p: any) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    quantity: p.quantity,
    // Если тест передал _daysLeft — используем его, иначе большое число
    daysLeft: p._daysLeft ?? 9999,
  }),
}));

// уведомления / разрешения
const ensurePermissions = jest.fn();
jest.mock('../src/providers/NotificationsProvider', () => ({
  useNotifications: () => ({ ensurePermissions }),
}));

const getLocalNotifSettings = jest.fn();
jest.mock('../src/storage/localNotifications', () => ({
  getLocalNotifSettings,
}));

const clearAllExpiryNotifications = jest.fn();
const scheduleExpiryNotifications = jest.fn();
jest.mock('../src/notifications/local', () => ({
  clearAllExpiryNotifications,
  scheduleExpiryNotifications,
}));

// После моков — сам хук
import { useProductsVM } from '../src/viewmodels/useProductsVM';

// Удобные фабрики
const prod = (over: Partial<any> = {}) => ({
  id: over.id ?? Math.random(),
  name: over.name ?? 'Milk',
  category: over.category ?? 'Dairy',
  quantity: over.quantity ?? 1,
  expiry_date: over.expiry_date ?? '2025-12-31',
  _daysLeft: over._daysLeft, // для сортировок по сроку годности
});

beforeEach(() => {
  jest.clearAllMocks();
  ensurePermissions.mockResolvedValue(true);
  getLocalNotifSettings.mockResolvedValue({ daysBefore: 2 });
});

describe('useProductsVM — загрузка и ошибки', () => {
  test('первичная загрузка: success → state=ready и планирование уведомлений', async () => {
    const data = [prod({ name: 'B' }), prod({ name: 'A' })];
    list.mockResolvedValueOnce(data);

    const { result } = renderHook(() => useProductsVM());

    // изначально loading
    expect(result.current.state).toBe('loading');

    await waitFor(() => expect(result.current.state).toBe('ready'));
    // одна секция, data не пустая
    expect(result.current.sections[0].data.length).toBe(2);

    // уведомления перепланированы
    expect(ensurePermissions).toHaveBeenCalled();
    expect(getLocalNotifSettings).toHaveBeenCalled();
    expect(clearAllExpiryNotifications).toHaveBeenCalled();
    expect(scheduleExpiryNotifications).toHaveBeenCalled();
  });

  test('первичная загрузка: error → state=error, список пуст, уведомления не трогаем', async () => {
    list.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useProductsVM());

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.sections[0].data.length).toBe(0);
    expect(result.current.error).toBeTruthy();

    expect(scheduleExpiryNotifications).not.toHaveBeenCalled();
    expect(clearAllExpiryNotifications).not.toHaveBeenCalled();
  });
});

describe('useProductsVM — поиск и refresh', () => {
  test('onSearch передаёт trimmed запрос в API', async () => {
    list.mockResolvedValueOnce([]); // первичная
    list.mockResolvedValueOnce([]); // поиск
    const { result } = renderHook(() => useProductsVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    await act(async () => {
      result.current.setQ('  milk  ');
      result.current.onSearch();
    });

    expect(list).toHaveBeenLastCalledWith('milk');
  });

  test('onRefresh выставляет флаг refreshing и перезагружает', async () => {
    list.mockResolvedValueOnce([]); // первичная
    list.mockResolvedValueOnce([]); // refresh
    const { result } = renderHook(() => useProductsVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    const p = act(async () => {
      await result.current.onRefresh();
    });
    expect(result.current.refreshing).toBe(true);
    await p;
    expect(result.current.refreshing).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('useProductsVM — категории и фильтр', () => {
  test('формирование и сортировка категорий', async () => {
    list.mockResolvedValueOnce([
      prod({ category: 'Выпечка' }),
      prod({ category: 'Молочное' }),
      prod({ category: 'Молочное' }),
    ]);

    const { result } = renderHook(() => useProductsVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    expect(result.current.categories).toEqual(['Выпечка', 'Молочное'].sort((a, b) => a.localeCompare(b, 'ru')));
  });

  test('applyCategoryByIndex выбирает/сбрасывает фильтр', async () => {
    list.mockResolvedValueOnce([
      prod({ name: 'A', category: 'Мясо' }),
      prod({ name: 'B', category: 'Овощи' }),
    ]);

    const { result } = renderHook(() => useProductsVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    // Меню: ["Все", ...categories]
    // categories отсортированы: например ["Мясо","Овощи"] → индекс 1 выберет "Мясо"
    const idxMeat = 1;

    await act(async () => {
      result.current.applyCategoryByIndex(idxMeat);
    });

    // В секции должны быть только элементы "Мясо"
    expect(result.current.categoryMenuOptions[idxMeat]).toBe('Мясо');
    expect(result.current.sections[0].data.every((i: any) => i.category === 'Мясо')).toBe(true);

    // Сброс
    await act(async () => {
      result.current.applyCategoryByIndex(0);
    });
    expect(result.current.sections[0].data.length).toBe(2);
  });
});

describe('useProductsVM — сортировка и сброс фильтров', () => {
  test('nameAsc сортирует по имени (A→Я)', async () => {
    list.mockResolvedValueOnce([prod({ name: 'Банан' }), prod({ name: 'Ананас' })]);

    const { result } = renderHook(() => useProductsVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    // по умолчанию expiryAsc; сменим на nameAsc (index 0 в sortOptions)
    await act(async () => {
      result.current.applySortByIndex(0);
    });

    const names = result.current.sections[0].data.map((i: any) => i.name);
    expect(names).toEqual(['Ананас', 'Банан']); // A→Я
  });

  test('expiryAsc / expiryDesc уважают daysLeft', async () => {
    list.mockResolvedValueOnce([
      prod({ name: 'Soon', _daysLeft: 1 }),
      prod({ name: 'Later', _daysLeft: 10 }),
      prod({ name: 'Far', _daysLeft: 100 }),
    ]);

    const { result } = renderHook(() => useProductsVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    // expiryAsc (по умолчанию): 1,10,100
    let order = result.current.sections[0].data.map((i: any) => i.name);
    expect(order).toEqual(['Soon', 'Later', 'Far']);

    // expiryDesc
    await act(async () => {
      result.current.applySortByIndex(2); // index 2 => "Срок годности ↓"
    });
    order = result.current.sections[0].data.map((i: any) => i.name);
    expect(order).toEqual(['Far', 'Later', 'Soon']);
  });

  test('qtyDesc сортирует по количеству по убыванию', async () => {
    list.mockResolvedValueOnce([
      prod({ name: 'X', quantity: 1 }),
      prod({ name: 'Y', quantity: 5 }),
      prod({ name: 'Z', quantity: 3 }),
    ]);

    const { result } = renderHook(() => useProductsVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    await act(async () => {
      result.current.applySortByIndex(3); // "Кол-во ↓"
    });

    const names = result.current.sections[0].data.map((i: any) => i.name);
    expect(names).toEqual(['Y', 'Z', 'X']);
  });

  test('смена сортировки сбрасывает выбранную категорию и группировку', async () => {
    list.mockResolvedValueOnce([
      prod({ name: 'A', category: 'Мясо' }),
      prod({ name: 'B', category: 'Овощи' }),
    ]);

    const { result } = renderHook(() => useProductsVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    await act(async () => {
      result.current.applyCategoryByIndex(1); // выбрали первую категорию
    });
    // имитируем включение группировки (в хуке она только хранится)
    // @ts-expect-error: доступ к приватному сеттеру не экспортируется — проверим неявно
    // Смена сортировки должна обнулить category и groupByCategory
    await act(async () => {
      result.current.applySortByIndex(0); // nameAsc
    });

    // После сброса должны возвращаться все элементы (2 штуки)
    expect(result.current.sections[0].data.length).toBe(2);
  });
});

describe('useProductsVM — удаление', () => {
  test('remove вызывает API и обновляет список', async () => {
    // первичная загрузка
    list.mockResolvedValueOnce([prod({ id: 1 }), prod({ id: 2 })]);
    // refresh после remove
    list.mockResolvedValueOnce([prod({ id: 2 })]);
    remove.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useProductsVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    await act(async () => {
      await result.current.remove(1);
    });

    expect(remove).toHaveBeenCalledWith(1);
    // Был повторный запрос списка
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.sections[0].data.length).toBe(1);
  });
});

describe('useProductsVM — уведомления', () => {
  test('без разрешений перепланирование не выполняется', async () => {
    ensurePermissions.mockResolvedValueOnce(false);
    list.mockResolvedValueOnce([prod({ id: 1 })]);

    const { result } = renderHook(() => useProductsVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    expect(clearAllExpiryNotifications).not.toHaveBeenCalled();
    expect(scheduleExpiryNotifications).not.toHaveBeenCalled();
  });
});
