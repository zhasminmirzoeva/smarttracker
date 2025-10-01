import { renderHook, act, waitFor } from '@testing-library/react-native';
import type { MeResponse } from '../../features/auth/Model/auth.types';

// ВАЖНО: мок по АБСОЛЮТНОМУ пути с алиасом `@/`.
// Если у тебя хук импортирует authApi через относительный путь,
// и мок не срабатывает — смени на:
// jest.mock(require.resolve('@/Model/auth.api'), ...);
const me = jest.fn();
const login = jest.fn();
const register = jest.fn();
const logout = jest.fn();

jest.mock('@/Model/auth.api', () => ({
  authApi: { me, login, register, logout },
}));

// импортируем после мока
import { useAuthVM } from '../../features/auth/ViewModel/useAuthVM';

const mkUser = (over: Partial<MeResponse> = {}): MeResponse =>
  ({
    id: 'u1',
    email: 'test@example.com',
    ...over,
  } as MeResponse);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useAuthVM', () => {
  test('автозагрузка: success → state=ready, user установлен', async () => {
    me.mockResolvedValueOnce(mkUser());

    const { result } = renderHook(() => useAuthVM());

    // Стартует в loading
    expect(result.current.state).toBe('loading');
    expect(result.current.busy).toBe(false);

    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });

    expect(result.current.user?.email).toBe('test@example.com');
    expect(result.current.error).toBeNull();
    expect(me).toHaveBeenCalledTimes(1);
  });

  test('автозагрузка: error → state=error, user=null, error задан', async () => {
    me.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useAuthVM());

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });

    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeTruthy();
    expect(me).toHaveBeenCalledTimes(1);
  });

  test('login: выставляет busy, вызывает login+me и переводит в ready', async () => {
    // первая автозагрузка вернёт null/ошибку — неважно
    me.mockRejectedValueOnce(new Error('unauthorized'));
    // успешный вход
    login.mockResolvedValueOnce(undefined);
    // после входа load снова дернёт me → вернём пользователя
    me.mockResolvedValueOnce(mkUser({ email: 'user@site.com' }));

    const { result } = renderHook(() => useAuthVM());

    // дождёмся любого конечного состояния после автозагрузки
    await waitFor(() =>
      expect(['error', 'ready']).toContain(result.current.state)
    );

    const promise = act(() => result.current.login('user@site.com', 'pass'));
    // сразу после вызова login должен выставиться busy=true
    expect(result.current.busy).toBe(true);
    await promise;

    expect(result.current.busy).toBe(false);
    expect(login).toHaveBeenCalledWith({ email: 'user@site.com', password: 'pass' });
    expect(me).toHaveBeenCalledTimes(2); // автозагрузка + reload после логина
    expect(result.current.state).toBe('ready');
    expect(result.current.user?.email).toBe('user@site.com');
  });

  test('register: регистрирует, логинится, reload и готов', async () => {
    // автозагрузка падает
    me.mockRejectedValueOnce(new Error('unauthorized'));
    register.mockResolvedValueOnce(undefined);
    login.mockResolvedValueOnce(undefined);
    me.mockResolvedValueOnce(mkUser({ email: 'new@site.com' })); // после регистрации и входа

    const { result } = renderHook(() => useAuthVM());
    await waitFor(() =>
      expect(['error', 'ready']).toContain(result.current.state)
    );

    const promise = act(() => result.current.register('new@site.com', 'p'));
    expect(result.current.busy).toBe(true);
    await promise;

    expect(result.current.busy).toBe(false);
    expect(register).toHaveBeenCalledWith({ email: 'new@site.com', password: 'p' });
    expect(login).toHaveBeenCalledWith({ email: 'new@site.com', password: 'p' });
    expect(me).toHaveBeenCalledTimes(2); // автозагрузка + reload после регистрации/логина
    expect(result.current.state).toBe('ready');
    expect(result.current.user?.email).toBe('new@site.com');
  });

  test('logout: чистит user и ставит state=idle', async () => {
    // автозагрузка успешна → уже есть пользователь
    me.mockResolvedValueOnce(mkUser({ email: 'logged@in.com' }));
    logout.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAuthVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    const promise = act(() => result.current.logout());
    expect(result.current.busy).toBe(true);
    await promise;

    expect(result.current.busy).toBe(false);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(result.current.user).toBeNull();
    expect(result.current.state).toBe('idle');
  });

  test('reload: дергает me и обновляет user', async () => {
    me.mockResolvedValueOnce(mkUser({ email: 'first@site.com' })); // автозагрузка
    me.mockResolvedValueOnce(mkUser({ email: 'second@site.com' })); // reload

    const { result } = renderHook(() => useAuthVM());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.user?.email).toBe('first@site.com');

    await act(async () => {
      await result.current.reload();
    });

    expect(me).toHaveBeenCalledTimes(2);
    expect(result.current.user?.email).toBe('second@site.com');
    expect(result.current.state).toBe('ready');
  });
});
