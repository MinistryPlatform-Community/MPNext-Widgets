import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "packages/**",
      "public/embed-sdk/**",
      "scripts/**",
      "coverage/**",
      // Ad-hoc investigation harnesses committed alongside the comparison
      // findings (`.claude/playwright/widget/scripts/`). They are one-off
      // probes kept as evidence for the C-numbered items, not product code,
      // and linting them only ever reports unused locals from a script that
      // was abandoned the moment it answered its question.
      ".claude/**",
    ],
  },
];

export default eslintConfig;
