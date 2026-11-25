import { z } from "zod";

export const createExperimentSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "lowercase letters, digits and dashes, 2 to 63 characters"),
    name: z.string().trim().min(1).max(120),
    variants: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, "lowercase letters, digits, dashes or underscores"),
          name: z.string().trim().min(1).max(120),
        }),
      )
      .min(2)
      .max(10),
  })
  .refine((v) => new Set(v.variants.map((x) => x.key)).size === v.variants.length, {
    message: "variant keys must be unique",
    path: ["variants"],
  });

export const visitorSchema = z.object({
  userKey: z.string().min(1).max(128),
});

export type CreateExperiment = z.output<typeof createExperimentSchema>;
export type Visitor = z.output<typeof visitorSchema>;
