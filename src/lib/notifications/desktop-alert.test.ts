import { afterEach, describe, expect, it, vi } from 'vitest';
import { showDesktopMessageAlert } from './desktop-alert';

afterEach(() => vi.unstubAllGlobals());

function device(userAgent = 'Windows') {
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const getNotifications = vi.fn().mockResolvedValue([]);
  const getRegistration = vi.fn().mockResolvedValue({ active: {}, showNotification, getNotifications });
  vi.stubGlobal('window', { Notification: {} });
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('navigator', { userAgent, platform: '', maxTouchPoints: 0, serviceWorker: { getRegistration } });
  return { showNotification, getNotifications, getRegistration };
}

const alert = { id: 'notification-id', conversationId: 'conversation-id', title: 'Nexoomni', body: 'New message' };

describe('desktop system alert fast path', () => {
  it('shows a visual system alert without waiting for the push queue', async () => {
    const { showNotification } = device();
    await showDesktopMessageAlert(alert);
    expect(showNotification).toHaveBeenCalledWith('Nexoomni', expect.objectContaining({
      tag: 'nexoomni-notification-id', silent: false, requireInteraction: true,
      data: { url: '/inbox?c=conversation-id' },
    }));
  });

  it('does not duplicate an already displayed push alert', async () => {
    const { showNotification, getNotifications } = device();
    getNotifications.mockResolvedValueOnce([{ tag: 'nexoomni-notification-id' }]);
    await showDesktopMessageAlert(alert);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('leaves mobile delivery to Web Push, not the open page', async () => {
    const { showNotification, getRegistration } = device('Android Mobile');
    await showDesktopMessageAlert(alert);
    expect(getRegistration).not.toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('never requests permission automatically', async () => {
    const { showNotification } = device();
    const requestPermission = vi.fn();
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    await showDesktopMessageAlert(alert);
    expect(showNotification).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('propagates a browser display error to the logged caller', async () => {
    const { showNotification } = device();
    showNotification.mockRejectedValueOnce(new Error('OS denied'));
    await expect(showDesktopMessageAlert(alert)).rejects.toThrow('OS denied');
  });
});
