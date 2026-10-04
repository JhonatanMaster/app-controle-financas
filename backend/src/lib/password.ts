import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 6;

/**
 * Regras de forca da senha. O frontend replica a mesma lista para o checklist visual,
 * mas a validacao que vale e esta, porque a API pode ser chamada sem passar pela tela.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A senha precisa ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres`)
  .regex(/[A-Z]/, "A senha precisa ter uma letra maiúscula")
  .regex(/[a-z]/, "A senha precisa ter uma letra minúscula")
  .regex(/[0-9]/, "A senha precisa ter um número")
  .regex(/[^A-Za-z0-9]/, "A senha precisa ter um caractere especial");
