export default [
  {
    ignores: ["node_modules/", "assets/"],
  },
  {
    files: ["scripts.js"],
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
      "prefer-const": "error",
    },
  },
];
