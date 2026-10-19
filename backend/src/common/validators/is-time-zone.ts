import { ValidateBy, type ValidationOptions } from 'class-validator';

/** Whether this runtime knows the zone (an IANA name such as "Australia/Sydney"). */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A time zone the app can actually format times in. */
export function IsTimeZone(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isTimeZone',
      validator: {
        validate: isTimeZone,
        defaultMessage: () => '$property must be a time zone such as Australia/Sydney',
      },
    },
    options,
  );
}
