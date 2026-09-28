export const PASSWORD_MIN_LENGTH = 6;

export type PasswordRule = {
  id: string;
  label: string;
  test: (value: string) => boolean;
};

// Espelha as regras do backend em src/lib/password.ts
export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres`,
    test: (value) => value.length >= PASSWORD_MIN_LENGTH,
  },
  { id: "upper", label: "Uma letra maiúscula", test: (value) => /[A-Z]/.test(value) },
  { id: "lower", label: "Uma letra minúscula", test: (value) => /[a-z]/.test(value) },
  { id: "digit", label: "Um número", test: (value) => /[0-9]/.test(value) },
  { id: "special", label: "Um caractere especial", test: (value) => /[^A-Za-z0-9]/.test(value) },
];

export function isPasswordValid(value: string) {
  return PASSWORD_RULES.every((rule) => rule.test(value));
}
