import { eventCancelledTemplate, eventChangedTemplate } from './event-update.js';
import { formatDuration } from './html.js';
import { resetPasswordTemplate } from './reset-password.js';
import { verifyEmailTemplate } from './verify-email.js';
import { joinRequestApprovedTemplate, joinRequestRejectedTemplate } from './join-request.js';

const url = 'https://app.example.com/verify-email?token=abc_DEF-123&x=1';

describe('email templates', () => {
  it.each([
    ['verify', verifyEmailTemplate],
    ['reset', resetPasswordTemplate],
  ])('%s: puts the link in the button, the fallback, and the text part', (_name, template) => {
    const email = template({ name: 'Ada', url, expiresInMinutes: 30 });

    // & is escaped inside the HTML attribute, raw in the text part
    const htmlUrl = url.replace('&', '&amp;');
    expect(email.html.match(new RegExp(`href="${htmlUrl.replace(/[?.]/g, '\\$&')}"`, 'g'))).toHaveLength(2);
    expect(email.text).toContain(url);
    expect(email.text).toContain('30 minutes');
  });

  it("escapes the user's name instead of rendering it as markup", () => {
    const email = verifyEmailTemplate({
      name: '<a href="https://evil.example">Click</a>',
      url,
      expiresInMinutes: 60,
    });

    expect(email.html).not.toContain('<a href="https://evil.example">');
    expect(email.html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;Click&lt;/a&gt;');
  });

  it('reassures that ignoring a reset email changes nothing', () => {
    const email = resetPasswordTemplate({ name: 'Ada', url, expiresInMinutes: 30 });
    expect(email.text).toMatch(/Your password will not change/);
    expect(email.subject).toMatch(/Reset your .* password/);
  });

  it.each([
    [30, '30 minutes'],
    [1, '1 minute'],
    [60, '1 hour'],
    [1440, '24 hours'],
    [90, '90 minutes'],
  ])('formats %i minutes as "%s"', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});

describe('join request templates', () => {
  it('approval links to the workspace', () => {
    const email = joinRequestApprovedTemplate({
      name: 'Ada',
      orgName: 'Robotics & Co',
      url: 'https://app.example.com/o/robotics',
    });
    expect(email.subject).toBe("You're in: Robotics & Co");
    expect(email.html).toContain('href="https://app.example.com/o/robotics"');
    // the org name is user input too
    expect(email.html).toContain('Robotics &amp; Co');
    expect(email.text).toContain('Open Robotics & Co: https://app.example.com/o/robotics');
  });

  it('rejection has no button, and says when they can ask again', () => {
    const email = joinRequestRejectedTemplate({
      name: 'Ada',
      orgName: 'Robotics',
      retryAfter: new Date('2026-10-13T08:05:00Z'),
    });
    expect(email.html).not.toContain('<a href=');
    expect(email.text).toContain('You can ask again after 13 October 2026 at 08:05 UTC.');
  });
});

describe('event update emails', () => {
  const base = { name: 'Ada', eventTitle: 'Demo Night', clubName: 'Robotics', url: 'https://app.example.com/o/csu?club=c1' };

  it("cancelled: names the event and its time, and quotes the organisers' note, escaped", () => {
    const email = eventCancelledTemplate({ ...base, when: 'Saturday 24 October 2026, 18:30 to 22:00 (AEDT)', reason: 'Speaker <b>ill</b>' });
    expect(email.subject).toBe('Cancelled: Demo Night');
    expect(email.text).toContain('Saturday 24 October 2026');
    expect(email.text).toContain('They said: "Speaker <b>ill</b>"');
    expect(email.html).not.toContain('<b>ill</b>');
  });

  it('cancelled: leaves the note out when there is none', () => {
    const email = eventCancelledTemplate({ ...base, when: 'Saturday', reason: null });
    expect(email.text).not.toContain('They said');
  });

  it('changed: says what changed, with the old value', () => {
    const moved = eventChangedTemplate({ ...base, when: 'Sunday', where: 'Hall B', before: { when: 'Saturday' } });
    expect(moved.subject).toBe('Changed: Demo Night');
    expect(moved.text).toContain('has a new time');
    expect(moved.text).toContain('When: Sunday (was Saturday)');
    expect(moved.text).toContain('Where: Hall B');

    const both = eventChangedTemplate({ ...base, when: 'Sunday', where: null, before: { when: 'Saturday', where: 'Hall B' } });
    expect(both.text).toContain('has a new time and place');
    expect(both.text).toContain('Where: to be announced (was Hall B)');
  });
});
