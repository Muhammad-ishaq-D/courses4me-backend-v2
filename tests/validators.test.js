const validators = require('../src/validators');

const opts = { abortEarly: false, stripUnknown: true, convert: true };
const v = validators.auth;

describe('auth.register', () => {
  const good = { name: 'Jane Doe', email: 'Jane@Example.com', password: 'Str0ng!Pass' };

  it('accepts a valid signup and normalises the email', () => {
    const { error, value } = v.register.validate(good, opts);
    expect(error).toBeUndefined();
    expect(value.email).toBe('jane@example.com');
    expect(value.role).toBe('customer');
    expect(v.register.validate({ ...good, role: 'admin' }, opts).error).toBeDefined();
  });

  it('enforces the password policy (8+, uppercase, number, symbol)', () => {
    for (const bad of ['short1!', 'nouppercase1!', 'NoNumber!!', 'NoSymbol123', '        ']) {
      expect(v.register.validate({ ...good, password: bad }, opts).error).toBeDefined();
    }
  });

  it('strips unknown keys so the body can be spread safely', () => {
    const { value } = v.register.validate({ ...good, tokenVersion: 99, status: 'blocked', isAdmin: true }, opts);
    expect(value).not.toHaveProperty('tokenVersion');
    expect(value).not.toHaveProperty('status');
    expect(value).not.toHaveProperty('isAdmin');
  });

  it('requires name, email and password', () => {
    const { error } = v.register.validate({}, opts);
    const fields = error.details.map(d => d.path[0]);
    expect(fields).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });
});

describe('auth.login', () => {
  it('requires a valid email and a password', () => {
    expect(v.login.validate({ email: 'not-an-email', password: 'x' }, opts).error).toBeDefined();
    expect(v.login.validate({ email: 'a@b.co' }, opts).error).toBeDefined();
    expect(v.login.validate({ email: 'a@b.co', password: 'anything' }, opts).error).toBeUndefined();
  });
});

describe('auth.verifyOtp', () => {
  it('accepts `code` or `otp` as exactly six digits', () => {
    expect(v.verifyOtp.validate({ code: '123456' }, opts).error).toBeUndefined();
    expect(v.verifyOtp.validate({ otp: ' 654321 ' }, opts).error).toBeUndefined();
    expect(v.verifyOtp.validate({ code: '12345' }, opts).error).toBeDefined();
    expect(v.verifyOtp.validate({ code: 'abcdef' }, opts).error).toBeDefined();
    expect(v.verifyOtp.validate({}, opts).error).toBeDefined();
  });
});

describe('auth.resetPassword', () => {
  const token = 'a'.repeat(64);
  it('accepts the new and the legacy field names', () => {
    expect(v.resetPassword.validate({ resetToken: token, newPassword: 'Str0ng!Pass' }, opts).error).toBeUndefined();
    expect(v.resetPassword.validate({ token, password: 'Str0ng!Pass' }, opts).error).toBeUndefined();
  });
  it('rejects a malformed token or weak password', () => {
    expect(v.resetPassword.validate({ resetToken: 'nope', newPassword: 'Str0ng!Pass' }, opts).error).toBeDefined();
    expect(v.resetPassword.validate({ resetToken: token, newPassword: 'weak' }, opts).error).toBeDefined();
    expect(v.resetPassword.validate({ newPassword: 'Str0ng!Pass' }, opts).error).toBeDefined();
  });
});

describe('auth.updateDetails', () => {
  it('accepts the profile fields and drops anything else', () => {
    const { error, value } = v.updateDetails.validate({ name: 'Jane', phone: '', jobTitle: 'Trainer', role: 'admin', tokenVersion: 5 }, opts);
    expect(error).toBeUndefined();
    expect(value.jobTitle).toBe('Trainer');
    expect(value).not.toHaveProperty('role');
    expect(value).not.toHaveProperty('tokenVersion');
  });
});

describe('auth.listUsers (query)', () => {
  it('accepts the filters and rejects unknown status values', () => {
    expect(v.listUsers.validate({ search: 'jane', role: 'customer', status: 'active' }, opts).error).toBeUndefined();
    expect(v.listUsers.validate({ status: 'deleted' }, opts).error).toBeDefined();
  });
});

describe('auth.updateUserStatus', () => {
  it('only allows known statuses', () => {
    expect(v.updateUserStatus.validate({ status: 'suspended', reason: 'Spam' }, opts).error).toBeUndefined();
    expect(v.updateUserStatus.validate({ status: 'banned' }, opts).error).toBeDefined();
  });
});
