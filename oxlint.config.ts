import { correctness, recommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [correctness],
  plugins: ["typescript", "unicorn", "oxc", "effecttsgo"],
  categories: { correctness: "error" },
  rules: {
    "typescript/no-explicit-any": "error",
    "typescript/consistent-type-imports": "error",
  },
  overrides: [
    {
      // Release scripts and transport fixtures intentionally use Node and Promise APIs.
      files: ["src/**/*.ts", "examples/**/*.ts"],
      rules: recommended.rules,
    },
  ],
  ignorePatterns: ["node_modules/**", "dist/**", "coverage/**", "release/**", "build/**"],
});
