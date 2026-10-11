// Lint rules: the rules of AGENTS.md that a tool can check. Prettier does the formatting (.prettierrc.json).
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/** "One step per line" in AGENTS.md. */
const readability = {
  // Every if, else and loop has braces, and a line holds one statement: no one-liners.
  curly: ["error", "all"],
  "max-statements-per-line": ["error", { max: 1 }],
  "no-nested-ternary": "error",
  "no-unneeded-ternary": "error",
  "no-restricted-syntax": [
    "error",
    {
      selector: "TemplateLiteral ConditionalExpression",
      message: "No ternary inside a template literal: name the value first.",
    },
    {
      selector: "LogicalExpression[operator='??'] > LogicalExpression[operator='??']",
      message: "One fallback per expression.",
    },
    {
      selector: "CallExpression[callee.property.name='reduce']",
      message: "Prefer a for loop to reduce.",
    },
  ],
  // Prettier wraps the code at 120 characters, but not the comments.
  "max-len": [
    "error",
    { code: 120, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true, ignoreUrls: true },
  ],
};

/** Other rules from AGENTS.md. */
const conventions = {
  // Log through the Logger; the rare output meant for stdout says so with an eslint-disable comment.
  "no-console": "error",
  // `== null` is allowed: it checks for null and undefined at once.
  eqeqeq: ["error", "smart"],
  "prefer-const": "error",
};

export default defineConfig(
  { ignores: ["node_modules/", "data/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    // Browser code, loaded by a plain <script> tag.
    files: ["web/**/*.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
  },
  { rules: { ...readability, ...conventions } },
);
