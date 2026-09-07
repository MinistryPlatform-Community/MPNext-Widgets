import { createRequire } from "node:module";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const require = createRequire(import.meta.url);

// eslint-config-next sets `settings.react.version = "detect"`. Under ESLint 10
// that detection path crashes: eslint-plugin-react@7.37.5 resolves the React
// package via `context.getFilename()`, a context method ESLint 10 removed
// (`TypeError: contextOrFilename.getFilename is not a function`, thrown at
// rule-load time for every file once any react/* rule is enabled).
//
// Resolving the version here does exactly what `detect` did -- read the
// installed react package's version -- without touching the removed API, so no
// rule is disabled or loosened (the resolved rule set is unchanged). Remove
// this once eslint-plugin-react ships ESLint 10 support (see TODO 18).
const reactVersion = require("react/package.json").version;

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  { settings: { react: { version: reactVersion } } },
  {
    ignores: [
      "packages/**",
      "public/embed-sdk/**",
      "scripts/**",
      "coverage/**",
    ],
  },
];

export default eslintConfig;
