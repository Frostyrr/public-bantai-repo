export function assessPassword(password: string) {
  const length = [...password].length;
  if (length < 8 || length > 64) {
    return { strength: "Weak", error: "Use 8 to 64 characters." } as const;
  }
  if (new TextEncoder().encode(password).length > 72) {
    return { strength: "Weak", error: "Use at most 72 UTF-8 bytes." } as const;
  }

  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u]
    .filter(pattern => pattern.test(password)).length;
  const passphrase = length >= 16 && password.trim().split(/\s+/).length >= 3;
  const predictable = /^(.{1,4})\1+$/su.test(password) ||
    /^(?:password|qwerty|letmein|12345678|admin|bantai)[\d!@#$]*$/i.test(password);
  if (predictable || (!passphrase && classes < 3)) {
    return { strength: "Weak", error: "Use a longer passphrase or mix letters, numbers, and symbols." } as const;
  }
  return { strength: length >= 16 ? "Strong" : "Medium", error: null } as const;
}
