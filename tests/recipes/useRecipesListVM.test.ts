import { renderHook, act, waitFor } from '@testing-library/react';

// === Моки внешних зависимостей по путям из хука ===

// API рецептов
const listApi = jest.fn();
const removeApi = jest.fn();
jest.mock('../src/recipes/Model/recipes.api', () => ({
  recipesApi: {
    list: (...a: any[]) => (listApi as any)(...a),
    remove: (...a: any[]) => (removeApi as any)(...a),
  },
}));

// Alert
const alertSpy = jest.fn();
jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  Alert: { alert: (...args: any[]) => alertSpy(...args) },
}));

// После моков — сам хук
import { useRecipesListVM } from '../src/recipes/viewmodels/useRecipesListVM';

// Утилиты
const r = (over: Partial<any> = {}) => ({
  id: over.id ?? Math.random(),
  title: over.title ?? 'Рецепт',
  created_at: over.created_at, // может быть undefined
  content: over.content ?? '{"title":"ok"}',
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useRecipesListVM — первичная загрузка', () => {
  test('успех: список получен, loading=false', async () => {
    listApi.mockResolvedValueOnce([r({ id: 1 }), r({ id: 2 })]);

    const { result } = renderHook(() => useRecipesListVM());

    // изначально loading=true
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sorted.length).toBe(2);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('ошибка: Alert и loading=false', async () => {
    listApi.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useRecipesListVM());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(alertSpy).toHaveBeenCalled();
    expect(result.current.sorted.length).toBe(0);
  });

  test('fetchList можно вызвать повторно', async () => {
    listApi.mockResolvedValueOnce([r({ id: 1 })]);
    listApi.mockResolvedValueOnce([r({ id: 1 }), r({ id: 2 })]);

    const { result } = renderHook(() => useRecipesListVM());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sorted.length).toBe(1);

    await act(async () => {
      await result.current.fetchList();
    });
    expect(result.current.sorted.length).toBe(2);
    expect(listApi).toHaveBeenCalledTimes(2);
  });
});

describe('useRecipesListVM — refresh', () => {
  test('onRefresh: refreshing true→false и данные обновляются', async () => {
    listApi.mockResolvedValueOnce([r({ id: 1 })]); // первичная
    listApi.mockResolvedValueOnce([r({ id: 1 }), r({ id: 2 })]); // refresh

    const { result } = renderHook(() => useRecipesListVM());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const p = act(async () => {
      await result.current.onRefresh();
    });
    expect(result.current.refreshing).toBe(true);
    await p;
    expect(result.current.refreshing).toBe(false);
    expect(result.current.sorted.length).toBe(2);
  });

  test('onRefresh: ошибка → Alert и refreshing=false', async () => {
    listApi.mockResolvedValueOnce([r({ id: 1 })]); // первичная
    listApi.mockRejectedValueOnce(new Error('fail')); // refresh

    const { result } = renderHook(() => useRecipesListVM());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.onRefresh();
    });

    expect(alertSpy).toHaveBeenCalled(); // "Не удалось обновить список"
    expect(result.current.refreshing).toBe(false);
  });
});

describe('useRecipesListVM — сортировка по created_at', () => {
  test('sorted выдаёт по убыванию даты (новые выше), undefined как 0', async () => {
    listApi.mockResolvedValueOnce([
      r({ id: 'old', created_at: '2021-01-01T00:00:00Z' }),
      r({ id: 'new', created_at: '2025-09-01T12:00:00Z' }),
      r({ id: 'no-date', created_at: undefined }),
    ]);

    const { result } = renderHook(() => useRecipesListVM());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ids = result.current.sorted.map((x: any) => x.id);
    // new (2025) > old (2021) > no-date (0)
    expect(ids).toEqual(['new', 'old', 'no-date']);
  });
});

describe('useRecipesListVM — parseContent', () => {
  test('парсит JSON-строку', async () => {
    listApi.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useRecipesListVM());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const obj = result.current.parseContent('{"title":"Тест"}');
    expect(obj).toEqual({ title: 'Тест' });
  });

  test('возвращает объект как есть', async () => {
    listApi.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useRecipesListVM());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const src = { title: 'Ок' };
    const obj = result.current.parseContent(src);
    expect(obj).toBe(src);
  });

  test('на некорректном вводе возвращает {}', async () => {
    listApi.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useRecipesListVM());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.parseContent('not-json')).toEqual({});
    expect(result.current.parseContent(null as any)).toEqual({});
  });
});

describe('useRecipesListVM — удаление', () => {
  test('remove: успешное удаление обновляет локальный список', async () => {
    listApi.mockResolvedValueOnce([r({ id: 1 }), r({ id: 2 })]);
    removeApi.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useRecipesListVM());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sorted.length).toBe(2);

    await act(async () => {
      await result.current.remove(1);
    });

    expect(removeApi).toHaveBeenCalledWith(1);
    expect(result.current.sorted.map((x: any) => x.id)).toEqual([2]);
  });

  test('remove: ошибка → Alert, список не меняется', async () => {
    listApi.mockResolvedValueOnce([r({ id: 1 }), r({ id: 2 })]);
    removeApi.mockRejectedValueOnce(new Error('cannot'));

    const { result } = renderHook(() => useRecipesListVM());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove(1);
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(result.current.sorted.map((x: any) => x.id).sort()).toEqual([1, 2]);
  });
});
