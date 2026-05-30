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
    ],
  },
];

export default eslintConfig;
