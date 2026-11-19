import { toTransportError } from './transport';

it('keeps a ProtocolError as it is', () => {
  const e = toTransportError({ code: 'internal', message: 'boom' });
  expect([e.code, e.message]).toEqual(['internal', 'boom']);
});

it('turns a plain string rejection into an internal error', () => {
  const e = toTransportError('invalid args `request` for command `rpc`');
  expect(e.code).toBe('internal');
  expect(e.message).toContain('invalid args');
});

it('turns an object with an unknown code into an internal error', () => {
  expect(toTransportError({ code: 'teapot', message: 'x' }).code).toBe('internal');
});
