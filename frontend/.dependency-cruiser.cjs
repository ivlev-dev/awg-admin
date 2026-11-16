/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-isolated",
      comment: "domain не знает о внешних слоях",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/(application|infrastructure|features|app|components)(/|$)" },
    },
    {
      name: "application-uses-domain-only",
      comment: "application зависит только от domain",
      severity: "error",
      from: { path: "^src/application" },
      to: { path: "^src/(infrastructure|features|app|components)(/|$)" },
    },
    {
      name: "infrastructure-implements-ports",
      comment: "infrastructure знает domain и application, но не delivery-слои",
      severity: "error",
      from: { path: "^src/infrastructure" },
      to: { path: "^src/(features|app|components)(/|$)" },
    },
    {
      name: "features-no-infrastructure",
      comment: "features ходят в infrastructure только через application/domain; type-only импорты допустимы, тесты собирают адаптеры сами",
      severity: "error",
      from: { path: "^src/features", pathNot: "\\.test\\.tsx?$" },
      to: { path: "^src/infrastructure", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "features-no-cross-feature-imports",
      comment: "features не импортируют друг друга напрямую",
      severity: "error",
      from: { path: "^src/features/([^/]+)/" },
      to: { path: "^src/features/(?!$1)" },
    },
    {
      name: "no-circular",
      comment: "циклические зависимости запрещены",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    parser: "swc",
    doNotFollow: { path: "node_modules" },
    exclude: { path: "\\.d\\.ts$" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
