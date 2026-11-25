export const isAuthenticatorCode = (code: string) => /^[0-9]{6}$/.test(code);
