import { describe, expect, it } from 'vitest';
import { isAllowedWebPushEndpoint } from './push-subscription';

describe('isAllowedWebPushEndpoint', () => {
  it('accepts HTTPS endpoints from browser push providers', () => {
    expect(isAllowedWebPushEndpoint('https://fcm.googleapis.com/fcm/send/token')).toBe(true);
    expect(isAllowedWebPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/token')).toBe(true);
    expect(isAllowedWebPushEndpoint('https://web.push.apple.com/token')).toBe(true);
  });

  it('rejects non-HTTPS, private, malformed, and unrelated endpoints', () => {
    expect(isAllowedWebPushEndpoint('http://fcm.googleapis.com/fcm/send/token')).toBe(false);
    expect(isAllowedWebPushEndpoint('https://127.0.0.1/push')).toBe(false);
    expect(isAllowedWebPushEndpoint('https://fcm.googleapis.com:444/push')).toBe(false);
    expect(isAllowedWebPushEndpoint('https://attacker.example/push')).toBe(false);
    expect(isAllowedWebPushEndpoint('not a URL')).toBe(false);
  });
});
